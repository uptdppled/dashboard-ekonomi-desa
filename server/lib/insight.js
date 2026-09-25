import { db } from '../db.js';

// BANUA INSIGHT Phase 1 - three deterministic engines, no AI, no invented
// scores. Every number here traces to a real column already imported
// (skor_indikator, potensi_desa, desa.lat/lng) - see the project's roadmap
// memory for why: AI explains these results, it never generates them.

const GAP_THRESHOLD = 0.6; // same threshold already used by recommend.js's gapIndikator
const FASILITAS_EKONOMI_SUBDIMENSI = 'SUB-DIMENSI FASILTAS PENDUKUNG EKONOMI';

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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
  return { sql: clauses.length ? `AND ${clauses.join(' AND ')}` : '', params };
}

// ---------- 1. Gap Analysis ----------
// Every leaf indicator ("SKOR ..." columns, not the DIMENSI/SUB-DIMENSI
// composite marker rows) scored below GAP_THRESHOLD of its own max weight,
// aggregated by how many desa are affected.
export function buildGapAnalysis(scope) {
  const where = scopeWhere(scope);
  const dimensiClause = scope.dimensi ? 'AND si.dimensi = ?' : '';
  const params = [...where.params];
  if (scope.dimensi) params.push(scope.dimensi);

  const rows = db
    .prepare(
      `SELECT si.dimensi, si.sub_dimensi, si.nama_indikator, si.skor, si.bobot_maks
       FROM skor_indikator si
       JOIN desa d ON d.kode_desa = si.kode_desa
       WHERE si.nama_indikator LIKE 'SKOR %' ${where.sql} ${dimensiClause}`
    )
    .all(...params);

  const byIndikator = new Map();
  for (const r of rows) {
    if (!r.bobot_maks) continue;
    const key = r.nama_indikator;
    const entry = byIndikator.get(key) || {
      dimensi: r.dimensi,
      subDimensi: r.sub_dimensi,
      indikator: r.nama_indikator,
      totalDinilai: 0,
      jumlahGap: 0,
    };
    entry.totalDinilai++;
    if (r.skor / r.bobot_maks < GAP_THRESHOLD) entry.jumlahGap++;
    byIndikator.set(key, entry);
  }

  return [...byIndikator.values()]
    .filter((e) => e.jumlahGap > 0)
    .sort((a, b) => b.jumlahGap - a.jumlahGap);
}

// List of desa affected by a specific indicator's gap (for the drilldown).
export function listDesaGapUntukIndikator(scope, indikator) {
  const where = scopeWhere(scope);
  const rows = db
    .prepare(
      `SELECT d.kode_desa, d.nama_desa, d.kecamatan, d.kabupaten, si.skor, si.bobot_maks
       FROM skor_indikator si
       JOIN desa d ON d.kode_desa = si.kode_desa
       WHERE si.nama_indikator = ? ${where.sql}`
    )
    .all(indikator, ...where.params);
  return rows
    .filter((r) => r.bobot_maks && r.skor / r.bobot_maks < GAP_THRESHOLD)
    .sort((a, b) => a.skor / a.bobot_maks - b.skor / b.bobot_maks || a.nama_desa.localeCompare(b.nama_desa));
}

// ---------- 2. Potensi Pengembangan ----------
// potensi hadir di sektor X + indikator "Fasilitas Pendukung Ekonomi" di
// bawah threshold -> ditandai sebagai potensi pengembangan. Tidak membuat
// skor baru, hanya menghitung irisan dua fakta yang sudah ada.
export function buildPotensiPengembangan(scope) {
  const potensiWhere = scopeWhere(scope);
  const potensiRows = db
    .prepare(
      `SELECT DISTINCT p.sektor, p.kode_desa
       FROM potensi_desa p
       JOIN desa d ON d.kode_desa = p.kode_desa
       WHERE p.nilai = 'Ada' ${potensiWhere.sql}`
    )
    .all(...potensiWhere.params);

  const fasilitasWhere = scopeWhere(scope);
  const fasilitasRows = db
    .prepare(
      `SELECT si.kode_desa, si.skor, si.bobot_maks
       FROM skor_indikator si
       JOIN desa d ON d.kode_desa = si.kode_desa
       WHERE si.nama_indikator = ? ${fasilitasWhere.sql}`
    )
    .all(FASILITAS_EKONOMI_SUBDIMENSI, ...fasilitasWhere.params);
  const gapFasilitasSet = new Set(
    fasilitasRows.filter((r) => r.bobot_maks && r.skor / r.bobot_maks < GAP_THRESHOLD).map((r) => r.kode_desa)
  );

  const bySektor = new Map();
  for (const r of potensiRows) {
    const entry = bySektor.get(r.sektor) || { sektor: r.sektor, jumlahDesaPotensi: 0, jumlahDesaGapFasilitas: 0 };
    entry.jumlahDesaPotensi++;
    if (gapFasilitasSet.has(r.kode_desa)) entry.jumlahDesaGapFasilitas++;
    bySektor.set(r.sektor, entry);
  }

  return [...bySektor.values()].sort((a, b) => b.jumlahDesaPotensi - a.jumlahDesaPotensi);
}

