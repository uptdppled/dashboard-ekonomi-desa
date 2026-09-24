import { db } from '../db.js';
import { haversineKm } from './insight.js';

// BANUA OPPORTUNITY - reframes deterministic facts as "opportunity cards",
// never a fabricated match/compatibility score (same principle as BANUA
// INSIGHT: a checklist is honest about what's actually known). One shared
// matching engine (coordinates + sektor), several relationship rules on top
// of it - see matchDesaPairs() below. Sektor taxonomy from categorize.js.
const PRODUKSI_SEKTOR = new Set(['Pertanian', 'Perikanan', 'Peternakan', 'Perkebunan', 'Pertambangan']);
const PENGOLAHAN_SEKTOR = new Set(['Kerajinan/Industri']);
// "Pemasaran/Ekspor" was dropped from here: none of its 69 subsektor
// questions are a simple presence flag (they're all "Komoditas X Masuk
// Pasar Modern" / "Wilayah Tujuan Pasar ..." - already assumes marketing
// happened, or is commodity-specific) - counting it as "akses pasar" would
// be exactly the fabricated-market-data the honesty rule here forbids.
// "Fasilitas Perdagangan/Keuangan" alone (bank/LPG-agen/pasar hewan
// presence) is a clean, genuinely verifiable facility signal.
const AKSES_PASAR_SEKTOR = new Set(['Fasilitas Perdagangan/Keuangan']);

// "Ada"/"Tidak Ada" boolean existence questions all follow the "Terdapat X"
// subsektor naming convention (same pattern as index.js's ADA_FILTER) - a
// bare `nilai = 'Ada'` without this restriction also matches "Ada" that
// leaked into unrelated free-text/reference-number subsektor columns for
// the same sektor, over-counting presence. Kerajinan/Industri is the one
// exception: NONE of its subsektor questions are "Terdapat X" boolean
// flags - they are all numeric counts (e.g. "Total industri mikro dan
// kecil di Desa") - so it needs its own query below.
const ADA_FILTER = `p.nilai = 'Ada' AND p.subsektor LIKE 'Terdapat %'`;
const KERAJINAN_SUBSEKTOR = 'Total industri mikro dan kecil di Desa';

// A handful of desa (up to 10 in one case) share an exact duplicate lat/lng
// with each other - the geocoding source falls back to a shared reference
// point (e.g. kecamatan center) when it can't pinpoint an individual
// village address, not real 0km adjacency. Same floor as insight.js.
const MIN_JARAK_KM = 0.5;

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

function loadDesaWithSektor(scope) {
  const where = scopeWhere(scope);
  const desaRows = db
    .prepare(`SELECT kode_desa, nama_desa, kecamatan, kabupaten, lat, lng FROM desa d WHERE lat IS NOT NULL AND lng IS NOT NULL ${where.sql}`)
    .all(...where.params);

  const sektorWhere = scopeWhere(scope);
  const sektorRows = db
    .prepare(
      `SELECT DISTINCT p.kode_desa, p.sektor FROM potensi_desa p
       JOIN desa d ON d.kode_desa = p.kode_desa
       WHERE ${ADA_FILTER} ${sektorWhere.sql}`
    )
    .all(...sektorWhere.params);
  const kerajinanWhere = scopeWhere(scope);
  const kerajinanRows = db
    .prepare(
      `SELECT DISTINCT p.kode_desa FROM potensi_desa p
       JOIN desa d ON d.kode_desa = p.kode_desa
       WHERE p.sektor = 'Kerajinan/Industri' AND p.subsektor = ?
         AND CAST(p.nilai AS INTEGER) > 0 ${kerajinanWhere.sql}`
    )
    .all(KERAJINAN_SUBSEKTOR, ...kerajinanWhere.params);

  const sektorByDesa = new Map();
  for (const r of sektorRows) {
    if (!sektorByDesa.has(r.kode_desa)) sektorByDesa.set(r.kode_desa, new Set());
    sektorByDesa.get(r.kode_desa).add(r.sektor);
  }
  for (const r of kerajinanRows) {
    if (!sektorByDesa.has(r.kode_desa)) sektorByDesa.set(r.kode_desa, new Set());
    sektorByDesa.get(r.kode_desa).add('Kerajinan/Industri');
  }
  return { desaRows, sektorByDesa };
}

