import { createHash } from 'node:crypto';
import { db } from '../db.js';
import { callLLM } from './llm.js';

// BUMDes exists to either monetize an existing potential (Layer 3) or plug a
// gap in supporting infrastructure (Layer 2b / Layer 4) - so the prompt is
// built from exactly those two angles: what the village already has, and
// what's visibly missing relative to typical village economic facilities.
function buildProfileContext(kode) {
  const desa = db.prepare('SELECT * FROM desa WHERE kode_desa = ?').get(kode);
  if (!desa) return null;

  const skor = db
    .prepare(
      `SELECT sub_dimensi, nama_indikator, skor, bobot_maks FROM skor_indikator
       WHERE kode_desa = ? ORDER BY id`
    )
    .all(kode);

  const potensi = db
    .prepare(
      `SELECT sektor, subsektor FROM potensi_desa
       WHERE kode_desa = ? AND nilai = 'Ada' ORDER BY sektor`
    )
    .all(kode);

  const ekosistem = db
    .prepare(`SELECT komponen, nilai FROM ekosistem_desa WHERE kode_desa = ? ORDER BY id`)
    .all(kode);

  // Indicators scoring under 60% of their max weight read as a concrete gap
  // ("masalah") worth naming, rather than dumping the full raw score list.
  const gapIndikator = skor.filter(
    (s) => /^SKOR /i.test(s.nama_indikator) && s.bobot_maks && s.skor / s.bobot_maks < 0.6
  );

  const potensiBySektor = {};
  for (const p of potensi) (potensiBySektor[p.sektor] ||= []).push(p.subsektor.replace(/^Terdapat /i, ''));

  return { desa, skor, potensi, potensiBySektor, ekosistem, gapIndikator };
}

function buildPrompt(ctx) {
  const { desa, potensiBySektor, ekosistem, gapIndikator } = ctx;

  const potensiText = Object.entries(potensiBySektor)
    .map(([sektor, items]) => `- ${sektor}: ${items.join(', ')}`)
    .join('\n') || '(tidak ada potensi sektor tercatat)';

  const ekosistemText = ekosistem
    .map((e) => `- ${e.komponen}: ${e.nilai}`)
    .join('\n') || '(tidak ada data ekosistem)';

  const masalahText = gapIndikator.length
    ? gapIndikator.map((g) => `- ${g.nama_indikator.replace(/^SKOR /i, '')} (skor ${g.skor}/${g.bobot_maks})`).join('\n')
    : '(tidak ada indikator dengan skor rendah yang menonjol)';

  return `Kamu adalah penasihat pengembangan ekonomi desa untuk Dinas Pemberdayaan Masyarakat dan Desa (DPMD) Kalimantan Selatan.

Data Desa ${desa.nama_desa} (Kecamatan ${desa.kecamatan}, Kabupaten ${desa.kabupaten}), status desa: ${desa.status_desa}.

POTENSI EKONOMI YANG TERCATAT (sektor dan sub-sektor dengan jawaban "Ada" pada pendataan):
${potensiText}

EKOSISTEM PENDUKUNG EKONOMI SAAT INI (BUM Desa/KDMP/Koperasi):
${ekosistemText}

INDIKATOR DENGAN SKOR RENDAH (kemungkinan area masalah/kekurangan fasilitas ekonomi):
${masalahText}

Tugas: rekomendasikan 3-5 produk unggulan atau lini usaha BUM Desa yang realistis untuk desa ini. BUM Desa dibangun untuk MEMANFAATKAN POTENSI yang ada ATAU MENYELESAIKAN MASALAH/kekurangan fasilitas - setiap rekomendasi harus jelas berbasis salah satu atau kedua hal itu, mengacu spesifik ke data di atas (jangan merekomendasikan sesuatu yang potensinya tidak tercatat di desa ini).

Jawab HANYA dengan JSON valid (tanpa markdown code fence, tanpa teks lain di luar JSON), dengan skema persis:
{
  "ringkasan": "1-2 kalimat ringkasan kondisi ekonomi desa ini",
  "rekomendasi": [
    {
      "nama": "nama produk/usaha yang direkomendasikan",
      "berbasis": "potensi" | "masalah" | "keduanya",
      "alasan": "1-2 kalimat, sebutkan potensi/masalah spesifik dari data di atas yang mendasari rekomendasi ini",
      "kesiapan": "Mudah" | "Sedang" | "Perlu Investasi",
      "langkah_awal": "1 kalimat langkah konkret pertama yang bisa diambil BUM Desa/pemerintah desa"
    }
  ]
}`;
}

function hashContext(ctx) {
  const stable = JSON.stringify({
    potensi: ctx.potensi.map((p) => `${p.sektor}::${p.subsektor}`).sort(),
    ekosistem: ctx.ekosistem.map((e) => `${e.komponen}::${e.nilai}`).sort(),
    gap: ctx.gapIndikator.map((g) => g.nama_indikator).sort(),
  });
  return createHash('sha256').update(stable).digest('hex');
}

export async function getRekomendasi(kode, { forceRefresh = false } = {}) {
  const ctx = buildProfileContext(kode);
  if (!ctx) return { notFound: true };

  const inputHash = hashContext(ctx);

  if (!forceRefresh) {
    const cached = db
      .prepare(
        `SELECT rekomendasi_json, model, dibuat_pada FROM rekomendasi_produk
         WHERE kode_desa = ? AND input_hash = ? ORDER BY id DESC LIMIT 1`
      )
      .get(kode, inputHash);
    if (cached) {
      return {
        ...JSON.parse(cached.rekomendasi_json),
        cached: true,
        model: cached.model,
        dibuatPada: cached.dibuat_pada,
      };
    }
  }

  const prompt = buildPrompt(ctx);
  const { result, model } = await callLLM(prompt);

  db.prepare(
    `INSERT INTO rekomendasi_produk (kode_desa, input_hash, model, rekomendasi_json, dibuat_pada)
     VALUES (?, ?, ?, ?, ?)`
  ).run(kode, inputHash, model, JSON.stringify(result), new Date().toISOString());

  return { ...result, cached: false, model, dibuatPada: new Date().toISOString() };
}
