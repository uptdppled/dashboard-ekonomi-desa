import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { reviewUploadDir } from './rpkp.js';

// Sprint 2 AI Document Assistant - deliberately Gemini-only (not the
// Groq->Gemini->Anthropic text fallback chain in lib/llm.js), because this
// needs a provider that can read the PDF bytes directly (multimodal), and
// the user explicitly asked for a free option. No separate OCR/chunking/
// embedding/vector DB pipeline - Gemini ingests the PDF whole and is
// instructed to cite page numbers itself. This trades some citation
// precision on very long/scanned documents for a much simpler system; if
// that precision proves insufficient once tested against real RPKP
// documents, a proper OCR+vector-search pipeline is the fallback plan.
//
// Files are sent via Gemini's Files API (upload once, reference by uri),
// NOT inline base64 - real Tabalong RPKP documents run up to 65MB, well
// past the ~20MB inline-data request cap. Uploaded files stay live on
// Google's side for ~48h, so the uri + expiry are cached on rpkp_document
// (see db.js) to avoid re-uploading a large file on every question.

function badRequest(msg) {
  const err = new Error(msg);
  err.code = 'BAD_REQUEST';
  err.status = 400;
  return err;
}

// Only the latest version of each document_type - an old superseded
// version shouldn't silently influence the answer alongside its
// replacement.
export function latestDocumentsForReview(reviewId) {
  return db
    .prepare(
      `SELECT d.* FROM rpkp_document d
       INNER JOIN (
         SELECT document_type, MAX(version) AS max_version
         FROM rpkp_document WHERE review_id = ? GROUP BY document_type
       ) latest ON latest.document_type = d.document_type AND latest.max_version = d.version
       WHERE d.review_id = ?`
    )
    .all(reviewId, reviewId);
}

const QA_PROMPT_VERSION = 'rpkp-doc-assistant-v1';
const COMPLETENESS_PROMPT_VERSION = 'rpkp-completeness-v1';
const RTRW_PROMPT_VERSION = 'rpkp-rtrw-v1';
const RPJMD_PROMPT_VERSION = 'rpkp-rpjmd-v1';
const IPKP_PROMPT_VERSION = 'rpkp-ipkp-v1';
const READINESS_PROMPT_VERSION = 'rpkp-readiness-v1';

function buildQaPrompt(question, docLabels) {
  return `Anda adalah asisten pembaca dokumen untuk reviewer Provinsi yang menelaah dokumen RPKP (Rencana Pembangunan Kawasan Perdesaan) sebuah kabupaten di Kalimantan Selatan.

Dokumen yang dilampirkan (dalam urutan ini): ${docLabels.join(', ')}.

ATURAN KETAT:
- Jawab HANYA berdasarkan isi dokumen yang dilampirkan. Jangan mengarang, jangan menambah asumsi di luar isi dokumen.
- Jika informasi tidak ditemukan di dokumen manapun, set "ditemukan": false dan "jawaban": "Belum ditemukan pada dokumen yang dianalisis."
- Jika ditemukan, sebutkan dari dokumen mana (gunakan label persis seperti di atas) dan perkiraan nomor halaman dalam dokumen tersebut.
- Sertakan kutipan singkat (maks 2 kalimat) dari teks asli yang mendukung jawaban Anda.
- Anda hanya membantu MEMBACA dan MENEMUKAN informasi - jangan menyimpulkan kelayakan, kesesuaian, atau rekomendasi apapun. Itu adalah keputusan reviewer manusia, bukan Anda.

Pertanyaan reviewer: "${question}"

Balas HANYA dengan JSON persis format berikut, tanpa teks lain:
{
  "ditemukan": true atau false,
  "jawaban": "jawaban ringkas dalam Bahasa Indonesia",
  "sumberDokumen": "label dokumen persis seperti di atas, atau null jika tidak ditemukan",
  "halaman": nomor halaman (integer) atau null,
  "kutipan": "kutipan singkat dari dokumen, atau null jika tidak ditemukan"
}`;
}

