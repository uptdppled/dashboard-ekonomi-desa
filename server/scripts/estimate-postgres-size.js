// Estimate how large this SQLite database would be after migrating to Postgres
// (Supabase), so we know up front whether it fits the 500 MB free-tier limit.
//
// Run: node scripts/estimate-postgres-size.js
//
// The database is opened READ-ONLY and `db.js` is deliberately NOT imported,
// because importing it runs the CREATE TABLE / migration block as a side effect.
//
// Why the numbers differ from the .db file size: SQLite packs rows tightly and
// stores an INTEGER PRIMARY KEY as the rowid (no separate index). Postgres adds
// a 24-byte header plus a 4-byte line pointer per row, pads rows to 8 bytes,
// and materialises every primary key as a real B-tree index. Growth of 1.5-3x
// is normal, which is exactly why this is worth measuring rather than guessing.

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.EKONOMI_DB ?? path.join(__dirname, '..', 'data', 'ekonomi-desa.db');

/** Supabase free plan database quota. */
const FREE_TIER_BYTES = 500 * 1024 * 1024;

// --- Postgres storage model ------------------------------------------------
// Deliberately conservative but not alarmist; see the header comment.
const ROW_HEADER = 24; // HeapTupleHeader
const LINE_POINTER = 4; // ItemIdData in the page header
const HEAP_PAGE_FACTOR = 1.08; // page headers + free space left by the fillfactor
const INDEX_ENTRY_OVERHEAD = 12; // IndexTupleData + line pointer
const INDEX_FILL_FACTOR = 1.4; // B-tree leaves default to ~70% full
const INT_BYTES = 8; // bigint, the safe assumption for AUTOINCREMENT ids
const REAL_BYTES = 8; // double precision

/** Bytes a value of this column costs in a Postgres tuple, as a SQLite expression. */
function columnSizeExpr(name, declaredType) {
  const col = `"${name.replace(/"/g, '""')}"`;
  const type = (declaredType || '').toUpperCase();

  if (type.includes('INT')) return `CASE WHEN ${col} IS NULL THEN 0 ELSE ${INT_BYTES} END`;
  if (type.includes('REAL') || type.includes('FLOA') || type.includes('DOUB'))
    return `CASE WHEN ${col} IS NULL THEN 0 ELSE ${REAL_BYTES} END`;

  // TEXT / BLOB / everything else: varlena, 1-byte header when short, 4 when long.
  const len = `length(CAST(${col} AS BLOB))`;
  return `CASE WHEN ${col} IS NULL THEN 0 ELSE ${len} + CASE WHEN ${len} < 127 THEN 1 ELSE 4 END END`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function pad(text, width, right = false) {
  const s = String(text);
  if (s.length >= width) return s.slice(0, width);
  return right ? s.padStart(width) : s.padEnd(width);
}

// --- Measure ---------------------------------------------------------------

if (!fs.existsSync(DB_PATH)) {
  console.error(`Database tidak ditemukan: ${DB_PATH}`);
  console.error('Set EKONOMI_DB kalau file-nya ada di tempat lain.');
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });

const fileBytes = fs.statSync(DB_PATH).size;

const tables = db
  .prepare(
    `SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name`,
  )
  .all()
  .map((r) => r.name);

const rows = [];

for (const table of tables) {
  const quoted = `"${table.replace(/"/g, '""')}"`;
  const columns = db.prepare(`PRAGMA table_info(${quoted})`).all();
  if (columns.length === 0) continue;

  const nullBitmap = Math.ceil(columns.length / 8);
  const perRowOverhead = ROW_HEADER + LINE_POINTER + nullBitmap;

  const payloadExpr = columns.map((c) => columnSizeExpr(c.name, c.type)).join(' + ');
  // Round each row up to Postgres's 8-byte alignment before summing.
  const alignedRow = `((${payloadExpr} + ${perRowOverhead} + 7) / 8) * 8`;

  const { n, heap } = db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(${alignedRow}), 0) AS heap FROM ${quoted}`)
    .get();

  // Indexes Postgres would hold, including primary keys.
  const indexes = db.prepare(`PRAGMA index_list(${quoted})`).all();
  const indexSpecs = indexes.map((idx) => ({
    name: idx.name,
    columns: db
      .prepare(`PRAGMA index_info("${idx.name.replace(/"/g, '""')}")`)
      .all()
      .map((c) => c.name)
      .filter(Boolean),
  }));

  // An INTEGER PRIMARY KEY is SQLite's rowid and has no index of its own,
  // but Postgres materialises it. Add it so the estimate is not too rosy.
  const intPk = columns.find((c) => c.pk > 0 && (c.type || '').toUpperCase().includes('INT'));
  if (intPk && !indexSpecs.some((s) => s.columns.includes(intPk.name))) {
    indexSpecs.push({ name: `${table}_pkey`, columns: [intPk.name] });
  }

  let indexBytes = 0;
  for (const spec of indexSpecs) {
    if (spec.columns.length === 0) continue;
    const keyExpr = spec.columns
      .map((name) => {
        const col = columns.find((c) => c.name === name);
        return col ? columnSizeExpr(col.name, col.type) : '0';
      })
      .join(' + ');
    const entry = `((${keyExpr} + ${INDEX_ENTRY_OVERHEAD} + 7) / 8) * 8`;
    const { total } = db
      .prepare(`SELECT COALESCE(SUM(${entry}), 0) AS total FROM ${quoted}`)
      .get();
    indexBytes += Number(total) * INDEX_FILL_FACTOR;
  }

  const heapBytes = Number(heap) * HEAP_PAGE_FACTOR;
  rows.push({
    table,
    rows: Number(n),
    heap: heapBytes,
    index: indexBytes,
    total: heapBytes + indexBytes,
    indexCount: indexSpecs.length,
  });
}

