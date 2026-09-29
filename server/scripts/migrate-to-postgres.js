// Copy Banua360's SQLite data into Postgres (Supabase).
//
//   node scripts/migrate-to-postgres.js --dry-run     # count only, no connection
//   node scripts/migrate-to-postgres.js               # copy into an empty schema
//   node scripts/migrate-to-postgres.js --fresh       # TRUNCATE the target first
//
// Requires scripts/postgres-schema.sql to have been applied already, and
// DATABASE_URL to point at the Supabase database (Session pooler connection
// string from Project Settings > Database).
//
// The SQLite side is opened READ-ONLY and db.js is never imported, so running
// this cannot alter the source database.
//
// Two things this does that a naive dump/restore would not:
//
//  1. Rows in potensi_desa that record the ABSENCE of a potensi are skipped -
//     about 729k of 1.21M rows. index.js already filters them out of every
//     read, so they are pure storage cost. This is what brings the database
//     under Supabase's 500 MB free-tier limit. See POTENSI_KOSONG in
//     scripts/import-excel.js for why '0' is NOT in this list.
//  2. Existing id values are preserved (so foreign keys still line up), then
//     each identity sequence is advanced past the highest id - otherwise the
//     first insert made by the running app would collide with an existing row.

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

// Supabase's pooler hostname resolves to both real IPv4 addresses and NAT64
// IPv6 addresses (64:ff9b::/96). On a network without working NAT64 the IPv6
// route is accepted at TCP level and then reset mid-handshake, which shows up
// as an intermittent ECONNRESET. Preferring IPv4 avoids it.
dns.setDefaultResultOrder('ipv4first');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.EKONOMI_DB ?? path.join(__dirname, '..', 'data', 'ekonomi-desa.db');

// Same pattern as index.js: DATABASE_URL belongs in server/.env, which is
// gitignored, so the database password never reaches the shell history or
// a screenshot.
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // No .env - fall back to an already-exported DATABASE_URL.
}

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const FRESH = args.has('--fresh');

/** Rows whose `nilai` only records that a potensi is absent. */
const POTENSI_KOSONG = new Set(['tidak ada', '-', '']);

/**
 * Tables in foreign-key-safe insertion order. Truncation walks this in reverse.
 * `filter` returns false for rows that should not be migrated.
 */
const TABLES = [
  { name: 'desa' },
  { name: 'skor_indikator' },
  { name: 'jawaban_kuesioner' },
  {
    name: 'potensi_desa',
    filter: (row) => !POTENSI_KOSONG.has(String(row.nilai ?? '').trim().toLowerCase()),
  },
  { name: 'ekosistem_desa' },
  { name: 'import_log' },
  { name: 'rekomendasi_produk' },
  { name: 'narasi_desa' },
  { name: 'narasi_indeks' },
  { name: 'rekomendasi_kabupaten' },
  { name: 'kode_registrasi' },
  { name: 'users' },
  { name: 'rpkp_review' },
  { name: 'rpkp_document' },
  { name: 'rpkp_review_history' },
  { name: 'rpkp_ai_qa' },
  { name: 'rpkp_completeness_item' },
  { name: 'rpkp_finding' },
  { name: 'rpkp_evidence' },
  { name: 'rpkp_recommendation' },
  { name: 'rpkp_review_desa' },
];

const PAGE_SIZE = 5000;