// Generic pair matcher: desa with a sektor in sektorASet <-> desa with a
// sektor in sektorBSet, within radiusKm - the one engine behind all 3
// relationship tabs below, just pointed at different sektor sets.
function matchDesaPairs(scope, sektorASet, sektorBSet, { radiusKm = 15, maxResults = 30 } = {}) {
  const { desaRows, sektorByDesa } = loadDesaWithSektor(scope);
  const sideA = desaRows.filter((d) => [...(sektorByDesa.get(d.kode_desa) || [])].some((s) => sektorASet.has(s)));
  const sideB = desaRows.filter((d) => [...(sektorByDesa.get(d.kode_desa) || [])].some((s) => sektorBSet.has(s)));

  const seenPairs = new Set();
  const matches = [];
  for (const a of sideA) {
    const sektorA = [...(sektorByDesa.get(a.kode_desa) || [])].filter((s) => sektorASet.has(s));
    for (const b of sideB) {
      if (a.kode_desa === b.kode_desa) continue;
      const pairKey = [a.kode_desa, b.kode_desa].sort().join('|');
      if (seenPairs.has(pairKey)) continue;
      const jarakKm = haversineKm(a.lat, a.lng, b.lat, b.lng);
      if (jarakKm > radiusKm || jarakKm < MIN_JARAK_KM) continue;
      seenPairs.add(pairKey);
      const sektorB = [...(sektorByDesa.get(b.kode_desa) || [])].filter((s) => sektorBSet.has(s));
      matches.push({
        desaA: { kode_desa: a.kode_desa, nama_desa: a.nama_desa, kecamatan: a.kecamatan, kabupaten: a.kabupaten, sektor: sektorA },
        desaB: { kode_desa: b.kode_desa, nama_desa: b.nama_desa, kecamatan: b.kecamatan, kabupaten: b.kabupaten, sektor: sektorB },
        jarakKm: Math.round(jarakKm * 10) / 10,
      });
    }
  }
  matches.sort((a, b) => a.jarakKm - b.jarakKm);
  return matches.slice(0, maxResults);
}

// ---------- Tab: Potensi -> Potensi (rantai nilai hulu -> pengolahan) ----------
export function buildPotensiPotensi(scope, opts) {
  return matchDesaPairs(scope, PRODUKSI_SEKTOR, PENGOLAHAN_SEKTOR, opts).map((m) => ({
    tipe: 'potensi_potensi',
    label: 'Potensi → Potensi (Pengolahan)',
    desaA: m.desaA,
    desaB: m.desaB,
    jarakKm: m.jarakKm,
    checklist: [
      { ok: true, label: 'Potensi produksi & pengolahan saling melengkapi' },
      { ok: true, label: 'Berdekatan secara geografis' },
      { ok: false, label: 'Data kapasitas pengolahan belum tersedia' },
    ],
  }));
}

// ---------- Tab: Produksi -> Akses Pasar ----------
// Deliberately NOT called "Produksi -> Pasar": our data only shows
// fasilitas perdagangan/pemasaran EXISTS nearby, not actual market demand,
// buyers, or transaction volume - naming it "akses" keeps the claim honest.
export function buildProduksiAksesPasar(scope, opts) {
  return matchDesaPairs(scope, PRODUKSI_SEKTOR, AKSES_PASAR_SEKTOR, opts).map((m) => ({
    tipe: 'produksi_akses_pasar',
    label: 'Produksi → Akses Pasar',
    desaA: m.desaA,
    desaB: m.desaB,
    jarakKm: m.jarakKm,
    checklist: [
      { ok: true, label: 'Komoditas produksi tercatat' },
      { ok: true, label: 'Fasilitas perdagangan/pemasaran tersedia di dekatnya' },
      { ok: false, label: 'Data volume produksi & permintaan pasar belum tersedia' },
    ],
  }));
}

// ---------- Tab: BUM Desa <-> Potensi Desa ----------
// A desa where a BUM Desa unit already operates in a sektor ("Terdapat BUM
// Desa ... Bidang X") AND that same desa has genuine potensi (Group A - see
// categorizePotensi.js) in that same sektor: the institutional vehicle to
// capture the potential already exists, not just the raw material. Only 4
// sektor have this "BUM Desa Bidang X" flag in the source data (Pariwisata,
// Perkebunan, Pertanian, Peternakan), verified against a live data dump.
const BUM_DESA_BIDANG = [
  'Terdapat BUM Desa Pariwisata Bidang Wisata Desa',
  'Terdapat BUM Desa Pariwisata Bidang Wisata Alam',
  'Terdapat BUM Desa Perdagangan Bidang Perkebunan',
  'Terdapat BUM Desa Perdagangan Bidang Pertanian',
  'Terdapat BUM Desa Perantara Bidang Penggilingan Padi',
  'Terdapat BUM Desa Perdagangan Bidang Peternakan',
];

