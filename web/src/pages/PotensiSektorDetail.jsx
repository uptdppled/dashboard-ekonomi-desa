import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../api';
import FilterBar from '../components/FilterBar';
import StatusBadge from '../components/StatusBadge';
import { cleanParams } from '../utils';
import { useTheme } from '../theme';
import { ACCENT_SECONDARY } from '../colors';

export default function PotensiSektorDetail() {
  const { sektor } = useParams();
  const [filter, setFilter] = useState({});
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showDesaList, setShowDesaList] = useState(false);
  const { resolved } = useTheme();
  const accent = ACCENT_SECONDARY[resolved];

  useEffect(() => {
    setData(null);
    setShowDesaList(false);
    api.potensiSektorDetail(sektor, cleanParams(filter)).then(setData).catch((e) => setError(e.message));
  }, [sektor, filter]);

  const subsektorSorted = useMemo(
    () => (data ? [...data.subsektor].sort((a, b) => b.jumlah_desa - a.jumlah_desa) : []),
    [data]
  );

  const perKabupaten = useMemo(() => {
    if (!data) return [];
    const counts = {};
    for (const d of data.desa) counts[d.kabupaten] = (counts[d.kabupaten] || 0) + 1;
    return Object.entries(counts).map(([kabupaten, n]) => ({ kabupaten, n })).sort((a, b) => b.n - a.n);
  }, [data]);

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
        <div className="grid-2">
          <div className="panel">
            <h2 className="panel-title">Sebaran per Kabupaten</h2>
            <ResponsiveContainer width="100%" height={Math.max(140, perKabupaten.length * 30)}>
              <BarChart data={perKabupaten} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="kabupaten" width={140} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="n" fill={accent} radius={[0, 4, 4, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="panel">
            <h2 className="panel-title">Rincian Subsektor</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>Diurutkan dari yang paling banyak desa.</p>
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Subsektor / Indikator</th><th>Jumlah Desa</th></tr></thead>
                <tbody>
                  {subsektorSorted.map((s) => (
                    <tr key={s.subsektor}>
                      <td>{s.subsektor}</td>
                      <td>{s.jumlah_desa}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
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
                  <tr><th>Desa</th><th>Kabupaten</th><th>Kecamatan</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {data.desa.slice(0, 200).map((d) => (
                    <tr key={d.kode_desa}>
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
