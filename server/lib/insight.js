import { db } from '../db.js';

// BANUA INSIGHT Phase 1 - three deterministic engines, no AI, no invented
// scores. Every number here traces to a real column already imported
// (skor_indikator, potensi_desa, desa.lat/lng) - see the project's roadmap
// memory for why: AI explains these results, it never generates them.

const GAP_THRESHOLD = 0.6; // same threshold already used by recommend.js's gapIndikator
const FASILITAS_EKONOMI_SUBDIMENSI = 'SUB-DIMENSI FASILTAS PENDUKUNG EKONOMI';

// Production sectors (raw material) vs. processing/market-access sectors -
// the closest real mapping to "producer <-> processor" using the sector
// taxonomy that actually exists in categorize.js (there is no literal
// "Pengolahan" sector in the source data).
const PRODUKSI_SEKTOR = new Set(['Pertanian', 'Perikanan', 'Peternakan', 'Perkebunan', 'Pertambangan']);
const PROSES_PASAR_SEKTOR = new Set(['Kerajinan/Industri', 'Fasilitas Perdagangan/Keuangan', 'Pemasaran/Ekspor']);

function haversineKm(lat1, lng1, lat2, lng2) {
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
  return rows.filter((r) => r.bobot_maks && r.skor / r.bobot_maks < GAP_THRESHOLD);
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

// ---------- 3. Spatial Matching ----------
// Haversine distance between every desa with a "produksi" sektor and every
// desa with a "proses/pasar" sektor within radiusKm. O(n^2) over ~1,400
// geocoded desa is a few million cheap float ops - no spatial index needed
// at this scale.
// 30 of the 1,426 geocoded desa (15 pairs) share an exact duplicate
// lat/lng with another desa - almost certainly a data-entry artifact (e.g.
// a kecamatan-center coordinate copied across villages), not two distinct
// village centroids genuinely 0m apart. Excluding anything under this floor
// keeps the "closest matches" list from being dominated by that artifact.
const MIN_JARAK_KM = 0.5;

export function buildSpatialMatching(scope, { radiusKm = 15, maxResults = 30 } = {}) {
  const where = scopeWhere(scope);
  const desaRows = db
    .prepare(`SELECT kode_desa, nama_desa, kecamatan, kabupaten, lat, lng FROM desa d WHERE 1=1 ${where.sql}`)
    .all(...where.params);

  const totalDesa = desaRows.length;
  const withKoordinat = desaRows.filter((d) => d.lat !== null && d.lng !== null);
  const tanpaKoordinat = totalDesa - withKoordinat.length;

  const sektorWhere = scopeWhere(scope);
  const sektorRows = db
    .prepare(
      `SELECT DISTINCT p.kode_desa, p.sektor FROM potensi_desa p
       JOIN desa d ON d.kode_desa = p.kode_desa
       WHERE p.nilai = 'Ada' ${sektorWhere.sql}`
    )
    .all(...sektorWhere.params);
  const sektorByDesa = new Map();
  for (const r of sektorRows) {
    (sektorByDesa.get(r.kode_desa) || sektorByDesa.set(r.kode_desa, new Set()).get(r.kode_desa)).add(r.sektor);
  }

  const produsen = withKoordinat.filter((d) =>
    [...(sektorByDesa.get(d.kode_desa) || [])].some((s) => PRODUKSI_SEKTOR.has(s))
  );
  const prosesor = withKoordinat.filter((d) =>
    [...(sektorByDesa.get(d.kode_desa) || [])].some((s) => PROSES_PASAR_SEKTOR.has(s))
  );

  // A village pair where both sides independently qualify as producer AND
  // market/processing (a common overlap) would otherwise appear twice, once
  // per direction - dedupe by the unordered pair so each pair is reported once.
  const seenPairs = new Set();
  const matches = [];
  for (const a of produsen) {
    const sektorA = [...(sektorByDesa.get(a.kode_desa) || [])].filter((s) => PRODUKSI_SEKTOR.has(s));
    for (const b of prosesor) {
      if (a.kode_desa === b.kode_desa) continue;
      const pairKey = [a.kode_desa, b.kode_desa].sort().join('|');
      if (seenPairs.has(pairKey)) continue;
      const jarakKm = haversineKm(a.lat, a.lng, b.lat, b.lng);
      if (jarakKm > radiusKm || jarakKm < MIN_JARAK_KM) continue;
      seenPairs.add(pairKey);
      const sektorB = [...(sektorByDesa.get(b.kode_desa) || [])].filter((s) => PROSES_PASAR_SEKTOR.has(s));
      matches.push({
        desaA: { kode_desa: a.kode_desa, nama_desa: a.nama_desa, kecamatan: a.kecamatan, kabupaten: a.kabupaten, sektor: sektorA },
        desaB: { kode_desa: b.kode_desa, nama_desa: b.nama_desa, kecamatan: b.kecamatan, kabupaten: b.kabupaten, sektor: sektorB },
        jarakKm: Math.round(jarakKm * 10) / 10,
      });
    }
  }
  matches.sort((a, b) => a.jarakKm - b.jarakKm);

  return {
    coverage: {
      totalDesa,
      desaDenganKoordinat: withKoordinat.length,
      desaTanpaKoordinat: tanpaKoordinat,
      desaDenganPotensi: sektorByDesa.size,
    },
    matches: matches.slice(0, maxResults),
  };
}

export function listDesaTanpaKoordinat(scope) {
  const where = scopeWhere(scope);
  return db
    .prepare(`SELECT kode_desa, nama_desa, kecamatan, kabupaten FROM desa d WHERE (lat IS NULL OR lng IS NULL) ${where.sql}`)
    .all(...where.params);
}