function buildCompletenessPrompt(item, docLabels) {
  return `Anda adalah asisten yang membantu reviewer Provinsi memeriksa KELENGKAPAN dokumen RPKP (Rencana Pembangunan Kawasan Perdesaan) sebuah kabupaten di Kalimantan Selatan.

Dokumen yang dilampirkan (dalam urutan ini): ${docLabels.join(', ')}.

Periksa apakah topik berikut dibahas dalam dokumen:
Topik: "${item.label}"
Cakupan topik: "${item.deskripsi || item.label}"

ATURAN KETAT:
- Jawab HANYA berdasarkan isi dokumen yang dilampirkan. Jangan mengarang, jangan menambah asumsi di luar isi dokumen.
- status "FOUND" jika topik dibahas dengan jelas dan cukup lengkap.
- status "PARTIAL" jika topik disebut tapi tidak lengkap atau hanya disinggung sekilas.
- status "NOT_FOUND" jika topik sama sekali tidak ditemukan di dokumen manapun.
- Sertakan sampai 3 bukti (evidence) pendukung, masing-masing menyebutkan dari dokumen mana (gunakan label persis seperti di atas), perkiraan nomor halaman, dan kutipan singkat (maks 2 kalimat).
- Anda hanya membantu MENEMUKAN dan MERINGKAS keberadaan pembahasan - jangan menyimpulkan kelayakan, kesesuaian, atau rekomendasi apapun. Itu adalah keputusan reviewer manusia, bukan Anda.

Balas HANYA dengan JSON persis format berikut, tanpa teks lain:
{
  "status": "FOUND" atau "PARTIAL" atau "NOT_FOUND",
  "ringkasan": "ringkasan singkat temuan dalam Bahasa Indonesia",
  "evidence": [
    { "sumberDokumen": "label dokumen persis seperti di atas", "halaman": nomor halaman (integer) atau null, "kutipan": "kutipan singkat" }
  ]
}`;
}

function buildRtrwPrompt(docLabels) {
  return `Anda adalah asisten yang membantu reviewer Provinsi memeriksa KESESUAIAN RUANG antara dokumen RPKP (Rencana Pembangunan Kawasan Perdesaan) dan dokumen RTRW (Rencana Tata Ruang Wilayah) kabupaten yang sama, keduanya dilampirkan.

Dokumen yang dilampirkan (dalam urutan ini): ${docLabels.join(', ')}.

Periksa:
1. Apakah lokasi/delineasi kawasan yang disebut dalam RPKP berada pada kawasan yang peruntukannya sesuai menurut RTRW (mis. kawasan pertanian, hortikultura, perkebunan, dll)?
2. Apakah RPKP secara eksplisit mengutip atau merujuk pasal/ketentuan RTRW yang relevan?

ATURAN KETAT:
- Jawab HANYA berdasarkan isi dokumen yang dilampirkan. Jangan mengarang, jangan menyimpulkan kesesuaian tata ruang di luar apa yang tertulis di kedua dokumen.
- status "FOUND" jika kedua dokumen membahas topik ini dengan jelas DAN peruntukan RTRW untuk lokasi tersebut konsisten dengan yang digambarkan RPKP.
- status "PARTIAL" jika ada pembahasan tapi tidak lengkap, ambigu, atau perlu perbandingan lebih detail oleh reviewer.
- status "NOT_FOUND" jika RTRW tidak membahas kawasan/lokasi ini sama sekali, atau salah satu dokumen tidak memuat informasi peruntukan ruang yang relevan.
- Sertakan sampai 3 bukti (evidence), masing-masing menyebutkan dari dokumen mana (gunakan label persis seperti di atas), perkiraan nomor halaman, dan kutipan singkat (maks 2 kalimat).
- Anda hanya membantu MENEMUKAN dan MERINGKAS - jangan menyimpulkan apakah RPKP "sah" atau "boleh dilanjutkan". Itu keputusan reviewer manusia.

Balas HANYA dengan JSON persis format berikut, tanpa teks lain:
{
  "status": "FOUND" atau "PARTIAL" atau "NOT_FOUND",
  "ringkasan": "ringkasan singkat temuan dalam Bahasa Indonesia",
  "evidence": [
    { "sumberDokumen": "label dokumen persis seperti di atas", "halaman": nomor halaman (integer) atau null, "kutipan": "kutipan singkat" }
  ]
}`;
}

