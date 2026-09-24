import { createHash } from 'node:crypto';
import { db } from '../db.js';
import { callLLM } from './llm.js';

const DIMENSI_LABEL = {
  'LAYANAN DASAR': 'Layanan Dasar',
  SOSIAL: 'Sosial',
  EKONOMI: 'Ekonomi',
  LINGKUNGAN: 'Lingkungan',
  AKSESIBILITAS: 'Aksesibilitas',
  'TATA KELOLA PEMERINTAHAN DESA': 'Tata Kelola Pemerintahan Desa',
};
const DIMENSI_ORDER = Object.keys(DIMENSI_LABEL);

export const DIMENSI_KEYS = new Set(DIMENSI_ORDER);

const RINGKASAN_KEY = 'RINGKASAN';
const GAP_THRESHOLD = 0.6;
// More room for detail when scoped to a single dimension than when
// summarizing all 6 at once - same convention as lib/narasiIndeks.js.
const GAP_LIMIT_SATU = 8;
const GAP_LIMIT_ALL = 3;

// Same "rule engine produces facts, AI only explains" principle as
// recommend.js. Both modes resolve to the same `dims` shape (an array of
// {dimensi, label, komposit, gap}) so buildPrompt/hashContext don't need to
// branch - per-dimensi mode is just a 1-element version of the overall
// mode's 6-element array.
function buildContext(kode, dimensi) {
  const desa = db.prepare('SELECT * FROM desa WHERE kode_desa = ?').get(kode);
  if (!desa) return null;

  if (dimensi) {
    const rows = db
      .prepare(
        `SELECT nama_indikator, skor, bobot_maks FROM skor_indikator
         WHERE kode_desa = ? AND dimensi = ? ORDER BY id`
      )
      .all(kode, dimensi);

    const komposit = rows.find((r) => r.nama_indikator === dimensi) || null;
    const gap = rows
      .filter((r) => /^SKOR /i.test(r.nama_indikator) && r.bobot_maks)
      .map((r) => ({ ...r, ratio: r.skor / r.bobot_maks }))
      .filter((r) => r.ratio < GAP_THRESHOLD)
      .sort((a, b) => a.ratio - b.ratio)
      .slice(0, GAP_LIMIT_SATU);

    return {
      desa,
      dimensi,
      dims: [{ dimensi, label: DIMENSI_LABEL[dimensi], komposit, gap }],
      potensiSektor: [],
    };
  }

  const indeksDimensi = db
    .prepare(`SELECT dimensi, skor, bobot_maks FROM skor_indikator WHERE kode_desa = ? AND nama_indikator = dimensi ORDER BY id`)
    .all(kode);

  const allIndikator = db
    .prepare(
      `SELECT dimensi, nama_indikator, skor, bobot_maks FROM skor_indikator
       WHERE kode_desa = ? AND nama_indikator LIKE 'SKOR %' AND bobot_maks > 0`
    )
    .all(kode);
  const gapByDim = {};
  for (const r of allIndikator) {
    const ratio = r.skor / r.bobot_maks;
    if (ratio >= GAP_THRESHOLD) continue;
    (gapByDim[r.dimensi] ||= []).push({ ...r, ratio });
  }
  for (const d of Object.keys(gapByDim)) {
    gapByDim[d].sort((a, b) => a.ratio - b.ratio);
    gapByDim[d] = gapByDim[d].slice(0, GAP_LIMIT_ALL);
  }

  const dims = DIMENSI_ORDER.filter((d) => indeksDimensi.some((r) => r.dimensi === d)).map((d) => ({
    dimensi: d,
    label: DIMENSI_LABEL[d],
    komposit: indeksDimensi.find((r) => r.dimensi === d),
    gap: gapByDim[d] || [],
  }));

  const potensiSektor = db
    .prepare(`SELECT DISTINCT sektor FROM potensi_desa WHERE kode_desa = ? AND nilai = 'Ada' ORDER BY sektor`)
    .all(kode)
    .map((r) => r.sektor);

  return { desa, dimensi: null, dims, potensiSektor };
}