function quoteIdent(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

function log(line = '') {
  console.log(line);
}

// --- Source ----------------------------------------------------------------

if (!fs.existsSync(DB_PATH)) {
  console.error(`Database SQLite tidak ditemukan: ${DB_PATH}`);
  process.exit(1);
}

const sqlite = new DatabaseSync(DB_PATH, { readOnly: true });

function columnsOf(table) {
  return sqlite.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all();
}

/** Yields pages of rows, keyed on `id` when the table has one. */
function* readRows(table, columns) {
  const hasId = columns.some((c) => c.name === 'id');
  const t = quoteIdent(table);

  if (!hasId) {
    yield sqlite.prepare(`SELECT * FROM ${t}`).all();
    return;
  }

  const stmt = sqlite.prepare(`SELECT * FROM ${t} WHERE id > ? ORDER BY id LIMIT ${PAGE_SIZE}`);
  let last = 0;
  for (;;) {
    const page = stmt.all(last);
    if (page.length === 0) return;
    yield page;
    last = Number(page[page.length - 1].id);
  }
}

// --- Dry run ---------------------------------------------------------------

if (DRY_RUN) {
  log('');
  log('DRY RUN - tidak ada koneksi ke Postgres, tidak ada data yang ditulis.');
  log('');
  let totalIn = 0;
  let totalOut = 0;
  for (const spec of TABLES) {
    const columns = columnsOf(spec.name);
    if (columns.length === 0) {
      log(`  ${spec.name.padEnd(26)} (tidak ada di SQLite - dilewati)`);
      continue;
    }
    let seen = 0;
    let kept = 0;
    for (const page of readRows(spec.name, columns)) {
      seen += page.length;
      kept += spec.filter ? page.filter(spec.filter).length : page.length;
    }
    totalIn += seen;
    totalOut += kept;
    const note = seen === kept ? '' : `  (${(seen - kept).toLocaleString('id-ID')} dilewati)`;
    log(`  ${spec.name.padEnd(26)} ${kept.toLocaleString('id-ID').padStart(12)}${note}`);
  }
  log('');
  log(`  ${'TOTAL'.padEnd(26)} ${totalOut.toLocaleString('id-ID').padStart(12)} dari ${totalIn.toLocaleString('id-ID')} baris`);
  log('');
  sqlite.close();
  process.exit(0);
}

// --- Target ----------------------------------------------------------------

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL belum diisi. Tambahkan barisnya di server/.env:');
  console.error('');
  console.error('  DATABASE_URL=postgresql://postgres.<project>:<password>@...pooler.supabase.com:6543/postgres');
  console.error('');
  console.error('Ambil di dashboard Supabase: tombol Connect > Connection String > Transaction pooler.');
  process.exit(1);
}

// A Pool, not a single Client: Supabase's transaction pooler recycles the
// server-side connection between transactions, so a long-lived client gets
// terminated part-way through a migration of this length. The pool simply
// opens a new one when that happens.
const pool = new Pool({
  connectionString,
  // Supabase terminates TLS with its own chain; verifying it needs the CA
  // bundle, which is more setup than a one-off migration warrants.
  ssl: { rejectUnauthorized: false },
  max: 2,
  connectionTimeoutMillis: 20000,
  idleTimeoutMillis: 10000,
});

// Without this, a socket dropped while a connection sits idle in the pool
// becomes an unhandled 'error' event and kills the process.
pool.on('error', () => {});

const RETRYABLE = new Set([
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
    RETRYABLE.has(error.code) ||
    /Connection terminated|socket hang up|timeout expired/i.test(error.message ?? '')
  );
}

/** Runs a query, transparently re-opening the connection if the pooler drops it. */
async function runQuery(sql, params) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await pool.query(sql, params);
    } catch (error) {
      if (attempt >= 4 || !isRetryable(error)) throw error;
      await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
}

await runQuery('SELECT 1');

log('');
log('Terhubung ke Postgres.');

