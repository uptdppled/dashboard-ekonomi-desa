import { createHash } from 'node:crypto';
import { db } from '../db.js';
import { callLLM } from './llm.js';
import { listPrioritasDesa } from './kuadran.js';

const BUM_DESA_KOMPONEN = 'Status Pemeringkatan BUM Desa (Sesuai Keputusan Menteri Desa Nomor 145 Tahun 2022)';
const KDMP_KOMPONEN = 'Keberadaan Koperasi Desa Merah Putih di Desa';
const PROVINSI_LABEL = 'Provinsi Kalimantan Selatan';

// Sentinel stored in rekomendasi_kabupaten.kabupaten (NOT NULL) to represent
// the province-wide scope, so the existing per-kabupaten cache table/columns
// can be reused without a schema migration.
export const PROVINSI_SENTINEL = '__PROVINSI__';

// Source data has inconsistent casing ("Perintis" vs "perintis") from
// free-text field entry - normalize to the official Kepmendes 145/2022 tier
// labels before aggregating, otherwise the same tier gets split into
// multiple buckets in the count.
function normalizeBumTier(v) {
  const s = (v || '').trim().toLowerCase();
  if (s === 'perintis') return 'Perintis';
  if (s === 'pemula') return 'Pemula';
  if (s === 'berkembang') return 'Berkembang';
  if (s === 'maju') return 'Maju';
  if (s === 'tidak ikut pemeringkatan') return 'Tidak Ikut Pemeringkatan';
  return (v || '').trim() || 'Tidak Diketahui';
}

function normalizeKdmp(v) {
  const s = (v || '').trim().toLowerCase();
  if (/tidak ada/.test(s)) return 'Tidak Ada';
  if (/belum berbadan hukum/.test(s)) return 'Ada, Belum Berbadan Hukum';
  if (/sudah berbadan hukum/.test(s)) return 'Ada, Sudah Berbadan Hukum';
  return (v || '').trim() || 'Tidak Diketahui';
}

// Drill-down for the "Kondisi BUM Desa"/"Kondisi KDMP" bar charts - same
// scoping and normalization as buildKabupatenContext's bumTier/kdmpStatus
// aggregates above, but returning the desa list for one specific bar
// instead of just the count.
export function listDesaByBumTier(kabupaten, tier) {
  const scoped = kabupaten != null;
  const kabWhereAnd = scoped ? 'AND d.kabupaten = ?' : '';
  const args = scoped ? [kabupaten] : [];
  const rows = db
    .prepare(
      `SELECT e.kode_desa, e.nilai, d.nama_desa, d.kecamatan, d.kabupaten, d.status_desa
       FROM ekosistem_desa e JOIN desa d ON d.kode_desa = e.kode_desa
       WHERE e.komponen = ? ${kabWhereAnd}`
    )
    .all(BUM_DESA_KOMPONEN, ...args);
  return rows
    .filter((r) => normalizeBumTier(r.nilai) === tier)
    .map((r) => ({ kode_desa: r.kode_desa, nama_desa: r.nama_desa, kecamatan: r.kecamatan, kabupaten: r.kabupaten, status_desa: r.status_desa }));
}

export function listDesaByKdmpStatus(kabupaten, status) {
  const scoped = kabupaten != null;
  const kabWhereAnd = scoped ? 'AND d.kabupaten = ?' : '';
  const args = scoped ? [kabupaten] : [];
  const rows = db
    .prepare(
      `SELECT e.kode_desa, e.nilai, d.nama_desa, d.kecamatan, d.kabupaten, d.status_desa
       FROM ekosistem_desa e JOIN desa d ON d.kode_desa = e.kode_desa
       WHERE e.komponen = ? ${kabWhereAnd}`
    )
    .all(KDMP_KOMPONEN, ...args);
  return rows
    .filter((r) => normalizeKdmp(r.nilai) === status)
    .map((r) => ({ kode_desa: r.kode_desa, nama_desa: r.nama_desa, kecamatan: r.kecamatan, kabupaten: r.kabupaten, status_desa: r.status_desa }));
}