db.close();

// --- Report ----------------------------------------------------------------

rows.sort((a, b) => b.total - a.total);

const totalEstimate = rows.reduce((sum, r) => sum + r.total, 0);
const totalRows = rows.reduce((sum, r) => sum + r.rows, 0);

console.log('');
console.log('ESTIMASI UKURAN DI POSTGRES (SUPABASE)');
console.log(`Sumber   : ${DB_PATH}`);
console.log(`File .db : ${formatBytes(fileBytes)}  (${rows.length} tabel, ${totalRows.toLocaleString('id-ID')} baris)`);
console.log('');

const W = [30, 12, 12, 12, 12];
console.log(
  pad('Tabel', W[0]) + pad('Baris', W[1], true) + pad('Data', W[2], true) +
  pad('Index', W[3], true) + pad('Total', W[4], true),
);
console.log('-'.repeat(W.reduce((a, b) => a + b, 0)));

for (const r of rows) {
  if (r.rows === 0 && r.total < 1024) continue; // sembunyikan tabel kosong
  console.log(
    pad(r.table, W[0]) +
    pad(r.rows.toLocaleString('id-ID'), W[1], true) +
    pad(formatBytes(r.heap), W[2], true) +
    pad(formatBytes(r.index), W[3], true) +
    pad(formatBytes(r.total), W[4], true),
  );
}

console.log('-'.repeat(W.reduce((a, b) => a + b, 0)));
console.log(
  pad('TOTAL', W[0]) +
  pad(totalRows.toLocaleString('id-ID'), W[1], true) +
  pad(formatBytes(rows.reduce((s, r) => s + r.heap, 0)), W[2], true) +
  pad(formatBytes(rows.reduce((s, r) => s + r.index, 0)), W[3], true) +
  pad(formatBytes(totalEstimate), W[4], true),
);

// The model is an approximation, so report a band rather than a false-precision number.
const low = totalEstimate * 0.85;
const high = totalEstimate * 1.25;
const pct = (totalEstimate / FREE_TIER_BYTES) * 100;

console.log('');
console.log(`Perkiraan wajar : ${formatBytes(low)} – ${formatBytes(high)}`);
console.log(`Kuota gratis    : ${formatBytes(FREE_TIER_BYTES)}  (perkiraan tengah memakai ${pct.toFixed(0)}%)`);
console.log('');

if (high < FREE_TIER_BYTES * 0.7) {
  console.log('PUTUSAN: MUAT. Free tier cukup, masih ada ruang tumbuh yang lega.');
} else if (totalEstimate < FREE_TIER_BYTES) {
  console.log('PUTUSAN: MUAT, TAPI MEPET. Batas atas perkiraan sudah menyentuh kuota.');
  console.log('         Cache rekomendasi AI terus bertambah, jadi ruang ini akan termakan.');
} else {
  console.log('PUTUSAN: TIDAK MUAT di free tier. Perlu paket Pro, atau pangkas dulu datanya.');
}

console.log('');
console.log('Catatan: angka di atas hasil pemodelan (header baris 24 B + line pointer 4 B,');
console.log('padding 8 B, index B-tree terisi ~70%, primary key ikut dihitung), bukan hasil');
console.log('impor sungguhan. Anggap sebagai pemandu keputusan, bukan angka final.');
console.log('');
