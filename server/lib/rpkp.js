import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_ROOT = path.join(__dirname, '..', 'data', 'rpkp-uploads');

export const DOCUMENT_TYPES = ['RPKP', 'RTRW', 'RPJMD', 'MASTERPLAN', 'PETA', 'LAMPIRAN', 'LAINNYA'];

// Kabupaten mengajukan (DRAFT), provinsi/admin menelaah - status lebih lanjut
// (revision/comparison/recommendation gate) menyusul di sprint berikutnya
// per blueprint, sengaja belum diimplementasikan di sini.
const STATUS_TRANSITIONS = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['IN_REVIEW'],
  IN_REVIEW: ['NEED_CLARIFICATION', 'REVIEW_COMPLETED'],
  NEED_CLARIFICATION: ['SUBMITTED'],
  REVIEW_COMPLETED: [],
};

function forbidden(msg = 'Anda tidak punya akses ke data ini.') {
  const err = new Error(msg);
  err.code = 'FORBIDDEN';
  err.status = 403;
  return err;
}

function badRequest(msg) {
  const err = new Error(msg);
  err.code = 'BAD_REQUEST';
  err.status = 400;
  return err;
}

function notFound(msg = 'Tidak ditemukan.') {
  const err = new Error(msg);
  err.code = 'NOT_FOUND';
  err.status = 404;
  return err;
}

// Kabupaten role only ever sees/acts on their own kabupaten's reviews
// (mirrors assertKabupatenAccess in lib/scope.js); provinsi/admin see all;
// desa role has no legitimate use for this module at all.
export function assertReviewAccess(user, review) {
  if (!review) throw notFound('Review RPKP tidak ditemukan.');
  if (user.role === 'admin' || user.role === 'provinsi') return;
  if (user.role === 'kabupaten' && review.kabupaten === user.kabupaten) return;
  throw forbidden();
}

