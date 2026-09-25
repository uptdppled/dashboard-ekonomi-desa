import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { Link, useSearchParams } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import { api } from '../api';
import FilterBar from '../components/FilterBar';
import { cleanParams } from '../utils';
import { useTheme } from '../theme';
import { STATUS_COLORS } from '../colors';
import { useDefinisiSkor, formatTooltip } from '../definisi';

const KALSEL_CENTER = [-3.05, 115.3];

// Same thresholds as DimensiDetail's severity() and insight.js's GAP_THRESHOLD,
// so "Gap" on the map means the same thing as everywhere else in the app.
const GAP_LEVELS = [
  { key: 'gap', label: 'Gap (<60% bobot maks)', color: '#b3261e' },
  { key: 'sedang', label: 'Sedang (60-80%)', color: '#d9932a' },
  { key: 'baik', label: 'Baik (>=80%)', color: '#0ca30c' },
  { key: 'nodata', label: 'Tidak ada data', color: '#9c9a92' },
];

function gapLevel(p) {
  if (p.skor_indikator == null || !p.bobot_indikator) return 'nodata';
  const ratio = p.skor_indikator / p.bobot_indikator;
  if (ratio < 0.6) return 'gap';
  if (ratio < 0.8) return 'sedang';
  return 'baik';
}

// Zoom to whatever the current filter returns; an unfiltered load keeps the
// whole-province default view.
function FitToPoints({ points, enabled }) {
  const map = useMap();
  useEffect(() => {
    if (!enabled || !points || points.length === 0) return;
    map.fitBounds(points.map((p) => [p.lat, p.lng]), { padding: [30, 30], maxZoom: 13 });
  }, [points, enabled, map]);
  return null;
}