// Refuse to append to a database that already holds data, unless asked to.
if (FRESH) {
  const list = TABLES.map((t) => quoteIdent(t.name)).join(', ');
  await runQuery(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  log('Tabel tujuan dikosongkan (--fresh).');
} else {
  for (const spec of TABLES) {
    const { rows } = await runQuery(`SELECT COUNT(*)::int AS n FROM ${quoteIdent(spec.name)}`);
    if (rows[0].n > 0) {
      console.error('');
      console.error(`Tabel ${spec.name} sudah berisi ${rows[0].n} baris.`);
      console.error('Jalankan ulang dengan --fresh kalau memang mau menimpa isinya.');
      await pool.end();
      sqlite.close();
      process.exit(1);
    }
  }
}

log('');

const summary = [];
const started = Date.now();

for (const spec of TABLES) {
  const columns = columnsOf(spec.name);
  if (columns.length === 0) {
    log(`  ${spec.name.padEnd(26)} dilewati (tidak ada di SQLite)`);
    continue;
  }

  const names = columns.map((c) => c.name);
  const colSql = names.map(quoteIdent).join(', ');
  // Postgres caps a statement at 65535 parameters.
  const batchRows = Math.max(1, Math.min(2000, Math.floor(60000 / names.length)));

  let seen = 0;
  let written = 0;
  let buffer = [];

  const flush = async () => {
    if (buffer.length === 0) return;
    const values = [];
    const tuples = buffer.map((row, r) => {
      const placeholders = names.map((n, c) => {
        values.push(row[n] ?? null);
        return `$${r * names.length + c + 1}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    try {
      await runQuery(
        `INSERT INTO ${quoteIdent(spec.name)} (${colSql}) VALUES ${tuples.join(', ')}`,
        values,
      );
    } catch (error) {
      console.error(`\nGagal menulis ke ${spec.name} (batch ${buffer.length} baris):`);
      console.error(`  ${error.message}`);
      throw error;
    }
    written += buffer.length;
    buffer = [];
  };

  for (const page of readRows(spec.name, columns)) {
    for (const row of page) {
      seen++;
      if (spec.filter && !spec.filter(row)) continue;
      buffer.push(row);
      if (buffer.length >= batchRows) await flush();
    }
    if (seen >= 50000 && seen % 50000 < PAGE_SIZE) {
      process.stdout.write(`\r  ${spec.name.padEnd(26)} ${written.toLocaleString('id-ID')} baris…`);
    }
  }
  await flush();

  // Advance the identity sequence past the ids we just inserted.
  if (names.includes('id')) {
    await runQuery(
      `SELECT setval(
         pg_get_serial_sequence($1, 'id'),
         COALESCE((SELECT MAX(id) FROM ${quoteIdent(spec.name)}), 0) + 1,
         false
       )`,
      [spec.name],
    );
  }

  const { rows } = await runQuery(`SELECT COUNT(*)::int AS n FROM ${quoteIdent(spec.name)}`);
  const ok = rows[0].n === written;
  summary.push({ table: spec.name, seen, written, target: rows[0].n, ok });

  const skipped = seen - written;
  const note = skipped > 0 ? `  (${skipped.toLocaleString('id-ID')} dilewati)` : '';
  process.stdout.write('\r' + ' '.repeat(70) + '\r');
  log(`  ${ok ? 'OK ' : '!! '}${spec.name.padEnd(26)} ${written.toLocaleString('id-ID').padStart(12)}${note}`);
}

await pool.end();
sqlite.close();

// --- Report ----------------------------------------------------------------

const failed = summary.filter((s) => !s.ok);
const totalWritten = summary.reduce((n, s) => n + s.written, 0);
const totalSkipped = summary.reduce((n, s) => n + (s.seen - s.written), 0);

log('');
log(`Selesai dalam ${((Date.now() - started) / 1000).toFixed(0)} detik.`);
log(`${totalWritten.toLocaleString('id-ID')} baris dipindahkan, ${totalSkipped.toLocaleString('id-ID')} baris "tidak ada" dilewati.`);

if (failed.length > 0) {
  log('');
  log('PERIKSA: jumlah baris di tujuan tidak cocok untuk tabel berikut:');
  for (const f of failed) log(`  ${f.table}: ditulis ${f.written}, terbaca di Postgres ${f.target}`);
  process.exit(1);
}

log('Jumlah baris di Postgres cocok dengan yang ditulis untuk semua tabel.');
log('');
