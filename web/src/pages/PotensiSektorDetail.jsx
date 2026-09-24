import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../api';
import FilterBar from '../components/FilterBar';
import StatusBadge from '../components/StatusBadge';
import { cleanParams } from '../utils';
import { useTheme } from '../theme';
import { ACCENT_SECONDARY, STATUS_COLORS } from '../colors';
import { useDefinisiPotensi, formatTooltip } from '../definisi';

const KALSEL_CENTER = [-3.05, 115.3];

// Every sektor's subsektor is grouped into 4 categories (server tags each
// row with `kelompok`) instead of one flat potensi/bukan-potensi list - see
// server/lib/categorizePotensi.js for the classification rules.
const KELOMPOK_ORDER = ['potensi', 'kelembagaan', 'akses', 'pemanfaatan'];
const KELOMPOK_META = {
  potensi: { icon: '🎯', label: 'Potensi / Apa yang Dimiliki', desc: 'Apa yang dimiliki desa.' },
  kelembagaan: { icon: '🏢', label: 'Kelembagaan & Pengelolaan', desc: 'Apakah sudah dikelola secara kelembagaan.' },
  akses: { icon: '🚗', label: 'Akses & Dukungan', desc: 'Kemampuan desa mengembangkan potensi ini.' },
  pemanfaatan: { icon: '📈', label: 'Pemanfaatan / Aktivitas', desc: 'Apakah sudah dimanfaatkan/dijalankan.' },
};