export function listReviews(scope) {
  const clauses = [];
  const params = [];
  if (scope.kabupaten) {
    clauses.push('kabupaten = ?');
    params.push(scope.kabupaten);
  }
  if (scope.status) {
    clauses.push('status = ?');
    params.push(scope.status);
  }
  if (scope.q) {
    clauses.push('(nama_kawasan LIKE ? OR kabupaten LIKE ?)');
    params.push(`%${scope.q}%`, `%${scope.q}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM rpkp_review ${where} ORDER BY diperbarui_pada DESC`).all(...params);
  const withCounts = rows.map((r) => {
    const doc = db.prepare('SELECT COUNT(*) n FROM rpkp_document WHERE review_id = ?').get(r.id);
    return { ...r, jumlah_dokumen: doc.n };
  });
  return withCounts;
}

export function getReview(id) {
  return db.prepare('SELECT * FROM rpkp_review WHERE id = ?').get(id);
}

export function createReview(user, data) {
  const { nama_kawasan, kabupaten, periode, tahun_dokumen, keterangan } = data;
  if (!nama_kawasan || !nama_kawasan.trim()) throw badRequest('Nama kawasan wajib diisi.');
  const kab = user.role === 'kabupaten' ? user.kabupaten : kabupaten;
  if (!kab || !kab.trim()) throw badRequest('Kabupaten wajib diisi.');
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO rpkp_review (nama_kawasan, kabupaten, periode, tahun_dokumen, keterangan, status, dibuat_oleh, dibuat_pada, diperbarui_pada)
       VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)`
    )
    .run(nama_kawasan.trim(), kab.trim(), periode || null, tahun_dokumen || null, keterangan || null, user.email, now, now);
  const id = Number(result.lastInsertRowid);
  logHistory(id, 'CREATED', `Review dibuat untuk kawasan "${nama_kawasan.trim()}"`, user.email);
  return getReview(id);
}

export function logHistory(reviewId, eventType, detail, aktor) {
  db.prepare(
    `INSERT INTO rpkp_review_history (review_id, event_type, detail, aktor, dibuat_pada) VALUES (?, ?, ?, ?, ?)`
  ).run(reviewId, eventType, detail || null, aktor, new Date().toISOString());
}

export function listHistory(reviewId) {
  return db.prepare('SELECT * FROM rpkp_review_history WHERE review_id = ? ORDER BY dibuat_pada DESC').all(reviewId);
}

export function listDocuments(reviewId) {
  return db
    .prepare('SELECT * FROM rpkp_document WHERE review_id = ? ORDER BY document_type, version DESC')
    .all(reviewId);
}

export function getDocument(reviewId, documentId) {
  return db.prepare('SELECT * FROM rpkp_document WHERE id = ? AND review_id = ?').get(documentId, reviewId);
}

// Every upload of the same document_type within a review becomes the next
// version (1, 2, 3, ...) rather than overwriting - old files stay on disk
// and in the DB so a future version-comparison feature has something to
// diff against.
export function addDocument(reviewId, user, { documentType, originalFilename, storedFilename, fileSize, mimeType }) {
  if (!DOCUMENT_TYPES.includes(documentType)) {
    throw badRequest(`Jenis dokumen tidak dikenali: ${documentType}`);
  }
  const last = db
    .prepare('SELECT MAX(version) AS v FROM rpkp_document WHERE review_id = ? AND document_type = ?')
    .get(reviewId, documentType);
  const version = (last?.v || 0) + 1;
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO rpkp_document (review_id, document_type, version, original_filename, stored_filename, file_size, mime_type, diunggah_oleh, diunggah_pada)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(reviewId, documentType, version, originalFilename, storedFilename, fileSize || null, mimeType || null, user.email, now);
  db.prepare('UPDATE rpkp_review SET diperbarui_pada = ? WHERE id = ?').run(now, reviewId);
  logHistory(reviewId, 'DOCUMENT_UPLOADED', `${documentType} v${version} diunggah (${originalFilename})`, user.email);
  return { id: Number(result.lastInsertRowid), version };
}

export function reviewUploadDir(reviewId) {
  const dir = path.join(UPLOAD_ROOT, String(reviewId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Kabupaten may only advance DRAFT -> SUBMITTED or respond to a
// clarification request (NEED_CLARIFICATION -> SUBMITTED, i.e. re-submit
// after uploading a revision); every other transition is a provinsi/admin
// reviewer action. Enforced here (not just hidden in the UI) since status
// changes are as consequential as the RBAC scope checks elsewhere.
export function changeStatus(user, review, nextStatus, note) {
  const allowed = STATUS_TRANSITIONS[review.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw badRequest(`Status tidak bisa berpindah dari ${review.status} ke ${nextStatus}.`);
  }
  const kabupatenActions = new Set(['SUBMITTED']);
  const isKabupatenActor = user.role === 'kabupaten';
  const isReviewerActor = user.role === 'admin' || user.role === 'provinsi';
  if (isKabupatenActor && !kabupatenActions.has(nextStatus)) {
    throw forbidden('Perubahan status ini hanya bisa dilakukan oleh reviewer provinsi.');
  }
  if (isReviewerActor && kabupatenActions.has(nextStatus) && review.status !== 'NEED_CLARIFICATION') {
    // provinsi/admin normally don't submit on behalf of kabupaten, except
    // to unblock a stuck NEED_CLARIFICATION case if asked - otherwise this
    // action belongs to the kabupaten actor.
    throw forbidden('Aksi ini biasanya dilakukan oleh Kabupaten.');
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE rpkp_review SET status = ?, diperbarui_pada = ? WHERE id = ?').run(nextStatus, now, review.id);
  logHistory(review.id, 'STATUS_CHANGED', note ? `${review.status} → ${nextStatus}: ${note}` : `${review.status} → ${nextStatus}`, user.email);
  return getReview(review.id);
}

// Which desa make up this kawasan - needed for the BANUA360 cross-check
// (Sprint 4) to look up real potensi/BUM Desa/status data for the right
// villages. Every kode_desa must belong to the review's own kabupaten -
// a kawasan can't span kabupaten (Permendesa 5/2016 Pasal 9).
export function listReviewDesa(reviewId) {
  return db
    .prepare(
      `SELECT d.kode_desa, d.nama_desa, d.kecamatan, d.status_desa FROM rpkp_review_desa rd
       JOIN desa d ON d.kode_desa = rd.kode_desa
       WHERE rd.review_id = ? ORDER BY d.kecamatan, d.nama_desa`
    )
    .all(reviewId);
}

export function setReviewDesa(review, user, kodeDesaList) {
  if (!Array.isArray(kodeDesaList)) throw badRequest('Daftar desa tidak valid.');
  const unique = [...new Set(kodeDesaList.map(String))];
  if (unique.length > 0) {
    const placeholders = unique.map(() => '?').join(',');
    const found = db
      .prepare(`SELECT kode_desa FROM desa WHERE kode_desa IN (${placeholders}) AND kabupaten = ?`)
      .all(...unique, review.kabupaten)
      .map((r) => r.kode_desa);
    const invalid = unique.filter((k) => !found.includes(k));
    if (invalid.length > 0) {
      throw badRequest(`Desa berikut bukan bagian dari kabupaten ${review.kabupaten}: ${invalid.join(', ')}`);
    }
  }
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM rpkp_review_desa WHERE review_id = ?').run(review.id);
    const insert = db.prepare('INSERT INTO rpkp_review_desa (review_id, kode_desa) VALUES (?, ?)');
    for (const kode of unique) insert.run(review.id, kode);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  logHistory(review.id, 'DESA_ANGGOTA_DIPERBARUI', `${unique.length} desa ditandai sebagai anggota kawasan`, user.email);
  return listReviewDesa(review.id);
}
