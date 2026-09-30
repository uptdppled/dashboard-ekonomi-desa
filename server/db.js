// Banua360 data layer - Postgres (Supabase).
//
// Replaces the previous synchronous `node:sqlite` layer. The call surface is
// deliberately unchanged - `await db.prepare(sql).all(...)`, `.get(...)`, `.run(...)`
// still work and still take `?` placeholders - so migrating a call site means
// adding `await`, not rewriting its SQL. Placeholders are rewritten to $1..$n
// here, once per distinct statement and then cached.
//
// Two things that ARE different from the SQLite version, on purpose:
//
//  * Every call returns a Promise. Callers must `await`.
//  * This module no longer creates tables. The schema lives in
//    scripts/postgres-schema.sql and is applied once against the database;
//    a running app should never be issuing DDL.
//
// Connection notes (learned the hard way during the migration, see
// scripts/migrate-to-postgres.js):
//  * Use the TRANSACTION pooler (port 6543). Port 5432 is refused on the
//    free plan.
//  * The pooler hostname also resolves to NAT64 IPv6 addresses that accept
//    the TCP connection and then reset it, so IPv4 is forced below.
//  * The pooler recycles server-side connections between transactions, so a
//    long-lived single client gets terminated. Hence a Pool, plus a retry
//    around each query.

import dns from 'node:dns';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

dns.setDefaultResultOrder('ipv4first');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // .env is optional; DATABASE_URL may already be exported.
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'DATABASE_URL belum diisi. Tambahkan di server/.env - lihat .env.example. ' +
      'Ambil dari Supabase: tombol Connect > Connection String > Transaction pooler (port 6543).',
  );
}

export const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: Number(process.env.PGPOOL_MAX ?? 5),
  connectionTimeoutMillis: 20000,
  idleTimeoutMillis: 30000,
});

// A socket dropped while a connection sits idle in the pool arrives as an
// 'error' event with no query attached; without this handler it is unhandled
// and takes the process down.
pool.on('error', (error) => {
  console.warn('[db] koneksi idle terputus:', error.message);
});

const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  '57P01', // admin_shutdown
  '08006', // connection_failure
  '08003', // connection_does_not_exist
]);

function isRetryable(error) {
  return (
    RETRYABLE_CODES.has(error.code) ||
    /Connection terminated|socket hang up|timeout expired/i.test(error.message ?? '')
  );
}

/**
 * Rewrites SQLite's `?` placeholders to Postgres's `$1..$n`, leaving any `?`
 * that appears inside a string literal, quoted identifier or comment alone.
 */
export function toPgPlaceholders(sql) {
  let out = '';
  let n = 0;
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === quote) {
          if (sql[j + 1] === quote) j += 2; // escaped quote, stays inside
          else break;
        } else j += 1;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }

    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    if (ch === '?') {
      n += 1;
      out += `$${n}`;
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

const translated = new Map();

function translate(sql) {
  let text = translated.get(sql);
  if (text === undefined) {
    text = toPgPlaceholders(sql);
    translated.set(sql, text);
  }
  return text;
}

/** `.all(a, b)` and `.all([a, b])` both work, matching node:sqlite. */
function normalizeParams(args) {
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
}

async function run(text, params, executor = pool) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await executor.query(text, params);
    } catch (error) {
      if (attempt >= 3 || !isRetryable(error)) {
        // Make failures traceable: pg's message alone does not say which query.
        error.message = `${error.message}\n  SQL: ${text.replace(/\s+/g, ' ').slice(0, 300)}`;
        throw error;
      }
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
}

function statement(sql, executor) {
  const text = translate(sql);
  return {
    async all(...args) {
      const res = await run(text, normalizeParams(args), executor);
      return res.rows;
    },
    async get(...args) {
      const res = await run(text, normalizeParams(args), executor);
      return res.rows[0];
    },
    async run(...args) {
      const res = await run(text, normalizeParams(args), executor);
      const result = { changes: res.rowCount ?? 0 };

      // node:sqlite also returned `lastInsertRowid`, which Postgres has no
      // equivalent for. Reading it would silently yield undefined (and then
      // NaN through Number()), so it fails loudly instead: add `RETURNING id`
      // to the statement and use .get() rather than .run().
      for (const name of ['lastInsertRowid', 'lastInsertRowId']) {
        Object.defineProperty(result, name, {
          get() {
            throw new Error(
              `${name} tidak ada di Postgres. Tambahkan "RETURNING id" ke INSERT-nya ` +
                'lalu pakai .get() dan baca .id.',
            );
          },
        });
      }
      return result;
    },
  };
}

export const db = {
  prepare: (sql) => statement(sql, pool),

  /** Multi-statement SQL, no parameters - kept for parity with node:sqlite. */
  async exec(sql) {
    await run(sql, undefined, pool);
  },

  /**
   * Runs `fn` inside a real transaction on a single checked-out connection.
   *
   * Required because the transaction pooler hands out a different backend per
   * statement: issuing BEGIN and COMMIT as separate pool queries would land on
   * different connections and silently not be a transaction at all.
   *
   *   await db.transaction(async (tx) => {
   *     await tx.prepare('DELETE FROM x WHERE id = ?').run(id);
   *   });
   */
  async transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn({
        prepare: (sql) => statement(sql, client),
        exec: (sql) => run(sql, undefined, client),
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The connection may already be gone; the original error matters more.
      }
      throw error;
    } finally {
      client.release();
    }
  },

  async close() {
    await pool.end();
  },
};

export default db;