function buildRpjmdPrompt(docLabels) {
  return `Anda adalah asisten yang membantu reviewer Provinsi memeriksa KESELARASAN antara dokumen RPKP (Rencana Pembangunan Kawasan Perdesaan) dan dokumen RPJMD (Rencana Pembangunan Jangka Menengah Daerah) kabupaten yang sama, keduanya dilampirkan.

Dokumen yang dilampirkan (dalam urutan ini): ${docLabels.join(', ')}.

Periksa:
1. Apakah tujuan, sasaran, atau program dalam RPKP selaras dengan arah kebijakan/program prioritas dalam RPJMD?
2. PENTING - periksa KESESUAIAN PERIODE: RPKP kadang mengutip RPJMD tertentu (dengan nomor Perda dan periode tahun) sebagai dasar hukum di bagian Landasan Hukum. Bandingkan periode/nomor Perda RPJMD yang dikutip RPKP dengan periode/tahun dokumen RPJMD yang benar-benar dilampirkan di sini - sebutkan jika keduanya berbeda periode (mis. RPKP mengutip RPJMD periode lama sementara yang dilampirkan adalah RPJMD periode baru).

ATURAN KETAT:
- Jawab HANYA berdasarkan isi dokumen yang dilampirkan. Jangan mengarang, jangan menambah asumsi di luar isi dokumen.
- status "FOUND" jika RPKP dan RPJMD yang dilampirkan konsisten (baik keselarasan substansi maupun periode).
- status "PARTIAL" jika ada pembahasan tapi ditemukan ketidaksesuaian (mis. periode RPJMD berbeda, atau keselarasan substansi tidak lengkap) - PARTIAL bukan berarti buruk, hanya berarti reviewer perlu memverifikasi lebih lanjut.
- status "NOT_FOUND" jika salah satu dokumen tidak memuat informasi yang relevan untuk dibandingkan.
- Sertakan sampai 3 bukti (evidence), masing-masing menyebutkan dari dokumen mana (gunakan label persis seperti di atas), perkiraan nomor halaman, dan kutipan singkat (maks 2 kalimat).
- Anda hanya membantu MENEMUKAN dan MERINGKAS - jangan menyimpulkan apakah RPKP "sah" atau "boleh dilanjutkan". Itu keputusan reviewer manusia.

Balas HANYA dengan JSON persis format berikut, tanpa teks lain:
{
  "status": "FOUND" atau "PARTIAL" atau "NOT_FOUND",
  "ringkasan": "ringkasan singkat temuan dalam Bahasa Indonesia",
  "evidence": [
    { "sumberDokumen": "label dokumen persis seperti di atas", "halaman": nomor halaman (integer) atau null, "kutipan": "kutipan singkat" }
  ]
}`;
}

