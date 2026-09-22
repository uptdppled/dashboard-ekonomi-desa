import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { api } from '../api';
import FilterBar from '../components/FilterBar';
import { cleanParams } from '../utils';
import { useTheme } from '../theme';
import { STATUS_COLORS, ACCENT } from '../colors';

export default function Dashboard() {
  const [filter, setFilter] = useState({});
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const { resolved } = useTheme();
  const statusColors = STATUS_COLORS[resolved];
  const accent = ACCENT[resolved];

  useEffect(() => {
    setData(null);
    api.dashboardSummary(cleanParams(filter)).then(setData).catch((e) => setError(e.message));
  }, [filter]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard Dimensi Ekonomi Desa</h1>
        <p className="page-desc">Ringkasan kinerja ekonomi desa se-Kalimantan Selatan, tahun 2026.</p>
      </div>
      <FilterBar value={filter} onChange={setFilter} />

      {error && <div className="state-msg state-error">{error}</div>}
      {!data && !error && <div className="state-msg">Memuat data...</div>}

      {data && (
        <>
          <div className="kpi-row">
            <div className="kpi-card">
              <div className="kpi-label">Jumlah Desa</div>
              <div className="kpi-value">{data.totalDesa.toLocaleString('id-ID')}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Rata-rata Skor Dimensi Ekonomi</div>
              <div className="kpi-value">{data.avgEkonomi ?? '-'}</div>
            </div>
            {data.statusDesa.map((s) => (
              <div className="kpi-card" key={s.status_desa}>
                <div className="kpi-label">Desa {s.status_desa}</div>
                <div className="kpi-value" style={{ color: statusColors[s.status_desa] || undefined }}>
                  {s.n.toLocaleString('id-ID')}
                </div>
              </div>
            ))}
          </div>

          <div className="grid-2">
            <div className="panel">
              <h2 className="panel-title">Komposisi Dimensi Ekonomi (rata-rata skor)</h2>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.subDimensi} layout="vertical" margin={{ left: 20 }}>
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="sub_dimensi"
                    width={220}
                    tickFormatter={(v) => v.replace('SUB-DIMENSI ', '')}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip formatter={(v) => v.toFixed(2)} />
                  <Bar dataKey="avg_skor" fill={accent} radius={[0, 4, 4, 0]} barSize={32} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="panel">
              <h2 className="panel-title">Distribusi Status Desa</h2>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                  <Pie data={data.statusDesa} dataKey="n" nameKey="status_desa" outerRadius={80} cx="50%" cy="42%">
                    {data.statusDesa.map((s) => (
                      <Cell key={s.status_desa} fill={statusColors[s.status_desa] || '#8884d8'} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value, name) => [value.toLocaleString('id-ID'), name]} />
                  <Legend
                    layout="horizontal"
                    verticalAlign="bottom"
                    align="center"
                    formatter={(value) => {
                      const item = data.statusDesa.find((s) => s.status_desa === value);
                      return `${value} (${item ? item.n.toLocaleString('id-ID') : 0})`;
                    }}
                    wrapperStyle={{ fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