export default function PotensiSektorDetail() {
  const { sektor } = useParams();
  const [filter, setFilter] = useState({});
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showDesaList, setShowDesaList] = useState(false);
  const [selectedSubsektor, setSelectedSubsektor] = useState(null);
  const [subDesa, setSubDesa] = useState(null);
  const [subError, setSubError] = useState(null);
  const { resolved } = useTheme();
  const accent = ACCENT_SECONDARY[resolved];
  const statusColors = STATUS_COLORS[resolved];
  const definisiPotensi = useDefinisiPotensi();

  useEffect(() => {
    setData(null);
    setShowDesaList(false);
    setSelectedSubsektor(null);
    api.potensiSektorDetail(sektor, cleanParams(filter)).then(setData).catch((e) => setError(e.message));
  }, [sektor, filter]);

  useEffect(() => {
    if (!selectedSubsektor) return;
    setSubDesa(null);
    setSubError(null);
    api.potensiSektorDetail(sektor, cleanParams({ ...filter, subsektor: selectedSubsektor }))
      .then((d) => setSubDesa(d.desa))
      .catch((e) => setSubError(e.message));
  }, [selectedSubsektor, sektor, filter]);

  const subsektorSorted = useMemo(
    () => (data ? [...data.subsektor].sort((a, b) => b.jumlah_desa - a.jumlah_desa) : []),
    [data]
  );

  const subsektorByKelompok = useMemo(() => {
    const out = {};
    for (const s of subsektorSorted) (out[s.kelompok] ||= []).push(s);
    return out;
  }, [subsektorSorted]);

  const perKabupaten = useMemo(() => {
    if (!data) return [];
    const counts = {};
    for (const d of data.desa) counts[d.kabupaten] = (counts[d.kabupaten] || 0) + 1;
    return Object.entries(counts).map(([kabupaten, n]) => ({ kabupaten, n })).sort((a, b) => b.n - a.n);
  }, [data]);

  // Switches to the subsektor drill-down's desa list once one is selected,
  // so picking e.g. "Terdapat Peternakan Sapi" re-points the same map at
  // just those villages instead of the whole sektor.
  const mapSource = selectedSubsektor ? subDesa : data?.desa;
  const mapPoints = useMemo(() => (mapSource || []).filter((d) => d.lat !== null && d.lng !== null), [mapSource]);
  const mapTitle = selectedSubsektor
    ? `Peta · ${selectedSubsektor.replace(/^Terdapat /i, '')}`
    : `Peta Sebaran Potensi ${sektor}`;

  return (
    <div>
      <div className="page-header">
        <p style={{ marginBottom: 4 }}><Link to="/potensi-desa">&larr; Potensi Desa</Link></p>
        <h1 className="page-title">Potensi {sektor}</h1>
        <p className="page-desc">{data ? `${data.jumlahDesa.toLocaleString('id-ID')} desa memiliki potensi ini.` : ' '}</p>
      </div>
      <FilterBar value={filter} onChange={setFilter} />

      {error && <div className="state-msg state-error">{error}</div>}
      {!data && !error && <div className="state-msg">Memuat data...</div>}

      {data && (
        <>
          <div className="panel">
            <h2 className="panel-title">Sebaran per Kabupaten</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>
              Klik bar untuk mempersempit peta &amp; daftar desa di bawah ke kabupaten itu saja.
              {filter.kabupaten && (
                <button className="link-button" style={{ marginLeft: 8 }} onClick={() => setFilter((f) => ({ ...f, kabupaten: '', kecamatan: '' }))}>
                  Tampilkan semua kabupaten
                </button>
              )}
            </p>
            <ResponsiveContainer width="100%" height={Math.max(140, perKabupaten.length * 30)}>
              <BarChart data={perKabupaten} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="kabupaten" width={140} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar
                  dataKey="n"
                  fill={accent}
                  radius={[0, 4, 4, 0]}
                  barSize={16}
                  cursor="pointer"
                  onClick={(d) => setFilter((f) => ({ ...f, kabupaten: d.kabupaten, kecamatan: '' }))}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 16px 0' }}>
              <h2 className="panel-title" style={{ marginBottom: 2 }}>{mapTitle}</h2>
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0 }}>
                {selectedSubsektor
                  ? 'Klik "Tutup" di bawah untuk kembali ke peta sebaran seluruh sektor.'
                  : 'Klik salah satu baris subsektor di bawah untuk mempersempit peta ke subsektor itu saja.'}
              </p>
            </div>
            {subError && <div className="state-msg state-error" style={{ padding: '0 16px' }}>{subError}</div>}
            {selectedSubsektor && !subDesa && !subError && <p className="state-msg" style={{ padding: '0 16px' }}>Memuat...</p>}
            {(!selectedSubsektor || subDesa) && (
              <MapContainer center={KALSEL_CENTER} zoom={8} style={{ height: 420, width: '100%' }}>
                <TileLayer
                  attribution='&copy; OpenStreetMap contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {mapPoints.map((p) => (
                  <CircleMarker
                    key={p.kode_desa}
                    center={[p.lat, p.lng]}
                    radius={5}
                    pathOptions={{ color: statusColors[p.status_desa] || '#666', fillOpacity: 0.7 }}
                  >
                    <Popup>
                      <strong>{p.nama_desa}</strong><br />
                      {p.kecamatan}, {p.kabupaten}<br />
                      Status: {p.status_desa}<br />
                      <Link to={`/profil-desa?kode=${p.kode_desa}`}>Lihat profil desa</Link>
                    </Popup>
                  </CircleMarker>
                ))}
              </MapContainer>
            )}
            <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '10px 16px' }}>
              {mapPoints.length.toLocaleString('id-ID')} dari {(mapSource || []).length.toLocaleString('id-ID')} desa memiliki koordinat.
            </p>
          </div>

          {KELOMPOK_ORDER.map((kelompok) => {
            const items = subsektorByKelompok[kelompok];
            if (!items || items.length === 0) return null;
            const meta = KELOMPOK_META[kelompok];
            return (
              <div className="panel" key={kelompok}>
                <h2 className="panel-title" style={{ marginBottom: 2 }}>{meta.icon} {meta.label}</h2>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>
                  {meta.desc} Klik salah satu baris untuk melihat daftar desanya.
                </p>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead><tr><th>Subsektor / Indikator</th><th>Jumlah Desa</th></tr></thead>
                    <tbody>
                      {items.map((s) => {
                        const active = s.subsektor === selectedSubsektor;
                        const tooltip = formatTooltip(definisiPotensi[s.subsektor]);
                        return (
                          <tr
                            key={s.subsektor}
                            title={tooltip}
                            onClick={() => setSelectedSubsektor(active ? null : s.subsektor)}
                            style={{ cursor: tooltip ? 'help' : 'pointer', background: active ? 'var(--panel-2)' : undefined }}
                          >
                            <td>{s.subsektor}{tooltip ? ' ⓘ' : ''}</td>
                            <td>{s.jumlah_desa}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {kelompok === 'pemanfaatan' && (
                  <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 10, marginBottom: 0 }}>
                    Data kuantitatif detail (jumlah produksi, nilai, dst.) tidak selalu tercakup di sini karena tabel ini hanya menghitung jawaban "Ada".
                  </p>
                )}
              </div>
            );
          })}
        </>
      )}

      {selectedSubsektor && (
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 className="panel-title" style={{ marginBottom: 0 }}>
              Desa dengan "{selectedSubsektor.replace(/^Terdapat /i, '')}"
            </h2>
            <button className="btn btn-secondary" onClick={() => setSelectedSubsektor(null)}>Tutup</button>
          </div>
          {subError && <div className="state-msg state-error">{subError}</div>}
          {!subDesa && !subError && <p className="state-msg">Memuat...</p>}
          {subDesa && subDesa.length === 0 && <p className="state-msg">Tidak ada desa pada filter ini.</p>}
          {subDesa && subDesa.length > 0 && (
            <div className="table-scroll" style={{ marginTop: 12 }}>
              <table className="data-table">
                <thead><tr><th>No.</th><th>Desa</th><th>Kabupaten</th><th>Kecamatan</th><th>Status</th></tr></thead>
                <tbody>
                  {subDesa.slice(0, 200).map((d, i) => (
                    <tr key={d.kode_desa}>
                      <td>{i + 1}</td>
                      <td><Link to={`/profil-desa?kode=${d.kode_desa}`}>{d.nama_desa}</Link></td>
                      <td>{d.kabupaten}</td>
                      <td>{d.kecamatan}</td>
                      <td><StatusBadge status={d.status_desa} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {subDesa.length > 200 && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Menampilkan 200 dari {subDesa.length} desa.</p>
              )}
            </div>
          )}
        </div>
      )}

      {data && (
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 className="panel-title" style={{ marginBottom: 0 }}>Daftar Desa dengan Potensi {sektor}</h2>
            <button className="btn btn-secondary" onClick={() => setShowDesaList((v) => !v)}>
              {showDesaList ? 'Tutup' : 'Lihat Daftar Desa'}
            </button>
          </div>
          {showDesaList && (
            <div className="table-scroll" style={{ marginTop: 12 }}>
              <table className="data-table">
                <thead>
                  <tr><th>No.</th><th>Desa</th><th>Kabupaten</th><th>Kecamatan</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {data.desa.slice(0, 200).map((d, i) => (
                    <tr key={d.kode_desa}>
                      <td>{i + 1}</td>
                      <td><Link to={`/profil-desa?kode=${d.kode_desa}`}>{d.nama_desa}</Link></td>
                      <td>{d.kabupaten}</td>
                      <td>{d.kecamatan}</td>
                      <td><StatusBadge status={d.status_desa} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.desa.length > 200 && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Menampilkan 200 dari {data.desa.length} desa.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