function buildPrompt(ctx) {
  const { desa } = ctx;
  const header = `Data Desa ${desa.nama_desa} (Kecamatan ${desa.kecamatan}, Kabupaten ${desa.kabupaten}), status desa: ${desa.status_desa}.`;

  const dimsText = ctx.dims
    .map((d) => {
      const pct = d.komposit?.bobot_maks ? Math.round((d.komposit.skor / d.komposit.bobot_maks) * 100) : null;
      const skorText = d.komposit
        ? `skor ${d.komposit.skor}/${d.komposit.bobot_maks}${pct !== null ? ` (${pct}%)` : ''}`
        : 'skor tidak tersedia';
      const gapText = d.gap.length
        ? d.gap.map((g) => `${g.nama_indikator.replace(/^SKOR /i, '')} (${g.skor}/${g.bobot_maks})`).join('; ')
        : '(tidak ada indikator di bawah 60%)';
      return `- ${d.label}: ${skorText}. Indikator terlemah: ${gapText}`;
    })
    .join('\n');

  const potensiText = ctx.dimensi
    ? ''
    : `\n\nSEKTOR POTENSI EKONOMI YANG TERCATAT: ${ctx.potensiSektor.length ? ctx.potensiSektor.join(', ') : '(tidak ada potensi sektor tercatat)'}`;

  const tugas = ctx.dimensi
    ? `Tugas: analisis kondisi dimensi ${ctx.dims[0].label} desa ini secara ringkas, dan berikan rekomendasi kegiatan/aktivitas konkret yang bisa dilaksanakan pemerintah desa/DPMD untuk meningkatkan indikator yang masih lemah pada dimensi ini.`
    : `Tugas: analisis kondisi desa ini SECARA MENYELURUH (ke-6 dimensi) secara ringkas, dan berikan rekomendasi kegiatan/aktivitas konkret yang bisa dilaksanakan pemerintah desa/DPMD untuk meningkatkan dimensi yang masih lemah.`;

  return `Kamu adalah asisten analisis pembangunan desa untuk Dinas Pemberdayaan Masyarakat dan Desa (DPMD) Kalimantan Selatan.

${header}

${dimsText}${potensiText}

${tugas} Setiap rekomendasi harus mengacu spesifik ke indikator terlemah yang disebutkan di atas - jangan mengarang data atau menyebut indikator yang tidak ada di atas. Bahasa lugas, mudah dipahami staf desa/DPMD.

Jawab HANYA dengan JSON valid (tanpa markdown code fence, tanpa teks lain di luar JSON), skema persis:
{
  "analisis": "3-5 kalimat analisis kondisi - sebutkan bagian mana yang paling kuat dan paling perlu perhatian",
  "rekomendasi": [
    { "dimensi": "nama dimensi (persis seperti di atas)", "aktivitas": "1 kalimat kegiatan konkret yang bisa dilaksanakan", "alasan": "1 kalimat, sebutkan indikator spesifik yang mendasari rekomendasi ini" }
  ]
}
Berikan 3-6 item rekomendasi, prioritaskan indikator dengan skor/persentase paling rendah.`;
}

function hashContext(ctx) {
  const stable = JSON.stringify({
    dimensi: ctx.dimensi,
    dims: ctx.dims.map((d) => `${d.dimensi}:${d.komposit?.skor}/${d.komposit?.bobot_maks}:${d.gap.map((g) => g.nama_indikator).join(',')}`),
    potensi: ctx.dimensi ? null : [...ctx.potensiSektor].sort(),
  });
  return createHash('sha256').update(stable).digest('hex');
}

export async function getNarasiDesa(kode, dimensi, { forceRefresh = false } = {}) {
  const ctx = buildContext(kode, dimensi || null);
  if (!ctx) return { notFound: true };

  const dimensiKey = dimensi || RINGKASAN_KEY;
  const inputHash = hashContext(ctx);

  if (!forceRefresh) {
    const cached = db
      .prepare(
        `SELECT narasi, model, dibuat_pada FROM narasi_desa
         WHERE kode_desa = ? AND dimensi = ? AND input_hash = ? ORDER BY id DESC LIMIT 1`
      )
      .get(kode, dimensiKey, inputHash);
    if (cached) {
      return { ...JSON.parse(cached.narasi), cached: true, model: cached.model, dibuatPada: cached.dibuat_pada };
    }
  }

  const prompt = buildPrompt(ctx);
  const { result, model } = await callLLM(prompt);

  const dibuatPada = new Date().toISOString();
  db.prepare(
    `INSERT INTO narasi_desa (kode_desa, dimensi, input_hash, model, narasi, dibuat_pada)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(kode, dimensiKey, inputHash, model, JSON.stringify(result), dibuatPada);

  return { ...result, cached: false, model, dibuatPada };
}
