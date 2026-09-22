import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { api } from '../api';
import FilterBar from '../components/FilterBar';
import { cleanParams } from '../utils';
import { useTheme } from '../theme';
import { STATUS_COLORS, ACCENT_SECONDARY } from '../colors';

// Display order follows Permendesa 9/2024's own dimension sequence, not the
// alphabetical order SQL's GROUP BY happens to return.
const DIMENSI_ORDER = ['LAYANAN DASAR', 'SOSIAL', 'EKONOMI', 'LINGKUNGAN', 'AKSESIBILITAS', 'TATA KELOLA PEMERINTAHAN DESA'];

function toChartData(rows) {
  const byName = new Map(rows.map((r) => [r.dimensi, r.avgSkor]));
  return DIMENSI_ORDER.filter((d) => byName.has(d)).map((d) => ({ dimensi: d, avgSkor: byName.get(d) }));
}

export default function IndeksDesa() {
  const [filter, setFilter] = useState({});
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const { resolved } = useTheme();
  const statusColors = STATUS_COLORS[resolved];
  const accent = ACCENT_SECONDARY[resolved];

  useEffect(() => {
    setData(null);
    api.indeksRingkasan(cleanParams(filter)).then(setData).catch((e) => setError(e.message));
  }, [filter]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">BANUA INDEX</h1>
        <p className="page-desc">
          Ringkasan 6 dimensi Indeks Desa (Permendesa 9/2024) se-Kalimantan Selatan, tahun 2026.
        </p>
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
              <div className="kpi-label">Rata-rata Nilai Indeks Desa</div>
              <div className="kpi-value">{data.avgNilaiIndeks ?? '-'}</div>
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

          <div className="panel">
            <h2 className="panel-title">Rata-rata Skor per Dimensi</h2>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0 }}>
              Skor komposit tiap dimensi (bukan skor per indikator individual) - klik "Dimensi Ekonomi" di menu untuk rincian indikator Ekonomi.
            </p>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={toChartData(data.dimensi)} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="dimensi" width={190} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => v.toFixed(2)} />
                <Bar dataKey="avgSkor" radius={[0, 4, 4, 0]} barSize={26}>
                  {toChartData(data.dimensi).map((d) => <Cell key={d.dimensi} fill={accent} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
