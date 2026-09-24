import fs from 'node:fs';
import XLSX from 'xlsx';
import { db } from '../db.js';
import { parseSheet, parseCoordinate } from '../lib/excel-parse.js';
import { categorizeSektor } from '../lib/categorize.js';

const EKO_PATH = process.env.EKONOMI_XLSX || 'C:\\Users\\doryt\\Downloads\\ekonomi.xlsx';
const RAW_PATH = process.env.RAW_XLSX || 'C:\\Users\\doryt\\Downloads\\row data ID Aplikasi final kirim.xlsx';
// A separately-sourced, address-geocoded coordinate list (one row per desa,
// used originally for Posyandu/SPM mapping) - covers all 1,871 desa with
// status_geocode=OK, verified 2026-09-24 against the free-text "Titik
// Koordinat Desa" parse: fills all 445 desa that parse couldn't cover AND
// disagrees by >5km on ~300 of the desa the parse DID cover (i.e. the old
// parse was wrong there, not just imprecise). Optional file - if missing,
// import falls back to the free-text parse alone like before.
const KOORDINAT_CSV_PATH = process.env.KOORDINAT_DESA_CSV || 'C:\\Users\\doryt\\Downloads\\Posyandu 6 SPM - MW.csv';
const TAHUN = 2026;

const IDENTITY_RE = /^(kode desa|provinsi|kabupaten|kecamatan|^desa$|nama desa|tanggal upload kuesioner)$/i;

function isIdentityHeader(h) {
  return IDENTITY_RE.test(h.trim());
}

// The master 'rekap' sheet has one bare-name marker column per Permendesa
// 9/2024 dimension (e.g. a column literally header "SOSIAL"), immediately
// followed by that dimension's "SUB-DIMENSI ..." marker columns - the same
// convention already used for sub-dimensi, one level up. ekonomi.xlsx is a
// column-subset of this same sheet, filtered to EKONOMI only.
const DIMENSI_MARKERS = new Set([
  'LAYANAN DASAR',
  'SOSIAL',
  'EKONOMI',
  'LINGKUNGAN',
  'AKSESIBILITAS',
  'TATA KELOLA PEMERINTAHAN DESA',
]);

// Composite result columns at the end of the sheet (STATUS DESA, NILAI ID
// 2026, ...) are Kemendes's own final output, not per-indicator scores -
// excluded from skor_indikator and read separately for the desa row instead.
const SUMMARY_EXCLUDE_RE = /^(status desa|nilai 2025|nilai id 2026|perkembangan|tingkat naik\/ turun status|cek)$/i;

// 'Rekap Tambahan' bundles KDMP/Koperasi/BUM Desa fields together with
// Kerentanan Sosial (poverty deciles) and Kehutanan (forest zoning) columns
// that share the sheet but aren't "ekosistem ekonomi" in nature - excluded
// here so the ekosistem_desa table stays scoped to what the module is about.
const EKOSISTEM_EXCLUDE_RE = /desil|SKTM|Surat Keterangan Tidak Mampu|Hutan|Kawasan Hutan/i;

// Minimal quoted-field CSV line parser (KOORDINAT_CSV_PATH's label_wilayah
// column embeds commas inside quotes) - no need for a full CSV library for
// one small, simple source file.
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function logImport(sumber, sheet, jumlah) {
  db.prepare(
    'INSERT INTO import_log (sumber_file, sheet, waktu_import, jumlah_baris) VALUES (?, ?, ?, ?)'
  ).run(sumber, sheet, new Date().toISOString(), jumlah);
  console.log(`  -> ${sheet}: ${jumlah} baris`);
}

console.log('Membaca file sumber...');
console.log(`  ekonomi.xlsx: ${EKO_PATH}`);
console.log(`  raw:          ${RAW_PATH}`);
const wbEko = XLSX.readFile(EKO_PATH);
const wbRaw = XLSX.readFile(RAW_PATH);
console.log('Selesai membaca. Memproses sheet...');