// The "IPKP Existing" item is deliberately NOT the same framing as the
// other checklist items: per the blueprint (section 13-15), a kawasan
// still in early-stage planning legitimately may not have a measured IPKP
// score yet, and that absence must never be reported as a defect/gap -
// only as a fact ("belum terukur"). The 5 dimension items below it use the
// normal "is this discussed" framing, same as Completeness/Readiness.
function buildIpkpPrompt(item, docLabels) {
  if (item.kode === 'IPKP_EXISTING') {
    return `Anda adalah asisten yang membantu reviewer Provinsi memeriksa dokumen RPKP (Rencana Pembangunan Kawasan Perdesaan) sebuah kabupaten di Kalimantan Selatan.

Dokumen yang dilampirkan (dalam urutan ini): ${docLabels.join(', ')}.

Periksa: apakah dokumen memuat HASIL PENGUKURAN Indeks Perkembangan Kawasan Perdesaan (IPKP) yang sudah dilakukan - skor gabungan, status (mis. Mandiri/Maju/Berkembang), tahun pengukuran, dan/atau skor per dimensi.

ATURAN KETAT - PENTING:
- Jawab HANYA berdasarkan isi dokumen yang dilampirkan. Jangan mengarang angka.
- status "FOUND" jika ditemukan skor/hasil pengukuran IPKP yang sudah dilakukan - sebutkan skornya dan tahun pengukuran di ringkasan.
- status "NOT_FOUND" jika TIDAK ditemukan hasil pengukuran IPKP di dokumen manapun.
- SANGAT PENTING: status "NOT_FOUND" di sini BUKAN berarti RPKP kekurangan atau cacat - kawasan yang masih tahap awal perencanaan wajar belum memiliki pengukuran IPKP formal. Dalam ringkasan, jika NOT_FOUND, tulis dengan jelas bahwa ini adalah fakta ketersediaan data, bukan kekurangan dokumen.
- Jangan pernah gunakan kata "kekurangan", "tidak memenuhi", atau "cacat" untuk kasus NOT_FOUND di item ini.
- Sertakan sampai 3 bukti (evidence) jika FOUND, masing-masing menyebutkan dari dokumen mana (gunakan label persis seperti di atas), perkiraan nomor halaman, dan kutipan singkat.

Balas HANYA dengan JSON persis format berikut, tanpa teks lain:
{
  "status": "FOUND" atau "NOT_FOUND",
  "ringkasan": "ringkasan singkat dalam Bahasa Indonesia",
  "evidence": [
    { "sumberDokumen": "label dokumen persis seperti di atas", "halaman": nomor halaman (integer) atau null, "kutipan": "kutipan singkat" }
  ]
}`;
  }
  return `Anda adalah asisten yang membantu reviewer Provinsi memeriksa SUBSTANSI salah satu dimensi Indeks Perkembangan Kawasan Perdesaan (IPKP) dalam dokumen RPKP (Rencana Pembangunan Kawasan Perdesaan) sebuah kabupaten di Kalimantan Selatan.

Dokumen yang dilampirkan (dalam urutan ini): ${docLabels.join(', ')}.

Periksa apakah substansi dimensi berikut dibahas dalam dokumen (baik sebagai bagian dari deskripsi kondisi kawasan, maupun sebagai bagian dari hasil pengukuran IPKP jika ada):
Dimensi: "${item.label}"
Cakupan: "${item.deskripsi || item.label}"

ATURAN KETAT:
- Jawab HANYA berdasarkan isi dokumen yang dilampirkan. Jangan mengarang.
- status "FOUND" jika substansi dimensi ini dibahas dengan jelas dan cukup lengkap.
- status "PARTIAL" jika disinggung tapi tidak lengkap.
- status "NOT_FOUND" jika sama sekali tidak dibahas.
- Sertakan sampai 3 bukti (evidence), masing-masing menyebutkan dari dokumen mana (gunakan label persis seperti di atas), perkiraan nomor halaman, dan kutipan singkat.
- Anda hanya membantu MENEMUKAN dan MERINGKAS - jangan menyimpulkan kelayakan atau rekomendasi apapun. Itu keputusan reviewer manusia.

Balas HANYA dengan JSON persis format berikut, tanpa teks lain:
{
  "status": "FOUND" atau "PARTIAL" atau "NOT_FOUND",
  "ringkasan": "ringkasan singkat dalam Bahasa Indonesia",
  "evidence": [
    { "sumberDokumen": "label dokumen persis seperti di atas", "halaman": nomor halaman (integer) atau null, "kutipan": "kutipan singkat" }
  ]
}`;
}

