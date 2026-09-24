import { useEffect, useMemo, useState } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from 'recharts';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import FilterBar from '../components/FilterBar';
import StatusBadge from '../components/StatusBadge';
import { cleanParams } from '../utils';
import { useTheme } from '../theme';
import { QUADRAN_COLORS } from '../colors';

export default function Analisis() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState({});
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [activeKuadran, setActiveKuadran] = useState(null);
  const { resolved } = useTheme();
  const kuadranColors = QUADRAN_COLORS[resolved];

  useEffect(() => {
    setData(null);
    setActiveKuadran(null);
    api.analisisKuadran(cleanParams(filter)).then(setData).catch((e) => setError(e.message));
  }, [filter]);

  const byKuadran = useMemo(() => {
    if (!data) return {};
    const groups = {};
    for (const d of data.desa) (groups[d.kuadran] ||= []).push(d);
    return groups;
  }, [data]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Analisis Potensi x Kinerja</h1>
        <p className="page-desc">
          Setiap desa diplot berdasarkan jumlah sektor potensi ekonomi (sumbu X) dan skor Dimensi Ekonomi (sumbu Y).
          Kuadran II (potensi tinggi, kinerja rendah) adalah kandidat utama untuk intervensi. Klik satu titik untuk membuka profil desa itu.
        </p>
      </div>
      <FilterBar value={filter} onChange={setFilter} />

      {error && <div className="state-msg state-error">{error}</div>}
      {!data && !error && <div className="state-msg">Memuat data...</div>}

      {data && (
        <>
          <div className="panel">
            <ResponsiveContainer width="100%" height={420}>
              <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="potensi"
                  name="Jumlah Sektor Potensi"
                  label={{ value: 'Jumlah Sektor Potensi', position: 'insideBottom', offset: -10, fontSize: 12 }}
                />
                <YAxis
                  type="number"
                  dataKey="kinerja"
                  name="Skor Ekonomi"
                  label={{ value: 'Skor Dimensi Ekonomi', angle: -90, position: 'insideLeft', fontSize: 12 }}
                />
                <ReferenceLine x={data.potensiMedian} stroke="#9c9a92" strokeDasharray="4 4" />
                <ReferenceLine y={data.kinerjaMedian} stroke="#9c9a92" strokeDasharray="4 4" />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="panel" style={{ padding: 10, margin: 0 }}>
                        <strong>{d.nama_desa}</strong><br />
                        {d.kecamatan}, {d.kabupaten}<br />
                        Potensi: {d.potensi} sektor &middot; Skor Ekonomi: {d.kinerja}
                      </div>
                    );
                  }}
                />
                {Object.entries(byKuadran).map(([kuadran, items]) => (
                  <Scatter
                    key={kuadran}
                    name={kuadran}
                    data={items}
                    fill={kuadranColors[kuadran]}
                    cursor="pointer"
                    onClick={(d) => navigate(`/profil-desa?kode=${d.kode_desa}`)}
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
            <div className="quadrant-legend">
              {Object.entries(kuadranColors).map(([label, color]) => (
                <button
                  key={label}
                  className="link-button"
                  style={{ color: 'inherit', textDecoration: 'none' }}
                  onClick={() => setActiveKuadran(activeKuadran === label ? null : label)}
                >
                  <span className="quadrant-dot" style={{ background: color }} />
                  {label} ({(byKuadran[label] || []).length})
                </button>
              ))}
            </div>
          </div>

          {activeKuadran && (
            <div className="panel">
              <h2 className="panel-title">Daftar Desa - Kuadran {activeKuadran}</h2>
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Desa</th><th>Kabupaten</th><th>Kecamatan</th><th>Potensi</th><th>Skor Ekonomi</th><th>Status</th></tr></thead>
                  <tbody>
                    {(byKuadran[activeKuadran] || []).slice(0, 200).map((d) => (
                      <tr key={d.kode_desa}>
                        <td><Link to={`/profil-desa?kode=${d.kode_desa}`}>{d.nama_desa}</Link></td>
                        <td>{d.kabupaten}</td>
                        <td>{d.kecamatan}</td>
                        <td>{d.potensi}</td>
                        <td>{d.kinerja}</td>
                        <td><StatusBadge status={d.status_desa} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
