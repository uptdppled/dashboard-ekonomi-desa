import XLSX from 'xlsx';

function isTextual(val) {
  if (val === null || val === undefined) return false;
  const s = String(val).trim();
  if (s === '') return false;
  return !/^-?\d+(\.\d+)?$/.test(s);
}

// Several question blocks in the source sheets (e.g. "Rekap Isu"'s per-commodity
// Produk Unggulan / Wisata blocks) repeat the exact same generic follow-up
// label ("Total Produksi dalam 1 Tahun Terakhir", "Jarak dari kantor desa
// menuju objek wisata", ...) once per item, with the item name only present
// on the preceding "Terdapat ..." existence-question column. Left as-is,
// those duplicate header strings collide as React keys and as SQL GROUP BY
// keys (silently merging unrelated commodities' counts together). This
// tags each duplicate with the nearest preceding "Terdapat ..." item name.
const ITEM_PREFIXES = [
  'Terdapat Produk Unggulan ',
  'Terdapat Budidaya ',
  'Terdapat Peternakan ',
  'Terdapat Wisata ',
  'Terdapat ',
];

function disambiguateHeaders(headers) {
  const freq = new Map();
  for (const h of headers) freq.set(h, (freq.get(h) || 0) + 1);

  let lastItem = null;
  const withItemContext = headers.map((h) => {
    for (const prefix of ITEM_PREFIXES) {
      if (h.startsWith(prefix)) {
        lastItem = h.slice(prefix.length).trim();
        break;
      }
    }
    return freq.get(h) > 1 && lastItem ? `${h} (${lastItem})` : h;
  });

  // The item-context pass above doesn't fully resolve every case - some
  // blocks repeat the identical label twice under the same item (e.g. a
  // "Domestik" and an "Ekspor" variant with otherwise identical wording),
  // and long gaps between "Terdapat ..." anchors can attach a stale item
  // name. Rather than chase every such pattern, guarantee uniqueness here:
  // anything still colliding gets a "#2", "#3", ... occurrence suffix.
  const seenCount = new Map();
  return withItemContext.map((h) => {
    const n = (seenCount.get(h) || 0) + 1;
    seenCount.set(h, n);
    return n > 1 ? `${h} #${n}` : h;
  });
}

/**
 * Generic parser for the "id.kemendesa.go.id" export sheets used across both
 * source workbooks. Header text may be spread across up to 3 rows (a row of
 * short question codes above a row of full question text); the row holding
 * the literal cell "Kabupaten" anchors the header block. Data rows are
 * detected by a 9-12 digit "Kode Desa" value rather than a fixed row number,
 * since header block height differs per sheet.
 */
export function parseSheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: true });

  const headerRowIdx = rows.findIndex((r) =>
    r.some((c) => typeof c === 'string' && c.trim().toLowerCase() === 'kabupaten')
  );
  if (headerRowIdx === -1) throw new Error('Header row (cell "Kabupaten") not found in sheet');

  const headerRow = rows[headerRowIdx] || [];
  const nextRow = rows[headerRowIdx + 1] || [];
  const nextRow2 = rows[headerRowIdx + 2] || [];
  const width = Math.max(headerRow.length, nextRow.length, nextRow2.length);

  const rawHeaders = [];
  for (let i = 0; i < width; i++) {
    if (isTextual(headerRow[i])) rawHeaders.push(String(headerRow[i]).trim());
    else if (isTextual(nextRow[i])) rawHeaders.push(String(nextRow[i]).trim());
    else if (isTextual(nextRow2[i])) rawHeaders.push(String(nextRow2[i]).trim());
    else rawHeaders.push(String(headerRow[i] ?? '').trim());
  }
  const headers = disambiguateHeaders(rawHeaders);

  const kodeDesaIdx = headers.findIndex((h) => /kode desa/i.test(h));
  if (kodeDesaIdx === -1) throw new Error('Column "Kode Desa" not found in sheet headers');

  const isKodeDesa = (v) => /^\d{9,12}$/.test(String(v ?? '').trim());

  const dataRows = rows
    .slice(headerRowIdx + 1)
    .filter((r) => isKodeDesa(r[kodeDesaIdx]));

  // The row immediately below the header often carries per-indicator max
  // weight ("bobot") for score sheets; harmless to expose even when unused.
  const weightRow = nextRow;

  return { headers, dataRows, kodeDesaIdx, weightRow, headerRowIdx };
}

/**
 * Best-effort parser for the free-text "Titik Koordinat Desa" field.
 * Field officers entered coordinates in many inconsistent formats
 * (decimal with S/E suffix, plain decimal, comma-as-decimal-separator,
 * DMS fragments, outright typos). We extract the first two decimal-looking
 * tokens, normalize sign by hemisphere suffix, and reject anything outside
 * a generous Kalimantan Selatan bounding box rather than guess further.
 */
export function parseCoordinate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const tokenRe = /(-?\d+[.,]\d+)\s*([SsEe])?/g;
  const tokens = [...s.matchAll(tokenRe)];
  if (tokens.length < 2) return null;

  const toNumber = (numStr) => parseFloat(numStr.replace(',', '.'));

  let lat = toNumber(tokens[0][1]);
  let lng = toNumber(tokens[1][1]);
  const latSuffix = tokens[0][2];
  const lngSuffix = tokens[1][2];

  if (latSuffix && /s/i.test(latSuffix)) lat = -Math.abs(lat);
  else lat = -Math.abs(lat); // Kalsel is entirely south of the equator

  if (lngSuffix && /w/i.test(lngSuffix)) lng = -Math.abs(lng);
  else lng = Math.abs(lng); // Kalsel is entirely east of Greenwich

  const BOUNDS = { latMin: -6, latMax: 0, lngMin: 112, lngMax: 118 };
  if (lat < BOUNDS.latMin || lat > BOUNDS.latMax) return null;
  if (lng < BOUNDS.lngMin || lng > BOUNDS.lngMax) return null;

  return { lat, lng };
}
