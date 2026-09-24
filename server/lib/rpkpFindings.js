import { db } from '../db.js';
import { logHistory, listReviewDesa } from './rpkp.js';

// Same "genuine existence flag" pattern as index.js's ADA_FILTER / the
// opportunity.js/insight.js ADA_FILTER - a subsektor row only really means
// "yes this exists" when it's a "Terdapat X" question answered "Ada"; a
// bare nilai='Ada' also matches free-text/reference-number columns that
// happen to contain the literal string "Ada", which over-counts presence.
const ADA_FILTER = `p.nilai = 'Ada' AND p.subsektor LIKE 'Terdapat %'`;

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

// kategori: 'COMPLETENESS' | 'IPKP' | 'READINESS' - same master-checklist
// table, one Review-tab section each.
export function listChecklistItems(kategori) {
  return db.prepare('SELECT * FROM rpkp_completeness_item WHERE kategori = ? AND aktif = 1 ORDER BY urutan').all(kategori);
}

export function listCompletenessItems() {
  return listChecklistItems('COMPLETENESS');
}

export function getChecklistItem(kode) {
  return db.prepare('SELECT * FROM rpkp_completeness_item WHERE kode = ? AND aktif = 1').get(kode);
}

export function getCompletenessItem(kode) {
  return db.prepare('SELECT * FROM rpkp_completeness_item WHERE kode = ? AND aktif = 1').get(kode);
}

function attachEvidence(findings) {
  if (findings.length === 0) return findings;
  const ids = findings.map((f) => f.id);
  const placeholders = ids.map(() => '?').join(',');
  const evidenceRows = db.prepare(`SELECT * FROM rpkp_evidence WHERE finding_id IN (${placeholders})`).all(...ids);
  const byFinding = new Map();
  for (const e of evidenceRows) {
    if (!byFinding.has(e.finding_id)) byFinding.set(e.finding_id, []);
    byFinding.get(e.finding_id).push(e);
  }
  return findings.map((f) => ({ ...f, evidence: byFinding.get(f.id) || [] }));
}

// Findings across every category (COMPLETENESS today; IPKP/READINESS/RTRW/
// RPJMD/BANUA360 reuse this same listing once their engines exist) - this
// is the "Temuan" tab's consolidated view.
export function listFindings(reviewId, category) {
  const clauses = ['review_id = ?'];
  const params = [reviewId];
  if (category) {
    clauses.push('category = ?');
    params.push(category);
  }
  const rows = db
    .prepare(`SELECT * FROM rpkp_finding WHERE ${clauses.join(' AND ')} ORDER BY category, item_kode`)
    .all(...params);
  return attachEvidence(rows);
}

