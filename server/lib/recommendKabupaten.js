import { createHash } from 'node:crypto';
import { db } from '../db.js';
import { callLLM } from './llm.js';

const BUM_DESA_KOMPONEN = 'Status Pemeringkatan BUM Desa (Sesuai Keputusan Menteri Desa Nomor 145 Tahun 2022)';
const KDMP_KOMPONEN = 'Keberadaan Koperasi Desa Merah Putih di Desa';

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

function countBy(rows, normalize) {
  const out = {};
  for (const r of rows) {
    const key = normalize(r.nilai);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

// BUMDes exists to monetize potential or fix gaps - at kabupaten scale that
// becomes: how mature are the BUMDes overall (tier distribution), how many
// villages still lack basic economic institutions (KDMP), which sectors
// dominate the kabupaten's potential, and which specific villages combine
// high potential with low economic performance (computed deterministically,
// not left to the LLM to invent, so the village list is always accurate).
export function buildKabupatenContext(kabupaten) {
  const desaRows = db
    .prepare('SELECT kode_desa, nama_desa, kecamatan, status_desa FROM desa WHERE kabupaten = ?')
    .all(kabupaten);
  if (desaRows.length === 0) return null;

  const statusCount = {};
  for (const d of desaRows) statusCount[d.status_desa] = (statusCount[d.status_desa] || 0) + 1;

  const skorRows = db
    .prepare(
      `SELECT si.kode_desa, si.skor FROM skor_indikator si
       JOIN desa d ON d.kode_desa = si.kode_desa
       WHERE d.kabupaten = ? AND si.nama_indikator = 'EKONOMI'`
    )
    .all(kabupaten);
  const skorMap = new Map(skorRows.map((r) => [r.kode_desa, r.skor]));
  const avgSkor = skorRows.length ? skorRows.reduce((a, r) => a + r.skor, 0) / skorRows.length : null;

  const bumRows = db
    .prepare(
      `SELECT e.nilai FROM ekosistem_desa e JOIN desa d ON d.kode_desa = e.kode_desa
       WHERE d.kabupaten = ? AND e.komponen = ?`
    )
    .all(kabupaten, BUM_DESA_KOMPONEN);
  const bumTier = countBy(bumRows, normalizeBumTier);

  const kdmpRows = db
    .prepare(
      `SELECT e.nilai FROM ekosistem_desa e JOIN desa d ON d.kode_desa = e.kode_desa
       WHERE d.kabupaten = ? AND e.komponen = ?`
    )
    .all(kabupaten, KDMP_KOMPONEN);
  const kdmpStatus = countBy(kdmpRows, normalizeKdmp);

  const sektorRows = db
    .prepare(
      `SELECT p.sektor, COUNT(DISTINCT p.kode_desa) n FROM potensi_desa p
       JOIN desa d ON d.kode_desa = p.kode_desa
       WHERE d.kabupaten = ? AND p.nilai = 'Ada'
       GROUP BY p.sektor ORDER BY n DESC`
    )
    .all(kabupaten);

  const potensiCountRows = db
    .prepare(
      `SELECT p.kode_desa, COUNT(DISTINCT p.sektor) n FROM potensi_desa p
       JOIN desa d ON d.kode_desa = p.kode_desa
       WHERE d.kabupaten = ? AND p.nilai = 'Ada'
       GROUP BY p.kode_desa`
    )
    .all(kabupaten);
  const potensiMap = new Map(potensiCountRows.map((r) => [r.kode_desa, r.n]));

  const median = (arr) => {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const potensiMedian = median([...potensiMap.values()]);
  const skorMedian = median([...skorMap.values()]);

  // "Priority" = at/above median potential but below median performance -
  // the same Kuadran II logic as the province-wide Analisis Kuadran page,
  // scoped to this kabupaten.
  const priorityDesa = desaRows
    .map((d) => ({ ...d, potensi: potensiMap.get(d.kode_desa) || 0, skor: skorMap.get(d.kode_desa) ?? null }))
    .filter((d) => d.skor !== null && d.potensi >= potensiMedian && d.skor < skorMedian)
    .sort((a, b) => b.potensi - a.potensi || a.skor - b.skor)
    .slice(0, 12);

  return {
    kabupaten,
    jumlahDesa: desaRows.length,
    statusCount,
    avgSkor,
    bumTier,
    kdmpStatus,
    sektorRows,
    priorityDesa,
  };
}

function buildPrompt(ctx) {
  const { kabupaten, jumlahDesa, statusCount, avgSkor, bumTier, kdmpStatus, sektorRows, priorityDesa } = ctx;

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

  return `Kamu adalah penasihat kebijakan pengembangan ekonomi desa untuk Dinas Pemberdayaan Masyarakat dan Desa (DPMD) Kalimantan Selatan, menganalisis satu kabupaten untuk pimpinan dinas.

KABUPATEN: ${kabupaten}
Jumlah desa: ${jumlahDesa}
Rata-rata skor Dimensi Ekonomi: ${avgSkor !== null ? avgSkor.toFixed(1) : '-'}

DISTRIBUSI STATUS DESA:
${statusText}

KONDISI BUM DESA (pemeringkatan sesuai Kepmendes 145/2022):
${bumText}

KONDISI KOPERASI DESA MERAH PUTIH (KDMP):
${kdmpText}

SEKTOR POTENSI EKONOMI TERBANYAK DI KABUPATEN INI:
${sektorText}

DESA PRIORITAS (potensi ekonomi tinggi namun skor kinerja ekonomi masih rendah - kandidat utama intervensi, daftar ini sudah dihitung, jangan mengubah/menambah nama desa):
${priorityText}

Tugas: buat analisis kondisi BUM Desa dan rekomendasi strategis tingkat KABUPATEN (bukan per-desa) untuk DPMD. Rekomendasi harus berupa kebijakan/program tingkat kabupaten (pembinaan, pendampingan, alokasi anggaran, prioritas wilayah), bukan saran bisnis satu desa.

Jawab HANYA dengan JSON valid (tanpa markdown code fence, tanpa teks lain di luar JSON), dengan skema persis:
{
  "ringkasan": "2-3 kalimat ringkasan kondisi ekonomi desa se-kabupaten ini",
  "kondisi_bumdes": "2-3 kalimat analisis kondisi BUM Desa dan KDMP se-kabupaten - sebutkan proporsi yang masih Perintis/belum berbadan hukum sebagai area perhatian jika relevan",
  "rekomendasi": [
    {
      "judul": "judul program/kebijakan tingkat kabupaten",
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
  });
  return createHash('sha256').update(stable).digest('hex');
}

export async function getRekomendasiKabupaten(kabupaten, { forceRefresh = false } = {}) {
  const ctx = buildKabupatenContext(kabupaten);
  if (!ctx) return { notFound: true };

  const inputHash = hashContext(ctx);

  if (!forceRefresh) {
    const cached = db
      .prepare(
        `SELECT rekomendasi_json, model, dibuat_pada FROM rekomendasi_kabupaten
         WHERE kabupaten = ? AND input_hash = ? ORDER BY id DESC LIMIT 1`
      )
      .get(kabupaten, inputHash);
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
  ).run(kabupaten, inputHash, model, JSON.stringify(result), new Date().toISOString());

  return { ...result, ringkasanData: ctx, cached: false, model, dibuatPada: new Date().toISOString() };
}