// ---------- 3. Cakupan Data ----------
// Just the coverage KPIs for the "Cakupan Data" panel - direct COUNT
// queries, not a byproduct of running the spatial-matching engine (that
// engine now lives in opportunity.js, see BANUA OPPORTUNITY below).
export function buildCoverage(scope) {
  const totalWhere = scopeWhere(scope);
  const totalDesa = db.prepare(`SELECT COUNT(*) AS n FROM desa d WHERE 1=1 ${totalWhere.sql}`).get(...totalWhere.params).n;

  const koordinatWhere = scopeWhere(scope);
  const desaDenganKoordinat = db
    .prepare(`SELECT COUNT(*) AS n FROM desa d WHERE d.lat IS NOT NULL AND d.lng IS NOT NULL ${koordinatWhere.sql}`)
    .get(...koordinatWhere.params).n;

  const potensiWhere = scopeWhere(scope);
  const desaDenganPotensi = db
    .prepare(
      `SELECT COUNT(DISTINCT p.kode_desa) AS n
       FROM potensi_desa p
       JOIN desa d ON d.kode_desa = p.kode_desa
       WHERE p.nilai = 'Ada' ${potensiWhere.sql}`
    )
    .get(...potensiWhere.params).n;

  return { totalDesa, desaDenganKoordinat, desaTanpaKoordinat: totalDesa - desaDenganKoordinat, desaDenganPotensi };
}

// ---------- 4. Kandidat Naik Status ----------
// desa.nilai_indeks_desa is just a numeric encoding of status_desa itself
// (BERKEMBANG=3, MAJU=4, MANDIRI=5 - constant within a tier, verified
// against the live data), not a real composite score, so it can't say who's
// CLOSE to the next tier. Kemendes's exact promotion formula isn't in our
// data either. The closest defensible, data-driven proxy: rank desa within
// their own tier by the sum of their own 6 BANUA INDEX dimension scores (as
// a fraction of max) - the best performers within a lower tier are the most
// plausible quick-win promotion candidates. This is explicitly OUR ranking,
// not a reproduction of Kemendes's official cutoff - the UI must say so.
const NAIK_STATUS_PAIRS = [
  { dari: 'BERKEMBANG', ke: 'MAJU' },
  { dari: 'MAJU', ke: 'MANDIRI' },
];

export function buildKandidatNaikStatus(scope, { perTier = 30 } = {}) {
  const statusList = NAIK_STATUS_PAIRS.map((p) => p.dari);
  const placeholders = statusList.map(() => '?').join(',');

  const where = scopeWhere(scope);
  const komposit = db
    .prepare(
      `SELECT d.kode_desa, d.nama_desa, d.kecamatan, d.kabupaten, d.status_desa,
              SUM(si.skor) AS totalSkor, SUM(si.bobot_maks) AS totalBobot
       FROM desa d
       JOIN skor_indikator si ON si.kode_desa = d.kode_desa AND si.nama_indikator = si.dimensi
       WHERE d.status_desa IN (${placeholders}) ${where.sql}
       GROUP BY d.kode_desa`
    )
    .all(...statusList, ...where.params);

  const gapWhere = scopeWhere(scope);
  const indikatorRows = db
    .prepare(
      `SELECT d.kode_desa, si.nama_indikator, si.skor, si.bobot_maks
       FROM skor_indikator si
       JOIN desa d ON d.kode_desa = si.kode_desa
       WHERE si.nama_indikator LIKE 'SKOR %' AND si.bobot_maks > 0 AND d.status_desa IN (${placeholders}) ${gapWhere.sql}`
    )
    .all(...statusList, ...gapWhere.params);
  const gapByDesa = new Map();
  for (const r of indikatorRows) {
    const ratio = r.skor / r.bobot_maks;
    if (ratio >= GAP_THRESHOLD) continue;
    if (!gapByDesa.has(r.kode_desa)) gapByDesa.set(r.kode_desa, []);
    gapByDesa.get(r.kode_desa).push({
      indikator: r.nama_indikator.replace(/^SKOR /i, ''),
      skor: r.skor,
      bobotMaks: r.bobot_maks,
      ratio,
    });
  }
  for (const list of gapByDesa.values()) {
    list.sort((a, b) => a.ratio - b.ratio);
    list.length = Math.min(list.length, 3);
  }

  const byStatus = {};
  for (const status of statusList) byStatus[status] = [];
  for (const r of komposit) {
    if (!r.totalBobot) continue;
    byStatus[r.status_desa].push({
      kode_desa: r.kode_desa,
      nama_desa: r.nama_desa,
      kecamatan: r.kecamatan,
      kabupaten: r.kabupaten,
      totalSkor: Math.round(r.totalSkor * 100) / 100,
      totalBobot: r.totalBobot,
      ratio: r.totalSkor / r.totalBobot,
      gapIndikator: gapByDesa.get(r.kode_desa) || [],
    });
  }
  for (const status of statusList) {
    byStatus[status].sort((a, b) => b.ratio - a.ratio);
  }

  return NAIK_STATUS_PAIRS.map(({ dari, ke }) => ({
    dari,
    ke,
    totalDiTier: byStatus[dari].length,
    kandidat: byStatus[dari].slice(0, perTier),
  }));
}

export function listDesaTanpaKoordinat(scope) {
  const where = scopeWhere(scope);
  return db
    .prepare(`SELECT kode_desa, nama_desa, kecamatan, kabupaten FROM desa d WHERE (lat IS NULL OR lng IS NULL) ${where.sql}`)
    .all(...where.params);
}