export function buildBumDesaPotensi(scope, { maxResults = 60 } = {}) {
  const where = scopeWhere(scope);
  const bidangPlaceholders = BUM_DESA_BIDANG.map(() => '?').join(',');

  const bumRows = db
    .prepare(
      `SELECT p.kode_desa, p.sektor, p.subsektor
       FROM potensi_desa p JOIN desa d ON d.kode_desa = p.kode_desa
       WHERE p.nilai = 'Ada' AND p.subsektor IN (${bidangPlaceholders}) ${where.sql}`
    )
    .all(...BUM_DESA_BIDANG, ...where.params);
  if (bumRows.length === 0) return [];

  const sektorSet = [...new Set(bumRows.map((r) => r.sektor))];
  const sektorPlaceholders = sektorSet.map(() => '?').join(',');
  const potRows = db
    .prepare(
      `SELECT p.kode_desa, p.sektor, p.subsektor
       FROM potensi_desa p JOIN desa d ON d.kode_desa = p.kode_desa
       WHERE p.nilai = 'Ada' AND p.subsektor LIKE 'Terdapat %' AND p.sektor IN (${sektorPlaceholders}) ${where.sql}`
    )
    .all(...sektorSet, ...where.params);

  const potBySektorDesa = new Map();
  for (const r of potRows) {
    if (BUM_DESA_BIDANG.includes(r.subsektor)) continue; // the BUM Desa flag itself isn't "potensi"
    const key = `${r.kode_desa}::${r.sektor}`;
    if (!potBySektorDesa.has(key)) potBySektorDesa.set(key, []);
    potBySektorDesa.get(key).push(r.subsektor.replace(/^Terdapat /i, ''));
  }

  const candidateKodes = [...new Set(bumRows.map((r) => r.kode_desa))];
  const kodePlaceholders = candidateKodes.map(() => '?').join(',');
  const desaRows = db
    .prepare(`SELECT kode_desa, nama_desa, kecamatan, kabupaten, status_desa FROM desa WHERE kode_desa IN (${kodePlaceholders})`)
    .all(...candidateKodes);
  const desaMap = new Map(desaRows.map((d) => [d.kode_desa, d]));

  const out = [];
  for (const r of bumRows) {
    const potensi = potBySektorDesa.get(`${r.kode_desa}::${r.sektor}`);
    if (!potensi || potensi.length === 0) continue;
    const desa = desaMap.get(r.kode_desa);
    if (!desa) continue;
    out.push({
      tipe: 'bumdesa_potensi',
      label: `BUM Desa → Potensi ${r.sektor}`,
      desa,
      sektor: r.sektor,
      bidang: r.subsektor.replace(/^Terdapat /i, ''),
      potensi,
      checklist: [
        { ok: true, label: `Potensi ${r.sektor} tercatat (${potensi.join(', ')})` },
        { ok: true, label: `BUM Desa sudah punya unit usaha bidang ${r.subsektor.replace(/^Terdapat BUM Desa /i, '')}` },
        { ok: false, label: 'Data omzet/kapasitas unit usaha belum tersedia' },
      ],
    });
  }
  return out.slice(0, maxResults);
}

// ---------- Tab: Desa <-> Desa (general explorer, semua jenis relationship) ----------
export function buildDesaKeDesa(scope, opts) {
  return [...buildPotensiPotensi(scope, opts), ...buildProduksiAksesPasar(scope, opts), ...buildBumDesaPotensi(scope, opts)];
}

// ---------- Tab: Potensi Kawasan (kandidat pembentukan Kawasan Perdesaan) ----------
// Data-driven clustering per Permendesa PDTT No. 5/2016 Pasal 9's criteria:
// beberapa desa BERBATASAN dalam SATU kabupaten/kota dengan KESAMAAN/
// KETERKAITAN potensi. This is OUR OWN heuristic candidate-finder, not an
// official Kemendes/Pemda designation - neither Permendesa 5/2016 nor PP
// 16/2026 define a "jenis kawasan" taxonomy (agropolitan/minapolitan/etc
// come from other sektor-specific regulations, not these two) - the
// "jenisKawasan" label here is descriptive shorthand for the dominant
// sektor, not a legal category, and the UI must say so.
const KAWASAN_JENIS_LABEL = {
  Pertanian: 'Kawasan Pertanian (Agropolitan)',
  Perikanan: 'Kawasan Perikanan (Minapolitan)',
  Peternakan: 'Kawasan Peternakan',
  Perkebunan: 'Kawasan Perkebunan',
  Pertambangan: 'Kawasan Pertambangan',
  Pariwisata: 'Kawasan Pariwisata',
  'Kerajinan/Industri': 'Kawasan Industri Perdesaan',
};