function buildReadinessPrompt(item, docLabels) {
  return `Anda adalah asisten yang membantu reviewer Provinsi memeriksa KESIAPAN/KELAYAKAN pengembangan kawasan dalam dokumen RPKP (Rencana Pembangunan Kawasan Perdesaan) sebuah kabupaten di Kalimantan Selatan.

Dokumen yang dilampirkan (dalam urutan ini): ${docLabels.join(', ')}.

Periksa apakah aspek kelayakan berikut dibahas dalam dokumen:
Aspek: "${item.label}"
Cakupan: "${item.deskripsi || item.label}"

ATURAN KETAT:
- Jawab HANYA berdasarkan isi dokumen yang dilampirkan. Jangan mengarang, jangan menyimpulkan kelayakan sendiri di luar apa yang tertulis.
- status "FOUND" jika aspek ini dibahas dengan analisis yang cukup jelas.
- status "PARTIAL" jika disinggung tapi analisisnya dangkal/tidak lengkap.
- status "NOT_FOUND" jika sama sekali tidak dibahas.
- Sertakan sampai 3 bukti (evidence), masing-masing menyebutkan dari dokumen mana (gunakan label persis seperti di atas), perkiraan nomor halaman, dan kutipan singkat.
- Anda hanya membantu MENEMUKAN dan MERINGKAS keberadaan analisis - jangan membuat penilaian kelayakan sendiri. Itu keputusan reviewer manusia.

Balas HANYA dengan JSON persis format berikut, tanpa teks lain:
{
  "status": "FOUND" atau "PARTIAL" atau "NOT_FOUND",
  "ringkasan": "ringkasan singkat dalam Bahasa Indonesia",
  "evidence": [
    { "sumberDokumen": "label dokumen persis seperti di atas", "halaman": nomor halaman (integer) atau null, "kutipan": "kutipan singkat" }
  ]
}`;
}

function requireGeminiKey() {
  if (!process.env.GEMINI_API_KEY) {
    const err = new Error(
      'Fitur Asisten AI Dokumen butuh GEMINI_API_KEY di server/.env (Gemini dipilih karena bisa membaca PDF langsung, gratis untuk pemakaian moderat). Lihat server/.env.example.'
    );
    err.code = 'NO_API_KEY';
    err.status = 503;
    throw err;
  }
}

// A plain fetch() has no default timeout - observed directly while testing
// the generateContent call (a stalled connection hung indefinitely instead
// of erroring), so every Gemini call here, including uploads, gets an
// explicit hard cutoff via AbortController.
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Tidak ada respons dalam ${timeoutMs / 1000} detik.`);
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

// Gemini's simple (non-chunked) resumable upload: one "start" call to open
// a session + get an upload URL, one "upload, finalize" call with the raw
// bytes. Fine for our sizes (tens of MB, occasionally up to ~65MB) - true
// multi-chunk resumable upload isn't worth the complexity here since we
// already hold the whole file buffer in memory.
async function uploadFileToGemini(buffer, mimeType, displayName) {
  requireGeminiKey();
  const startRes = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(buffer.length),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: displayName } }),
    },
    15_000
  );
  if (!startRes.ok) throw new Error(`Gemini upload (start) error ${startRes.status}: ${(await startRes.text()).slice(0, 300)}`);
  const uploadUrl = startRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Gemini upload gagal: tidak ada upload URL dari server.');

  // Large scanned RPKP documents can run past 60MB - give the actual byte
  // transfer a much longer budget than a normal API call.
  const uploadRes = await fetchWithTimeout(
    uploadUrl,
    {
      method: 'POST',
      headers: {
        'Content-Length': String(buffer.length),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
      },
      body: buffer,
    },
    120_000
  );
  if (!uploadRes.ok) throw new Error(`Gemini upload (finalize) error ${uploadRes.status}: ${(await uploadRes.text()).slice(0, 300)}`);
  const { file } = await uploadRes.json();
  return file; // { name, uri, mimeType, state, expirationTime, ... }
}

// PDFs typically finish processing (state ACTIVE) synchronously within the
// upload call itself, but poll briefly in case a large/scanned file needs a
// moment - generateContent rejects a file still in PROCESSING state.
async function waitUntilActive(file) {
  let current = file;
  for (let i = 0; i < 5 && current.state === 'PROCESSING'; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/${current.name}?key=${process.env.GEMINI_API_KEY}`,
      {},
      10_000
    );
    if (!res.ok) break;
    current = await res.json();
  }
  if (current.state !== 'ACTIVE') {
    throw new Error(`Dokumen belum selesai diproses Gemini (status: ${current.state}) - coba lagi sebentar.`);
  }
  return current;
}

