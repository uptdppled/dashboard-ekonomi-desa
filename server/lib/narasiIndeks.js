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
const GAP_THRESHOLD = 0.6;
// More room for detail when scoped to a single dimension (BANUA INDEX's
// per-dimension page) than when summarizing all 6 at once (Ringkasan page).
const GAP_PER_DIMENSI_ALL = 3;
const GAP_PER_DIMENSI_SATU = 8;

function scopeWhere(scope, alias = 'd') {
  const clauses = [];
  const params = [];
  if (scope.kabupaten) {
    clauses.push(`${alias}.kabupaten = ?`);
    params.push(scope.kabupaten);
  }
  if (scope.kecamatan) {
    clauses.push(`${alias}.kecamatan = ?`);
    params.push(scope.kecamatan);
  }
  if (scope.status) {
    clauses.push(`${alias}.status_desa = ?`);
    params.push(scope.status);
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export function scopeKey(scope) {
  return `${scope.dimensi || ''}|${scope.kabupaten || ''}|${scope.kecamatan || ''}|${scope.status || ''}`;
}

export function scopeLabel(scope) {
  const parts = [];
  if (scope.kabupaten) parts.push(`Kabupaten ${scope.kabupaten}`);
  if (scope.kecamatan) parts.push(`Kecamatan ${scope.kecamatan}`);
  if (scope.status) parts.push(`status desa ${scope.status}`);
  return parts.length ? parts.join(', ') : 'seluruh Kalimantan Selatan';
}

// Same shape as /api/indeks/ringkasan (avg skor per dimensi) plus, for each
// dimensi, its worst few leaf indicators - grounds the AI's recommendations
// in specific indicators rather than letting it invent generic advice.
function buildContext(scope) {
  const base = scopeWhere(scope);
  const totalDesa = db.prepare(`SELECT COUNT(*) AS n FROM desa d ${base.sql}`).get(...base.params).n;

  const single = scope.dimensi ? DIMENSI_ORDER.filter((d) => d === scope.dimensi) : DIMENSI_ORDER;
  const gapLimit = scope.dimensi ? GAP_PER_DIMENSI_SATU : GAP_PER_DIMENSI_ALL;
  const dimensiClause = scope.dimensi ? 'AND si.dimensi = ?' : '';
  const dimensiParam = scope.dimensi ? [scope.dimensi] : [];

  const dimensiFilter = scopeWhere(scope, 'd');
  const dimensiRows = db
    .prepare(
      `SELECT si.dimensi, AVG(si.skor) AS avgSkor, AVG(si.bobot_maks) AS avgBobot
       FROM skor_indikator si
       JOIN desa d ON d.kode_desa = si.kode_desa
       ${dimensiFilter.sql ? `${dimensiFilter.sql} AND` : 'WHERE'} si.nama_indikator = si.dimensi ${dimensiClause}
       GROUP BY si.dimensi`
    )
    .all(...dimensiFilter.params, ...dimensiParam);

  const indikatorFilter = scopeWhere(scope, 'd');
  const indikatorRows = db
    .prepare(
      `SELECT si.dimensi, si.sub_dimensi, si.nama_indikator, AVG(si.skor) AS avgSkor, AVG(si.bobot_maks) AS avgBobot
       FROM skor_indikator si
       JOIN desa d ON d.kode_desa = si.kode_desa
       ${indikatorFilter.sql ? `${indikatorFilter.sql} AND` : 'WHERE'} si.nama_indikator LIKE 'SKOR %' AND si.bobot_maks > 0 ${dimensiClause}
       GROUP BY si.dimensi, si.nama_indikator`
    )
    .all(...indikatorFilter.params, ...dimensiParam);

  const gapByDimensi = {};
  for (const r of indikatorRows) {
    const ratio = r.avgSkor / r.avgBobot;
    if (ratio >= GAP_THRESHOLD) continue;
    (gapByDimensi[r.dimensi] ||= []).push({
      indikator: r.nama_indikator.replace(/^SKOR /i, ''),
      subDimensi: (r.sub_dimensi || '').replace(/^SUB-DIMENSI /i, ''),
      avgSkor: Math.round(r.avgSkor * 100) / 100,
      avgBobot: r.avgBobot,
      ratio,
    });
  }
  for (const dimensi of Object.keys(gapByDimensi)) {
    gapByDimensi[dimensi].sort((a, b) => a.ratio - b.ratio);
    gapByDimensi[dimensi] = gapByDimensi[dimensi].slice(0, gapLimit);
  }

  const dimensi = single.filter((d) => dimensiRows.some((r) => r.dimensi === d)).map((d) => {
    const row = dimensiRows.find((r) => r.dimensi === d);
    return {
      dimensi: d,
      label: DIMENSI_LABEL[d],
      avgSkor: Math.round(row.avgSkor * 100) / 100,
      avgBobot: Math.round(row.avgBobot * 100) / 100,
      gap: gapByDimensi[d] || [],
    };
  });

  return { totalDesa, dimensi, single: !!scope.dimensi };
}

function buildPrompt(ctx, label) {
  const dimensiText = ctx.dimensi
    .map((d) => {
      const pct = d.avgBobot ? Math.round((d.avgSkor / d.avgBobot) * 100) : null;
      const gapText = d.gap.length
        ? d.gap.map((g) => `${g.subDimensi ? `[${g.subDimensi}] ` : ''}${g.indikator} (${g.avgSkor}/${g.avgBobot})`).join('; ')
        : '(tidak ada indikator dengan skor di bawah 60%)';
      return `- ${d.label}: skor rata-rata ${d.avgSkor}/${d.avgBobot}${pct !== null ? ` (${pct}%)` : ''}. Indikator terlemah: ${gapText}`;
    })
    .join('\n');

  const tugas = ctx.single
    ? `Tugas: analisis kondisi dimensi ${ctx.dimensi[0]?.label} di atas secara ringkas, dan berikan rekomendasi kegiatan/aktivitas konkret yang bisa dilaksanakan DPMD/pemerintah desa untuk meningkatkan indikator-indikator yang masih lemah pada dimensi ini.`
    : `Tugas: analisis kondisi ke-6 dimensi di atas secara ringkas, dan berikan rekomendasi kegiatan/aktivitas konkret yang bisa dilaksanakan DPMD/pemerintah desa untuk meningkatkan skor dimensi yang masih lemah.`;

  return `Kamu adalah asisten analisis pembangunan desa untuk Dinas Pemberdayaan Masyarakat dan Desa (DPMD) Kalimantan Selatan.

Data BANUA INDEX (skor Indeks Desa, Permendesa 9/2024) untuk cakupan: ${label}. Jumlah desa: ${ctx.totalDesa}.

${dimensiText}

${tugas} Setiap rekomendasi harus mengacu spesifik ke indikator terlemah yang disebutkan di atas - jangan mengarang data atau menyebut indikator yang tidak ada di atas. Bahasa lugas, mudah dipahami staf DPMD.

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
    dimensi: ctx.dimensi.map((d) => `${d.dimensi}:${d.avgSkor}/${d.avgBobot}:${d.gap.map((g) => g.indikator).join(',')}`),
  });
  return createHash('sha256').update(stable).digest('hex');
}

export async function getNarasiIndeks(scope, { forceRefresh = false } = {}) {
  const ctx = buildContext(scope);
  const key = scopeKey(scope);
  const inputHash = hashContext(ctx);

  if (!forceRefresh) {
    const cached = db
      .prepare(
        `SELECT hasil_json, model, dibuat_pada FROM narasi_indeks
         WHERE scope_key = ? AND input_hash = ? ORDER BY id DESC LIMIT 1`
      )
      .get(key, inputHash);
    if (cached) {
      return { ...JSON.parse(cached.hasil_json), cached: true, model: cached.model, dibuatPada: cached.dibuat_pada };
    }
  }

  const prompt = buildPrompt(ctx, scopeLabel(scope));
  const { result, model } = await callLLM(prompt);

  const dibuatPada = new Date().toISOString();
  db.prepare(
    `INSERT INTO narasi_indeks (scope_key, input_hash, model, hasil_json, dibuat_pada)
     VALUES (?, ?, ?, ?, ?)`
  ).run(key, inputHash, model, JSON.stringify(result), dibuatPada);

  return { ...result, cached: false, model, dibuatPada };
}