// "Berbatasan" is approximated as within this radius of a cluster hub (we
// only have point coordinates, not administrative boundary polygons) -
// tighter than the 15km used for pair matching, since a kawasan is meant to
// be a cohesive, genuinely local area. 10km produced single clusters of
// 100+ desa in dense/compact kabupaten (e.g. Hulu Sungai Utara, where ~93%
// of desa report some Peternakan potensi) - too broad to be a useful
// candidate. 5km was checked empirically against several kabupaten
// (dense and sparse) and gives a spread of distinct, locally-plausible
// clusters instead of one kabupaten-spanning blob.
const KAWASAN_RADIUS_KM = 5;
const KAWASAN_MIN_DESA = 3;

// Greedy "hub" clustering, NOT single-linkage/union-find: union-find chains
// transitively (A-B within radius, B-C within radius => A,C grouped even if
// A-C are far apart), which on real data merged 190+ of ~200 desa in one
// kabupaten into a single "cluster" spanning the whole kabupaten - useless
// as a kawasan candidate. Here, each cluster is anchored to one hub desa and
// only includes desa within radiusKm of THAT hub, so every cluster stays
// genuinely compact (any two members are within 2*radiusKm of each other,
// not an unbounded chain). Picks the hub with the most neighbors first.
function clusterByHub(points, radiusKm, minDesa) {
  const remaining = new Map(points.map((p) => [p.kode_desa, p]));
  const clusters = [];
  while (remaining.size > 0) {
    let bestMembers = null;
    for (const seed of remaining.values()) {
      const members = [];
      for (const p of remaining.values()) {
        if (haversineKm(seed.lat, seed.lng, p.lat, p.lng) <= radiusKm) members.push(p);
      }
      if (!bestMembers || members.length > bestMembers.length) bestMembers = members;
    }
    if (!bestMembers || bestMembers.length < minDesa) break;
    for (const m of bestMembers) remaining.delete(m.kode_desa);
    clusters.push(bestMembers);
  }
  return clusters;
}

export function buildPotensiKawasan(scope, { radiusKm = KAWASAN_RADIUS_KM, minDesa = KAWASAN_MIN_DESA, maxResults = 40 } = {}) {
  const { desaRows, sektorByDesa } = loadDesaWithSektor(scope);

  const byKabupaten = new Map();
  for (const d of desaRows) {
    if (!byKabupaten.has(d.kabupaten)) byKabupaten.set(d.kabupaten, []);
    byKabupaten.get(d.kabupaten).push(d);
  }

  const results = [];
  for (const [kabupaten, desaList] of byKabupaten) {
    for (const sektor of Object.keys(KAWASAN_JENIS_LABEL)) {
      const kandidat = desaList.filter((d) => (sektorByDesa.get(d.kode_desa) || new Set()).has(sektor));
      if (kandidat.length < minDesa) continue;

      const clusters = clusterByHub(kandidat, radiusKm, minDesa);

      for (const anggota of clusters) {
        const hasHilir = anggota.some((d) => {
          const s = sektorByDesa.get(d.kode_desa) || new Set();
          return [...PENGOLAHAN_SEKTOR, ...AKSES_PASAR_SEKTOR].some((x) => s.has(x));
        });
        results.push({
          tipe: 'kawasan',
          kabupaten,
          jenisKawasan: KAWASAN_JENIS_LABEL[sektor],
          sektorDominan: sektor,
          jumlahDesa: anggota.length,
          desa: anggota.map((d) => ({ kode_desa: d.kode_desa, nama_desa: d.nama_desa, kecamatan: d.kecamatan })),
          checklist: [
            { ok: true, label: `${anggota.length} desa berbatasan dengan potensi ${sektor} sejenis` },
            { ok: true, label: `Berada dalam 1 kabupaten (${kabupaten}) - syarat Pasal 9 Permendesa 5/2016` },
            {
              ok: hasHilir,
              label: hasHilir
                ? 'Sudah ada desa dengan fasilitas pengolahan/akses pasar di kawasan ini (hulu-hilir)'
                : 'Belum ada desa dengan fasilitas pengolahan/akses pasar di kawasan ini (baru hulu)',
            },
            { ok: false, label: 'Data tata ruang & kajian kesesuaian lahan belum tersedia' },
          ],
        });
      }
    }
  }

  results.sort((a, b) => b.jumlahDesa - a.jumlahDesa);
  return results.slice(0, maxResults);
}