// One finding per (review, category, item_kode) - re-running a check
// replaces the previous proposal and resets reviewer_status to PENDING,
// since a stale verification against a since-changed summary would be
// misleading (correctness over convenience). Shared by every category:
// COMPLETENESS uses one row per rpkp_completeness_item.kode; RTRW/RPJMD/
// BANUA360 aren't itemized, so they each just use a fixed sentinel
// item_kode (their whole category is "one check").
export function upsertFinding(reviewId, category, itemKode, title, aiResult, user) {
  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT id FROM rpkp_finding WHERE review_id = ? AND category = ? AND item_kode = ?')
    .get(reviewId, category, itemKode);

  let findingId;
  if (existing) {
    findingId = existing.id;
    db.prepare(
      `UPDATE rpkp_finding SET ai_status = ?, ai_summary = ?, reviewer_status = 'PENDING', reviewer_note = NULL, model = ?, prompt_version = ?, diperbarui_pada = ?
       WHERE id = ?`
    ).run(aiResult.status, aiResult.ringkasan, aiResult.model, aiResult.promptVersion, now, findingId);
    db.prepare('DELETE FROM rpkp_evidence WHERE finding_id = ?').run(findingId);
  } else {
    const result = db
      .prepare(
        `INSERT INTO rpkp_finding (review_id, category, item_kode, title, ai_status, ai_summary, model, prompt_version, dibuat_pada, diperbarui_pada)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(reviewId, category, itemKode, title, aiResult.status, aiResult.ringkasan, aiResult.model, aiResult.promptVersion, now, now);
    findingId = Number(result.lastInsertRowid);
  }

  const insertEvidence = db.prepare(
    'INSERT INTO rpkp_evidence (finding_id, sumber_dokumen, halaman, kutipan) VALUES (?, ?, ?, ?)'
  );
  for (const e of aiResult.evidence) {
    insertEvidence.run(findingId, e.sumberDokumen, e.halaman, e.kutipan);
  }

  logHistory(reviewId, 'AI_CHECK', `${category} - "${title}": ${aiResult.status}`, user.email);
  return getFinding(findingId);
}

export function upsertCompletenessFinding(reviewId, item, aiResult, user) {
  return upsertFinding(reviewId, 'COMPLETENESS', item.kode, item.label, aiResult, user);
}

// item carries its own kategori ('IPKP' | 'READINESS') from rpkp_completeness_item.
export function upsertChecklistFinding(reviewId, item, aiResult, user) {
  return upsertFinding(reviewId, item.kategori, item.kode, item.label, aiResult, user);
}

export function getFinding(findingId) {
  const finding = db.prepare('SELECT * FROM rpkp_finding WHERE id = ?').get(findingId);
  if (!finding) return null;
  return attachEvidence([finding])[0];
}

function setReviewerStatus(findingId, user, status, note) {
  const finding = db.prepare('SELECT * FROM rpkp_finding WHERE id = ?').get(findingId);
  if (!finding) throw notFound('Temuan tidak ditemukan.');
  const now = new Date().toISOString();
  db.prepare('UPDATE rpkp_finding SET reviewer_status = ?, reviewer_note = ?, diperbarui_pada = ? WHERE id = ?').run(
    status,
    note || null,
    now,
    findingId
  );
  logHistory(finding.review_id, 'FINDING_' + status, `"${finding.title}": ${status}${note ? ` - ${note}` : ''}`, user.email);
  return getFinding(findingId);
}

export function verifyFinding(findingId, user, note) {
  return setReviewerStatus(findingId, user, 'VERIFIED', note);
}

export function rejectFinding(findingId, user, note) {
  return setReviewerStatus(findingId, user, 'REJECTED', note);
}

// Deterministic - no AI call. Looks up each tagged desa's own recorded
// potensi sektor and BUM Desa presence directly from this app's own tables
// (the same ones BANUA POTENSI/BANUA OPPORTUNITY already use) so the
// reviewer can compare RPKP's narrative claims against what BANUA360
// itself has on record for those exact villages.
export function checkBanua360CrossCheck(review, user) {
  const desaList = listReviewDesa(review.id);
  let aiResult;
  if (desaList.length === 0) {
    aiResult = {
      status: 'NOT_FOUND',
      ringkasan: 'Belum ada desa anggota kawasan yang ditandai - tandai desa anggota kawasan terlebih dahulu di tab Review.',
      evidence: [],
      model: 'rule-engine',
      promptVersion: 'rpkp-banua360-crosscheck-v1',
    };
  } else {
    const kodeList = desaList.map((d) => d.kode_desa);
    const placeholders = kodeList.map(() => '?').join(',');
    const potensiRows = db
      .prepare(`SELECT p.kode_desa, p.sektor FROM potensi_desa p WHERE ${ADA_FILTER} AND p.kode_desa IN (${placeholders})`)
      .all(...kodeList);
    const bumRows = db
      .prepare(
        `SELECT DISTINCT kode_desa FROM potensi_desa WHERE nilai = 'Ada' AND subsektor LIKE 'Terdapat BUM Desa%' AND kode_desa IN (${placeholders})`
      )
      .all(...kodeList);
    const bumSet = new Set(bumRows.map((r) => r.kode_desa));
    const sektorByDesa = new Map();
    for (const r of potensiRows) {
      if (!sektorByDesa.has(r.kode_desa)) sektorByDesa.set(r.kode_desa, new Set());
      sektorByDesa.get(r.kode_desa).add(r.sektor);
    }

    const evidence = desaList.map((d) => {
      const sektor = [...(sektorByDesa.get(d.kode_desa) || [])];
      const parts = [
        `Status: ${d.status_desa || '-'}`,
        sektor.length > 0 ? `Potensi tercatat: ${sektor.join(', ')}` : 'Belum ada potensi sektor tercatat',
        `BUM Desa dengan unit usaha tercatat: ${bumSet.has(d.kode_desa) ? 'Ada' : 'Belum ada'}`,
      ];
      return { sumberDokumen: 'Data internal BANUA360', halaman: null, kutipan: `${d.nama_desa} (${d.kecamatan}) - ${parts.join(' · ')}` };
    });

    const desaTanpaPotensi = desaList.filter((d) => !sektorByDesa.has(d.kode_desa));
    const status = desaTanpaPotensi.length === 0 ? 'FOUND' : desaTanpaPotensi.length === desaList.length ? 'NOT_FOUND' : 'PARTIAL';
    const ringkasan =
      status === 'FOUND'
        ? `Seluruh ${desaList.length} desa anggota kawasan memiliki data potensi tercatat di BANUA360 - lihat rincian per desa di bawah untuk dibandingkan dengan klaim di RPKP.`
        : status === 'NOT_FOUND'
          ? `Tidak ada desa anggota kawasan yang memiliki data potensi tercatat di BANUA360.`
          : `${desaTanpaPotensi.length} dari ${desaList.length} desa anggota kawasan belum memiliki data potensi tercatat di BANUA360 (${desaTanpaPotensi.map((d) => d.nama_desa).join(', ')}).`;

    aiResult = { status, ringkasan, evidence, model: 'rule-engine', promptVersion: 'rpkp-banua360-crosscheck-v1' };
  }
  return upsertFinding(review.id, 'BANUA360', 'BANUA360_CROSSCHECK', 'Cross-check Data BANUA360', aiResult, user);
}

const KEPUTUSAN_VALUES = new Set(['DAPAT_DIREKOMENDASIKAN', 'DENGAN_CATATAN', 'BELUM_DAPAT']);

export function getRecommendation(reviewId) {
  return db.prepare('SELECT * FROM rpkp_recommendation WHERE review_id = ?').get(reviewId);
}

// The Recommendation Gate is deliberately a human-only decision - this
// function only ever records what the reviewer chose, never derives or
// suggests a value itself.
export function setRecommendation(reviewId, user, keputusan, catatan) {
  if (!KEPUTUSAN_VALUES.has(keputusan)) throw badRequest('Keputusan tidak dikenali.');
  const now = new Date().toISOString();
  const existing = getRecommendation(reviewId);
  if (existing) {
    db.prepare('UPDATE rpkp_recommendation SET keputusan = ?, catatan = ?, dibuat_oleh = ?, dibuat_pada = ? WHERE review_id = ?').run(
      keputusan,
      catatan || null,
      user.email,
      now,
      reviewId
    );
  } else {
    db.prepare(
      'INSERT INTO rpkp_recommendation (review_id, keputusan, catatan, dibuat_oleh, dibuat_pada) VALUES (?, ?, ?, ?, ?)'
    ).run(reviewId, keputusan, catatan || null, user.email, now);
  }
  logHistory(reviewId, 'RECOMMENDATION_GATE', `Keputusan: ${keputusan}${catatan ? ` - ${catatan}` : ''}`, user.email);
  return getRecommendation(reviewId);
}