function countBy(rows, normalize) {
  const out = {};
  for (const r of rows) {
    const key = normalize(r.nilai);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

// A village's BUM Desa legal-registration answer is free text - most rows
// are placeholders ("-", "_", "0", "Tidak Ada"). Treat it as a real AHU
// registration number/code only if it contains "AHU" or a long digit run
// (>=10 digits once separators are stripped), which placeholders never have.
function looksLikeBadanHukum(v) {
  if (!v) return false;
  const s = v.replace(/["']/g, '').trim();
  if (!s) return false;
  if (/ahu/i.test(s)) return true;
  const digitsOnly = s.replace(/[^0-9]/g, '');
  return digitsOnly.length >= 10;
}

function parseHariOperasional(v) {
  const n = Number((v || '').trim());
  return Number.isFinite(n) && n > 0 && n <= 7 ? n : null;
}

// BUMDes exists to monetize potential or fix gaps - at kabupaten (or
// province-wide, when kabupaten is null) scale that becomes: how mature are
// the BUMDes overall (tier distribution), how many are legally registered
// and how often they operate, how many villages still lack basic economic
// institutions (KDMP), which sectors dominate, and which specific villages
// combine high potential with low economic performance (computed
// deterministically, not left to the LLM to invent, so the village list is
// always accurate).
export function buildKabupatenContext(kabupaten) {
  const scoped = kabupaten != null;
  const kabWhere = scoped ? 'WHERE d.kabupaten = ?' : '';
  const kabWhereAnd = scoped ? 'AND d.kabupaten = ?' : '';
  const args = scoped ? [kabupaten] : [];

  const desaRows = db
    .prepare(`SELECT kode_desa, nama_desa, kecamatan, kabupaten, status_desa FROM desa d ${kabWhere}`)
    .all(...args);
  if (desaRows.length === 0) return null;

  const statusCount = {};
  for (const d of desaRows) statusCount[d.status_desa] = (statusCount[d.status_desa] || 0) + 1;

  const skorRows = db
    .prepare(
      `SELECT si.kode_desa, si.skor FROM skor_indikator si
       JOIN desa d ON d.kode_desa = si.kode_desa
       WHERE si.nama_indikator = 'EKONOMI' ${kabWhereAnd}`
    )
    .all(...args);
  const skorMap = new Map(skorRows.map((r) => [r.kode_desa, r.skor]));
  const avgSkor = skorRows.length ? skorRows.reduce((a, r) => a + r.skor, 0) / skorRows.length : null;

  const bumRows = db
    .prepare(
      `SELECT e.kode_desa, e.nilai FROM ekosistem_desa e JOIN desa d ON d.kode_desa = e.kode_desa
       WHERE e.komponen = ? ${kabWhereAnd}`
    )
    .all(BUM_DESA_KOMPONEN, ...args);
  const bumTier = countBy(bumRows, normalizeBumTier);
  const bumTierByDesa = new Map(bumRows.map((r) => [r.kode_desa, normalizeBumTier(r.nilai)]));
  const isAktif = (t) => t && t !== 'Tidak Ikut Pemeringkatan' && t !== 'Tidak Diketahui';
  const desaBumDesaAktif = bumRows.filter((r) => isAktif(normalizeBumTier(r.nilai))).length;
  const desaInfo = (d) => ({ kode_desa: d.kode_desa, nama_desa: d.nama_desa, kecamatan: d.kecamatan, kabupaten: d.kabupaten });
  const daftarTidakAktifBumdes = desaRows
    .filter((d) => !isAktif(bumTierByDesa.get(d.kode_desa)))
    .map(desaInfo);

  const kdmpRows = db
    .prepare(
      `SELECT e.nilai FROM ekosistem_desa e JOIN desa d ON d.kode_desa = e.kode_desa
       WHERE e.komponen = ? ${kabWhereAnd}`
    )
    .all(KDMP_KOMPONEN, ...args);
  const kdmpStatus = countBy(kdmpRows, normalizeKdmp);

  // Legal-entity status + operational days both live in the free-text
  // jawaban_kuesioner table, keyed by question text, one row per village per
  // question (main BUM Desa + the joint "Bersama" variant).
  const bumJawabanRows = db
    .prepare(
      `SELECT j.kode_desa, j.pertanyaan, j.jawaban FROM jawaban_kuesioner j
       JOIN desa d ON d.kode_desa = j.kode_desa
       WHERE j.pertanyaan IN (
         'Nomor sertifikat BUM Desa tersebut',
         'Nomor sertifikat BUM Desa Bersama tersebut',
         'Hari Operasional BUM Desa',
         'Hari Operasional BUM Desa Bersama'
       ) ${kabWhereAnd}`
    )
    .all(...args);

  const badanHukumDesa = new Set();
  const hariOperasionalByDesa = new Map();
  for (const r of bumJawabanRows) {
    if (r.pertanyaan.startsWith('Nomor sertifikat') && looksLikeBadanHukum(r.jawaban)) {
      badanHukumDesa.add(r.kode_desa);
    }
    if (r.pertanyaan.startsWith('Hari Operasional')) {
      const hari = parseHariOperasional(r.jawaban);
      if (hari !== null && !hariOperasionalByDesa.has(r.kode_desa)) {
        hariOperasionalByDesa.set(r.kode_desa, hari);
      }
    }
  }
  const desaBerbadanHukum = badanHukumDesa.size;
  const daftarBelumBerbadanHukum = desaRows.filter((d) => !badanHukumDesa.has(d.kode_desa)).map(desaInfo);
  const hariOperasionalValues = [...hariOperasionalByDesa.values()];
  const hariOperasionalAvg = hariOperasionalValues.length
    ? hariOperasionalValues.reduce((a, n) => a + n, 0) / hariOperasionalValues.length
    : null;

  const sektorRows = db
    .prepare(
      `SELECT p.sektor, COUNT(DISTINCT p.kode_desa) n FROM potensi_desa p
       JOIN desa d ON d.kode_desa = p.kode_desa
       WHERE p.nilai = 'Ada' ${kabWhereAnd}
       GROUP BY p.sektor ORDER BY n DESC`
    )
    .all(...args);

  const potensiCountRows = db
    .prepare(
      `SELECT p.kode_desa, COUNT(DISTINCT p.sektor) n FROM potensi_desa p
       JOIN desa d ON d.kode_desa = p.kode_desa
       WHERE p.nilai = 'Ada' ${kabWhereAnd}
       GROUP BY p.kode_desa`
    )
    .all(...args);
  const potensiMap = new Map(potensiCountRows.map((r) => [r.kode_desa, r.n]));

  // "Priority" = kuadran II (at/above median potential, below median
  // performance) - the same shared definition the province-wide Analisis
  // Kuadran page uses, scoped to this kabupaten (or the whole province).
  const priorityDesa = listPrioritasDesa(
    desaRows
      .map((d) => ({ ...d, potensi: potensiMap.get(d.kode_desa) || 0, skor: skorMap.get(d.kode_desa) ?? null }))
      .filter((d) => d.skor !== null)
  );

  return {
    kabupaten: scoped ? kabupaten : null,
    label: scoped ? kabupaten : PROVINSI_LABEL,
    isProvinsi: !scoped,
    jumlahDesa: desaRows.length,
    statusCount,
    avgSkor,
    bumTier,
    kdmpStatus,
    sektorRows,
    priorityDesa,
    desaBerbadanHukum,
    desaBumDesaAktif,
    hariOperasionalAvg,
    daftarTidakAktifBumdes,
    daftarBelumBerbadanHukum,
  };
}

function buildPrompt(ctx) {
  const {
    label, isProvinsi, jumlahDesa, statusCount, avgSkor, bumTier, kdmpStatus, sektorRows, priorityDesa,
    desaBerbadanHukum, desaBumDesaAktif, hariOperasionalAvg,
  } = ctx;

  const statusText = Object.entries(statusCount)
    .map(([s, n]) => `- ${s}: ${n} desa`)
    .join('\n');

  const bumText = Object.entries(bumTier)
    .map(([tier, n]) => `- ${tier}: ${n} desa`)
    .join('\n') || '(tidak ada data pemeringkatan BUM Desa)';

  const kdmpText = Object.entries(kdmpStatus)
    .map(([s, n]) => `- ${s}: ${n} desa`)
    .join('\n') || '(tidak ada data KDMP)';

  const sektorText = sektorRows.map((s) => `- ${s.sektor}: ${s.n} desa`).join('\n');

  const priorityText = priorityDesa
    .map((d) => `- ${d.nama_desa} (Kec. ${d.kecamatan}): ${d.potensi} sektor potensi, skor ekonomi ${d.skor}`)
    .join('\n') || '(tidak ada desa yang menonjol sebagai prioritas)';

  const wilayahLine = isProvinsi ? `WILAYAH: ${label} (seluruh kabupaten)` : `KABUPATEN: ${label}`;

  return `Kamu adalah penasihat kebijakan pengembangan ekonomi desa untuk Dinas Pemberdayaan Masyarakat dan Desa (DPMD) Kalimantan Selatan, menganalisis ${isProvinsi ? 'seluruh provinsi' : 'satu kabupaten'} untuk pimpinan dinas.

${wilayahLine}
Jumlah desa: ${jumlahDesa}
Rata-rata skor Dimensi Ekonomi: ${avgSkor !== null ? avgSkor.toFixed(1) : '-'}
Jumlah BUM Desa aktif (ikut pemeringkatan): ${desaBumDesaAktif} dari ${jumlahDesa} desa
Jumlah BUM Desa berbadan hukum (punya nomor registrasi AHU): ${desaBerbadanHukum} dari ${jumlahDesa} desa
Rata-rata hari operasional BUM Desa: ${hariOperasionalAvg !== null ? hariOperasionalAvg.toFixed(1) : '-'} hari/minggu

DISTRIBUSI STATUS DESA:
${statusText}

KONDISI BUM DESA (pemeringkatan sesuai Kepmendes 145/2022):
${bumText}

KONDISI KOPERASI DESA MERAH PUTIH (KDMP):
${kdmpText}

SEKTOR POTENSI EKONOMI TERBANYAK:
${sektorText}

DESA PRIORITAS (potensi ekonomi tinggi namun skor kinerja ekonomi masih rendah - kandidat utama intervensi, daftar ini sudah dihitung, jangan mengubah/menambah nama desa):
${priorityText}

Tugas: buat analisis kondisi BUM Desa dan rekomendasi strategis tingkat ${isProvinsi ? 'PROVINSI' : 'KABUPATEN'} (bukan per-desa) untuk DPMD. Sebutkan proporsi BUM Desa yang belum berbadan hukum dan yang jarang beroperasi sebagai area perhatian jika relevan. Rekomendasi harus berupa kebijakan/program tingkat ${isProvinsi ? 'provinsi (lintas kabupaten)' : 'kabupaten'} (pembinaan, pendampingan, alokasi anggaran, prioritas wilayah), bukan saran bisnis satu desa.

Jawab HANYA dengan JSON valid (tanpa markdown code fence, tanpa teks lain di luar JSON), dengan skema persis:
{
  "ringkasan": "2-3 kalimat ringkasan kondisi ekonomi desa ${isProvinsi ? 'se-provinsi' : 'se-kabupaten'} ini",
  "kondisi_bumdes": "2-3 kalimat analisis kondisi BUM Desa dan KDMP - sebutkan proporsi yang masih Perintis/belum berbadan hukum/jarang beroperasi sebagai area perhatian jika relevan",
  "rekomendasi": [
    {
      "judul": "judul program/kebijakan",
      "kategori": "pembinaan_bumdes" | "infrastruktur" | "sdm" | "pemasaran" | "kebijakan_anggaran",
      "alasan": "1-2 kalimat, mengacu spesifik ke data di atas",
      "target": "kelompok desa yang disasar, mis. 'Desa dengan BUM Desa status Perintis' atau 'Desa prioritas di atas'"
    }
  ]
}`;
}

function hashContext(ctx) {
  const stable = JSON.stringify({
    statusCount: ctx.statusCount,
    bumTier: ctx.bumTier,
    kdmpStatus: ctx.kdmpStatus,
    sektor: ctx.sektorRows.map((s) => `${s.sektor}:${s.n}`),
    priority: ctx.priorityDesa.map((d) => d.kode_desa).sort(),
    desaBerbadanHukum: ctx.desaBerbadanHukum,
    desaBumDesaAktif: ctx.desaBumDesaAktif,
    hariOperasionalAvg: ctx.hariOperasionalAvg,
  });
  return createHash('sha256').update(stable).digest('hex');
}

// `kabupaten` is the real kabupaten name, or null for province-wide - the
// cache table column is NOT NULL, so the province scope is stored under
// PROVINSI_SENTINEL instead of an actual kabupaten name.
export async function getRekomendasiKabupaten(kabupaten, { forceRefresh = false } = {}) {
  const cacheKey = kabupaten == null ? PROVINSI_SENTINEL : kabupaten;
  const ctx = buildKabupatenContext(kabupaten);
  if (!ctx) return { notFound: true };

  const inputHash = hashContext(ctx);

  if (!forceRefresh) {
    const cached = db
      .prepare(
        `SELECT rekomendasi_json, model, dibuat_pada FROM rekomendasi_kabupaten
         WHERE kabupaten = ? AND input_hash = ? ORDER BY id DESC LIMIT 1`
      )
      .get(cacheKey, inputHash);
    if (cached) {
      return {
        ...JSON.parse(cached.rekomendasi_json),
        ringkasanData: ctx,
        cached: true,
        model: cached.model,
        dibuatPada: cached.dibuat_pada,
      };
    }
  }

  const prompt = buildPrompt(ctx);
  const { result, model } = await callLLM(prompt);

  db.prepare(
    `INSERT INTO rekomendasi_kabupaten (kabupaten, input_hash, model, rekomendasi_json, dibuat_pada)
     VALUES (?, ?, ?, ?, ?)`
  ).run(cacheKey, inputHash, model, JSON.stringify(result), new Date().toISOString());

  return { ...result, ringkasanData: ctx, cached: false, model, dibuatPada: new Date().toISOString() };
}