// users/kode_registrasi reference desa(kode_desa) via FK (added after this
// script was first written) - re-import deletes and re-inserts the SAME
// kode_desa set, so FK checks are safely disabled for the duration rather
// than needing a full CASCADE that would also wipe operator accounts.
db.exec('PRAGMA foreign_keys = OFF;');
db.exec('BEGIN');
try {
  db.exec(
    'DELETE FROM skor_indikator; DELETE FROM jawaban_kuesioner; ' +
    'DELETE FROM potensi_desa; DELETE FROM ekosistem_desa; ' +
    'DELETE FROM import_log; DELETE FROM desa;'
  );

  // ---- 1. desa (identitas) dari raw 'rekap' ----
  const rekapRaw = parseSheet(wbRaw.Sheets['rekap']);
  const idxKab = rekapRaw.headers.findIndex((h) => /^kabupaten$/i.test(h));
  const idxKec = rekapRaw.headers.findIndex((h) => /^kecamatan$/i.test(h));
  const idxKode = rekapRaw.kodeDesaIdx;
  const idxNama = rekapRaw.headers.findIndex((h) => /^nama desa$/i.test(h));
  const idxStatusFinal = rekapRaw.headers.findIndex((h) => /^status desa$/i.test(h));
  const idxStatusAwal = rekapRaw.headers.findIndex((h) => /^status id 2025$/i.test(h));
  const idxNilaiIndeks = rekapRaw.headers.findIndex((h) => /^nilai id 2026$/i.test(h));

  // koordinat GPS dari raw 'Rekap kuisioner 1' (tidak ada di versi ekonomi.xlsx yang sudah difilter)
  const kuisRaw = parseSheet(wbRaw.Sheets['Rekap kuisioner 1']);
  const idxKoord = kuisRaw.headers.findIndex((h) => /titik koordinat desa/i.test(h));
  const koordMap = new Map();
  if (idxKoord !== -1) {
    for (const row of kuisRaw.dataRows) {
      const kode = String(row[kuisRaw.kodeDesaIdx]).trim();
      const parsed = parseCoordinate(row[idxKoord]);
      if (parsed && !koordMap.has(kode)) koordMap.set(kode, parsed);
    }
  }

  // Address-geocoded coordinate CSV takes priority over the free-text parse
  // above wherever both exist (see KOORDINAT_CSV_PATH comment) - the parse
  // stays as a fallback for any desa the CSV doesn't cover.
  const csvKoordMap = new Map();
  if (fs.existsSync(KOORDINAT_CSV_PATH)) {
    const lines = fs.readFileSync(KOORDINAT_CSV_PATH, 'utf8').split(/\r?\n/).filter(Boolean);
    const csvHeader = parseCsvLine(lines[0]);
    const idIdx = csvHeader.indexOf('id_desa');
    const latIdx = csvHeader.indexOf('latitude');
    const lngIdx = csvHeader.indexOf('longitude');
    const statusIdx = csvHeader.indexOf('status_geocode');
    if (idIdx !== -1 && latIdx !== -1 && lngIdx !== -1) {
      for (const line of lines.slice(1)) {
        const cols = parseCsvLine(line);
        if (statusIdx !== -1 && cols[statusIdx] !== 'OK') continue;
        const lat = parseFloat(cols[latIdx]);
        const lng = parseFloat(cols[lngIdx]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) csvKoordMap.set(cols[idIdx].trim(), { lat, lng });
      }
    }
    console.log(`  -> koordinat CSV (${KOORDINAT_CSV_PATH}): ${csvKoordMap.size} desa`);
  } else {
    console.log(`  -> koordinat CSV tidak ditemukan di ${KOORDINAT_CSV_PATH}, pakai hasil parse teks bebas saja`);
  }

  let koordFound = 0;
  let koordFromCsv = 0;

  const insertDesa = db.prepare(
    'INSERT INTO desa (kode_desa, provinsi, kabupaten, kecamatan, nama_desa, status_desa, lat, lng, tahun, nilai_indeks_desa) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const seenKode = new Set();
  for (const row of rekapRaw.dataRows) {
    const kode = String(row[idxKode]).trim();
    if (seenKode.has(kode)) continue; // guard against stray duplicate rows
    seenKode.add(kode);
    const csvKoord = csvKoordMap.get(kode);
    const koord = csvKoord || koordMap.get(kode);
    if (csvKoord) koordFromCsv++;
    else if (koord) koordFound++;
    insertDesa.run(
      kode,
      'KALIMANTAN SELATAN',
      String(row[idxKab] ?? '').trim(),
      String(row[idxKec] ?? '').trim(),
      String(row[idxNama] ?? '').trim(),
      String(row[idxStatusFinal] ?? row[idxStatusAwal] ?? '').trim(),
      koord ? koord.lat : null,
      koord ? koord.lng : null,
      TAHUN,
      idxNilaiIndeks !== -1 ? toNumberOrNull(row[idxNilaiIndeks]) : null
    );
  }
  logImport('raw', 'rekap (identitas desa)', seenKode.size);
  console.log(`  -> koordinat dari CSV: ${koordFromCsv} desa, dari parse teks bebas (fallback): ${koordFound} desa`);

  // ---- 2. skor_indikator dari raw 'rekap' (6 dimensi Permendesa 9/2024 lengkap) ----
  // Sumber diganti dari ekonomi.xlsx (subset kolom Ekonomi saja) ke sheet
  // master yang sama dipakai untuk identitas desa di atas - lihat kamus data
  // "Catatan & Rekomendasi": ekonomi.xlsx adalah turunan kolom dari sheet ini.
  const insertSkor = db.prepare(
    'INSERT INTO skor_indikator (kode_desa, tahun, dimensi, sub_dimensi, nama_indikator, skor, bobot_maks) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  let skorCount = 0;
  for (const row of rekapRaw.dataRows) {
    const kode = String(row[rekapRaw.kodeDesaIdx]).trim();
    let dimensi = '';
    let subDimensi = '';
    for (let i = 0; i < rekapRaw.headers.length; i++) {
      const header = rekapRaw.headers[i];
      if (!header || isIdentityHeader(header) || SUMMARY_EXCLUDE_RE.test(header)) continue;
      if (DIMENSI_MARKERS.has(header.trim().toUpperCase())) {
        dimensi = header.trim();
        subDimensi = ''; // reset - a new dimension's own sub-dimensi marker comes next
      }
      if (/^sub-dimensi/i.test(header)) subDimensi = header;
      const skor = toNumberOrNull(row[i]);
      if (skor === null) continue;
      const bobot = toNumberOrNull(rekapRaw.weightRow[i]);
      insertSkor.run(kode, TAHUN, dimensi, subDimensi, header, skor, bobot);
      skorCount++;
    }
  }
  logImport('raw', 'rekap (skor indikator, 6 dimensi)', skorCount);

  // ---- 3. jawaban_kuesioner dari ekonomi.xlsx 'Rekap kuisioner 1' (blok Ekonomi) ----
  const kuisEko = parseSheet(wbEko.Sheets['Rekap kuisioner 1']);
  const insertJawaban = db.prepare(
    'INSERT INTO jawaban_kuesioner (kode_desa, tahun, pertanyaan, jawaban) VALUES (?, ?, ?, ?)'
  );
  let jawabanCount = 0;
  for (const row of kuisEko.dataRows) {
    const kode = String(row[kuisEko.kodeDesaIdx]).trim();
    for (let i = 0; i < kuisEko.headers.length; i++) {
      const header = kuisEko.headers[i];
      if (!header || isIdentityHeader(header)) continue;
      const val = row[i];
      if (val === null || val === undefined || String(val).trim() === '') continue;
      insertJawaban.run(kode, TAHUN, header, String(val).trim());
      jawabanCount++;
    }
  }
  logImport('ekonomi.xlsx', 'Rekap kuisioner 1 (jawaban)', jawabanCount);

  // ---- 4. potensi_desa dari raw 'Rekap Isu' (lengkap, dikategorikan per sektor) ----
  const isuRaw = parseSheet(wbRaw.Sheets['Rekap Isu']);
  const insertPotensi = db.prepare(
    'INSERT INTO potensi_desa (kode_desa, tahun, sektor, subsektor, nilai) VALUES (?, ?, ?, ?, ?)'
  );
  let potensiCount = 0;
  const sektorCache = new Map();
  for (const row of isuRaw.dataRows) {
    const kode = String(row[isuRaw.kodeDesaIdx]).trim();
    for (let i = 0; i < isuRaw.headers.length; i++) {
      const header = isuRaw.headers[i];
      if (!header || isIdentityHeader(header)) continue;
      const val = row[i];
      if (val === null || val === undefined || String(val).trim() === '') continue;
      let sektor = sektorCache.get(header);
      if (sektor === undefined) {
        sektor = categorizeSektor(header);
        sektorCache.set(header, sektor);
      }
      if (!sektor) continue; // kolom belum terkategori -> di luar cakupan v1 (lihat kamus data)
      insertPotensi.run(kode, TAHUN, sektor, header, String(val).trim());
      potensiCount++;
    }
  }
  logImport('raw', 'Rekap Isu (potensi desa)', potensiCount);

  // ---- 5. ekosistem_desa dari raw 'Rekap Tambahan' ----
  // 'Tambahan 2026' punya skema lebih baru (+ Kerentanan Sosial/Kehutanan) tapi
  // baru terisi ~6% (5.613/87.937 sel) - datanya belum dikumpulkan penuh.
  // 'Rekap Tambahan' terisi ~99.9% (74.839/74.840 sel), dipakai sebagai sumber v1.
  const tambahan = parseSheet(wbRaw.Sheets['Rekap Tambahan']);
  const insertEkosistem = db.prepare(
    'INSERT INTO ekosistem_desa (kode_desa, tahun, komponen, nilai) VALUES (?, ?, ?, ?)'
  );
  let ekosistemCount = 0;
  for (const row of tambahan.dataRows) {
    const kode = String(row[tambahan.kodeDesaIdx]).trim();
    for (let i = 0; i < tambahan.headers.length; i++) {
      const header = tambahan.headers[i];
      if (!header || isIdentityHeader(header) || EKOSISTEM_EXCLUDE_RE.test(header)) continue;
      const val = row[i];
      if (val === null || val === undefined || String(val).trim() === '') continue;
      insertEkosistem.run(kode, TAHUN, header, String(val).trim());
      ekosistemCount++;
    }
  }
  logImport('raw', 'Rekap Tambahan (ekosistem)', ekosistemCount);

  db.exec('COMMIT');
  console.log('\nImport selesai.');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('Import gagal, rollback:', err);
  process.exit(1);
} finally {
  db.exec('PRAGMA foreign_keys = ON;');
}