export default function PetaEkonomi() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState({
    kabupaten: searchParams.get('kabupaten') || '',
    kecamatan: searchParams.get('kecamatan') || '',
  });
  const indikator = searchParams.get('indikator') || '';
  const [indikatorList, setIndikatorList] = useState([]);
  const [points, setPoints] = useState(null);
  const [error, setError] = useState(null);
  const { resolved } = useTheme();
  const statusColors = STATUS_COLORS[resolved];

  useEffect(() => {
    api.petaIndikator().then(setIndikatorList).catch(() => {});
  }, []);

  useEffect(() => {
    setPoints(null);
    setError(null);
    api.peta(cleanParams({ ...filter, indikator })).then(setPoints).catch((e) => setError(e.message));
  }, [filter, indikator]);

  function setIndikator(value) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('indikator', value);
    else next.delete('indikator');
    setSearchParams(next, { replace: true });
  }

  const byDimensi = useMemo(() => {
    const groups = new Map();
    for (const it of indikatorList) {
      if (!groups.has(it.dimensi)) groups.set(it.dimensi, []);
      groups.get(it.dimensi).push(it);
    }
    return [...groups.entries()];
  }, [indikatorList]);

  // Worst last so red markers draw on top of green/yellow ones sharing a spot.
  const drawn = useMemo(() => {
    if (!points || !indikator) return points;
    const order = { baik: 0, nodata: 1, sedang: 2, gap: 3 };
    return [...points].sort((a, b) => order[gapLevel(a)] - order[gapLevel(b)]);
  }, [points, indikator]);

  const counts = useMemo(() => {
    const c = { gap: 0, sedang: 0, baik: 0, nodata: 0 };
    if (points && indikator) for (const p of points) c[gapLevel(p)]++;
    return c;
  }, [points, indikator]);

  const definisiSkor = useDefinisiSkor();
  const definisi = indikator ? formatTooltip(definisiSkor[indikator]) : undefined;

  const scopeLabel = filter.kecamatan
    ? `Kecamatan ${filter.kecamatan}, ${filter.kabupaten}`
    : filter.kabupaten
      ? `Kabupaten ${filter.kabupaten}`
      : 'Seluruh Kalimantan Selatan';

  // Where the gaps concentrate, one level below the current filter (province
  // -> kabupaten, kabupaten -> kecamatan); nothing to break down once a
  // single kecamatan is selected.
  const wilayahGap = useMemo(() => {
    if (!points || !indikator || filter.kecamatan) return null;
    const field = filter.kabupaten ? 'kecamatan' : 'kabupaten';
    const groups = new Map();
    for (const p of points) {
      const key = p[field];
      const g = groups.get(key) || { nama: key, total: 0, gap: 0 };
      g.total++;
      if (gapLevel(p) === 'gap') g.gap++;
      groups.set(key, g);
    }
    return {
      field,
      rows: [...groups.values()].filter((g) => g.gap > 0).sort((a, b) => b.gap - a.gap || b.gap / b.total - a.gap / a.total).slice(0, 5),
    };
  }, [points, indikator, filter.kabupaten, filter.kecamatan]);

  const statusRows = useMemo(() => {
    if (!points || indikator) return [];
    const c = new Map();
    for (const p of points) c.set(p.status_desa, (c.get(p.status_desa) || 0) + 1);
    return Object.keys(statusColors).map((status) => ({ status, color: statusColors[status], n: c.get(status) || 0 }));
  }, [points, indikator, statusColors]);

  const avgSkorEkonomi = useMemo(() => {
    if (!points || indikator) return null;
    const vals = points.map((p) => p.skor_ekonomi).filter((v) => v != null);
    return vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null;
  }, [points, indikator]);

  const total = points ? points.length : 0;
  const pct = (n) => (total ? `${Math.round((n / total) * 100)}%` : '-');

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Peta Sebaran Desa</h1>
        <p className="page-desc">
          Titik lokasi seluruh desa berdasarkan koordinat GPS hasil geocoding alamat desa. Pilih satu indikator untuk melihat sebaran
          desa yang rendah - paling berguna setelah difilter ke satu kabupaten atau kecamatan.
        </p>
      </div>
      <FilterBar value={filter} onChange={setFilter} />

      <div className="filter-bar" style={{ marginTop: 0 }}>
        <select value={indikator} onChange={(e) => setIndikator(e.target.value)} style={{ maxWidth: '100%' }}>
          <option value="">Warnai berdasarkan: Status Desa</option>
          {byDimensi.map(([dimensi, items]) => (
            <optgroup key={dimensi} label={dimensi}>
              {items.map((it) => (
                <option key={it.indikator} value={it.indikator}>{it.indikator.replace(/^SKOR /i, '')}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {error && <div className="state-msg state-error">{error}</div>}
      {!points && !error && <div className="state-msg">Memuat titik peta...</div>}

      {points && (
        <div className="panel" style={{ padding: '14px 18px' }}>
          <h2 className="panel-title" style={{ marginBottom: 6 }}>Keterangan</h2>
          <p style={{ fontSize: 12.5, margin: '0 0 4px' }}>
            <strong>{indikator ? indikator.replace(/^SKOR /i, '') : 'Status Desa'}</strong> &middot; {scopeLabel} &middot;{' '}
            <strong>{total.toLocaleString('id-ID')}</strong> desa ditampilkan
          </p>
          {indikator && definisi && (
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 8px', whiteSpace: 'pre-line' }}>{definisi}</p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18, marginTop: 10 }}>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>
                {indikator ? 'KONDISI INDIKATOR' : 'STATUS DESA'}
              </div>
              {(indikator
                ? GAP_LEVELS.map((l) => ({ key: l.key, label: l.label, color: l.color, n: counts[l.key] }))
                : statusRows.map((r) => ({ key: r.status, label: r.status, color: r.color, n: r.n }))
              ).map((r) => (
                <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, padding: '2px 0' }}>
                  <span><span className="quadrant-dot" style={{ background: r.color }} />{r.label}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <strong>{r.n.toLocaleString('id-ID')}</strong> <span style={{ color: 'var(--text-muted)' }}>({pct(r.n)})</span>
                  </span>
                </div>
              ))}
              {!indikator && avgSkorEkonomi != null && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                  Rata-rata Skor Ekonomi: <strong>{avgSkorEkonomi.toFixed(1)}</strong>
                </div>
              )}
            </div>
            {indikator && wilayahGap && (
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>
                  {wilayahGap.field === 'kabupaten' ? 'KABUPATEN' : 'KECAMATAN'} DENGAN GAP TERBANYAK
                </div>
                {wilayahGap.rows.length === 0 && <div style={{ fontSize: 12.5 }}>Tidak ada desa dengan gap.</div>}
                {wilayahGap.rows.map((g) => (
                  <div key={g.nama} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, padding: '2px 0' }}>
                    <span>{g.nama}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                      <strong>{g.gap}</strong> <span style={{ color: 'var(--text-muted)' }}>dari {g.total} desa</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '10px 0 0' }}>
            {indikator
              ? 'Merah = skor di bawah 60% bobot maksimal indikator (prioritas intervensi). Klik titik untuk melihat desa dan skornya.'
              : 'Warna titik menunjukkan status desa. Pilih indikator di atas untuk melihat sebaran kondisi tertentu.'}
          </p>
        </div>
      )}

      {points && (
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <MapContainer center={KALSEL_CENTER} zoom={8} style={{ height: 560, width: '100%' }}>
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitToPoints points={points} enabled={!!(filter.kabupaten || filter.kecamatan)} />
            {drawn.map((p) => {
              const level = gapLevel(p);
              const color = indikator ? GAP_LEVELS.find((l) => l.key === level).color : statusColors[p.status_desa] || '#666';
              return (
                <CircleMarker
                  key={`${p.kode_desa}-${indikator}`}
                  center={[p.lat, p.lng]}
                  radius={5}
                  pathOptions={{ color, fillOpacity: 0.7 }}
                >
                  <Popup>
                    <strong>{p.nama_desa}</strong><br />
                    {p.kecamatan}, {p.kabupaten}<br />
                    Status: {p.status_desa}<br />
                    {indikator
                      ? <>Indikator: {p.skor_indikator ?? '-'} / {p.bobot_indikator ?? '-'}<br /></>
                      : <>Skor Ekonomi: {p.skor_ekonomi ?? '-'}<br /></>}
                    <Link to={`/profil-desa?kode=${p.kode_desa}`}>Lihat profil desa</Link>
                  </Popup>
                </CircleMarker>
              );
            })}
          </MapContainer>
        </div>
      )}
      {points && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{points.length.toLocaleString('id-ID')} desa dengan koordinat tersedia.</p>}
    </div>
  );
}