// Cached on rpkp_document so a large document is uploaded to Gemini once,
// not on every question - reused until close to its ~48h expiry.
async function ensureGeminiFile(doc, filePath) {
  const SAFETY_MARGIN_MS = 5 * 60 * 1000;
  if (doc.gemini_file_uri && doc.gemini_file_expires_at) {
    const expiresAt = new Date(doc.gemini_file_expires_at).getTime();
    if (expiresAt - SAFETY_MARGIN_MS > Date.now()) {
      return doc.gemini_file_uri;
    }
  }
  const buffer = fs.readFileSync(filePath);
  const uploaded = await waitUntilActive(await uploadFileToGemini(buffer, 'application/pdf', doc.original_filename));
  db.prepare('UPDATE rpkp_document SET gemini_file_uri = ?, gemini_file_expires_at = ? WHERE id = ?').run(
    uploaded.uri,
    uploaded.expirationTime,
    doc.id
  );
  return uploaded.uri;
}

async function callGeminiJson(prompt, fileParts) {
  requireGeminiKey();
  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }, ...fileParts] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
  });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  // Free-tier Gemini returns 503 "high demand, usually temporary" fairly
  // often (observed directly while testing this feature) - a few retries
  // with backoff turns a routine transient blip into a successful answer
  // instead of forcing the reviewer to notice and manually retry. Each
  // attempt also gets its own hard timeout: plain fetch() has no default
  // timeout, and a stalled connection (also observed while testing - no
  // error, just never resolving) would otherwise hang the request forever
  // instead of falling through to a retry or a clean failure.
  // 30s was calibrated against a single small test PDF and turned out to be
  // far too short for real RPKP documents: a review with 4 attached
  // documents (~107MB combined, one a 65MB scan) genuinely needs Gemini
  // well over 30s to read all of it before answering - confirmed by
  // server-side logging that every "AI_UNAVAILABLE" on that review was
  // actually our own AbortError, not a real Gemini failure. Even 120s per
  // attempt turned out too tight for a two-large-document comparison
  // (RTRW/RPJMD checks read RPKP + one more ~30-65MB document together) -
  // raised to 180s.
  // 429 is deliberately NOT retried: it means the free-tier quota (per-
  // minute or daily) is exhausted, confirmed directly while testing this
  // feature - a short backoff won't clear a daily quota, so retrying just
  // burns another ATTEMPT_TIMEOUT_MS for a guaranteed second failure.
  // A timeout (AbortError) is also NOT retried: it means Gemini is still
  // processing the same large payload, and firing the identical request
  // again is unlikely to finish any faster - better to fail once and let
  // the reviewer decide whether to try again, than silently double the
  // wait for a retry that probably times out the same way.
  const RETRYABLE_STATUS = new Set([503]);
  const MAX_ATTEMPTS = 2;
  const ATTEMPT_TIMEOUT_MS = 180_000;
  let lastErr;
  let lastStatus;
  let data;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: controller.signal });
      if (res.ok) {
        data = await res.json();
        lastErr = null;
        break;
      }
      lastStatus = res.status;
      const bodyText = (await res.text()).slice(0, 300);
      lastErr = new Error(`Gemini API error ${res.status}: ${bodyText}`);
      if (!RETRYABLE_STATUS.has(res.status) || attempt === MAX_ATTEMPTS) break;
    } catch (e) {
      if (e.name === 'AbortError') {
        lastErr = new Error(`Gemini API tidak merespons dalam ${ATTEMPT_TIMEOUT_MS / 1000} detik.`);
        break;
      }
      lastErr = e;
      if (attempt === MAX_ATTEMPTS) break;
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
  if (lastErr) {
    const err = new Error(
      lastStatus === 429
        ? 'Kuota gratis Gemini untuk hari ini sudah habis (dokumen besar memakai kuota lebih banyak) - coba lagi besok, atau hubungi admin untuk mengaktifkan billing Gemini.'
        : 'Gemini sedang sibuk atau lambat merespons - ini biasanya sementara, coba tanya lagi beberapa saat lagi.'
    );
    err.code = lastStatus === 429 ? 'AI_QUOTA_EXCEEDED' : 'AI_UNAVAILABLE';
    err.status = lastStatus === 429 ? 429 : 503;
    err.cause = lastErr;
    throw err;
  }
  const text = (data.candidates?.[0]?.content?.parts || [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
  if (!text) throw new Error('Gemini API mengembalikan respons kosong (kemungkinan diblokir oleh safety filter).');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Respons AI bukan JSON valid.');
    parsed = JSON.parse(match[0]);
  }
  return { parsed, model: `gemini/${model}` };
}

// Shared by every AI feature that needs to read a review's documents
// (free-form Q&A, per-item completeness checks, IPKP/Readiness/RTRW/RPJMD
// engines) - loads the latest version of each PDF, uploads/caches each to
// Gemini in parallel, and returns the parts + labels ready to drop into a
// generateContent call. `documentTypes`, when given, scopes the call to
// just those document_type values (e.g. RTRW alignment only needs the RPKP
// + RTRW documents, not the whole set) - both for a cheaper/faster call and
// so the prompt isn't ambiguous about which two documents to compare.
async function getReviewFileParts(review, documentTypes) {
  let docs = latestDocumentsForReview(review.id).filter((d) => d.mime_type === 'application/pdf');
  if (documentTypes) docs = docs.filter((d) => documentTypes.includes(d.document_type));
  if (docs.length === 0) {
    throw badRequest('Belum ada dokumen PDF pada review ini - fitur AI hanya bisa membaca dokumen berformat PDF saat ini.');
  }

  const dir = reviewUploadDir(review.id);
  const existingDocs = docs
    .map((doc) => ({ doc, filePath: path.join(dir, doc.stored_filename) }))
    .filter(({ filePath }) => fs.existsSync(filePath));
  if (existingDocs.length === 0) {
    throw badRequest('Berkas dokumen PDF tidak ditemukan di server.');
  }

  // Upload/ensure every document in parallel, not one-by-one - a review can
  // have several large documents at once (e.g. a 65MB RPKP + a 33MB RPJMD),
  // and doing those sequentially would mean minutes of dead time on the
  // first question about a fresh review before any of them are even cached.
  const uploaded = await Promise.all(
    existingDocs.map(async ({ doc, filePath }) => {
      try {
        return { doc, fileUri: await ensureGeminiFile(doc, filePath) };
      } catch (e) {
        const err = new Error(`Gagal mengunggah "${doc.original_filename}" ke Gemini untuk dibaca - coba lagi sebentar.`);
        err.code = 'AI_UNAVAILABLE';
        err.status = 503;
        err.cause = e;
        throw err;
      }
    })
  );
  const docLabels = uploaded.map(({ doc }) => `${doc.document_type} v${doc.version} (${doc.original_filename})`);
  const fileParts = uploaded.map(({ fileUri }) => ({ file_data: { mime_type: 'application/pdf', file_uri: fileUri } }));
  return { docLabels, fileParts };
}

export async function askDocumentAssistant(review, question) {
  if (!question || !question.trim()) throw badRequest('Pertanyaan wajib diisi.');
  const { docLabels, fileParts } = await getReviewFileParts(review);

  const { parsed, model } = await callGeminiJson(buildQaPrompt(question, docLabels), fileParts);
  return {
    ditemukan: !!parsed.ditemukan,
    jawaban: parsed.jawaban || null,
    sumberDokumen: parsed.sumberDokumen || null,
    halaman: Number.isInteger(parsed.halaman) ? parsed.halaman : null,
    kutipan: parsed.kutipan || null,
    model,
  };
}

function parseStatusEvidenceResponse(parsed, model, promptVersion) {
  const status = ['FOUND', 'PARTIAL', 'NOT_FOUND'].includes(parsed.status) ? parsed.status : 'NOT_FOUND';
  const evidence = Array.isArray(parsed.evidence)
    ? parsed.evidence.slice(0, 5).map((e) => ({
        sumberDokumen: e.sumberDokumen || null,
        halaman: Number.isInteger(e.halaman) ? e.halaman : null,
        kutipan: e.kutipan || null,
      }))
    : [];
  return { status, ringkasan: parsed.ringkasan || null, evidence, model, promptVersion };
}

// item: a row from rpkp_completeness_item ({ kode, label, deskripsi }).
export async function checkCompletenessItem(review, item) {
  const { docLabels, fileParts } = await getReviewFileParts(review);
  const { parsed, model } = await callGeminiJson(buildCompletenessPrompt(item, docLabels), fileParts);
  return parseStatusEvidenceResponse(parsed, model, COMPLETENESS_PROMPT_VERSION);
}

// item: a row from rpkp_completeness_item with kategori 'IPKP' or 'READINESS'.
export async function checkChecklistItem(review, item) {
  const { docLabels, fileParts } = await getReviewFileParts(review);
  if (item.kategori === 'IPKP') {
    const { parsed, model } = await callGeminiJson(buildIpkpPrompt(item, docLabels), fileParts);
    return parseStatusEvidenceResponse(parsed, model, IPKP_PROMPT_VERSION);
  }
  if (item.kategori === 'READINESS') {
    const { parsed, model } = await callGeminiJson(buildReadinessPrompt(item, docLabels), fileParts);
    return parseStatusEvidenceResponse(parsed, model, READINESS_PROMPT_VERSION);
  }
  throw badRequest(`Kategori checklist tidak dikenali: ${item.kategori}`);
}

function missingDocumentResult(documentType, promptVersion) {
  return {
    status: 'NOT_FOUND',
    ringkasan: `Dokumen ${documentType} belum diunggah pada review ini - belum dapat dinilai. Unggah dokumen ${documentType} di tab Dokumen lalu cek ulang.`,
    evidence: [],
    model: 'rule-engine',
    promptVersion,
  };
}

export async function checkRtrwAlignment(review) {
  const hasRtrw = latestDocumentsForReview(review.id).some((d) => d.document_type === 'RTRW' && d.mime_type === 'application/pdf');
  if (!hasRtrw) return missingDocumentResult('RTRW', RTRW_PROMPT_VERSION);
  const { docLabels, fileParts } = await getReviewFileParts(review, ['RPKP', 'RTRW']);
  const { parsed, model } = await callGeminiJson(buildRtrwPrompt(docLabels), fileParts);
  return parseStatusEvidenceResponse(parsed, model, RTRW_PROMPT_VERSION);
}

export async function checkRpjmdAlignment(review) {
  const hasRpjmd = latestDocumentsForReview(review.id).some((d) => d.document_type === 'RPJMD' && d.mime_type === 'application/pdf');
  if (!hasRpjmd) return missingDocumentResult('RPJMD', RPJMD_PROMPT_VERSION);
  const { docLabels, fileParts } = await getReviewFileParts(review, ['RPKP', 'RPJMD']);
  const { parsed, model } = await callGeminiJson(buildRpjmdPrompt(docLabels), fileParts);
  return parseStatusEvidenceResponse(parsed, model, RPJMD_PROMPT_VERSION);
}

export function saveQa(reviewId, user, question, result) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO rpkp_ai_qa (review_id, pertanyaan, ditemukan, jawaban, sumber_dokumen, halaman, kutipan, model, prompt_version, ditanya_oleh, dibuat_pada)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    reviewId,
    question.trim(),
    result.ditemukan ? 1 : 0,
    result.jawaban,
    result.sumberDokumen,
    result.halaman,
    result.kutipan,
    result.model,
    QA_PROMPT_VERSION,
    user.email,
    now
  );
}

export function listQa(reviewId) {
  return db.prepare('SELECT * FROM rpkp_ai_qa WHERE review_id = ? ORDER BY dibuat_pada DESC').all(reviewId);
}
