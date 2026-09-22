import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Link } from 'react-router-dom';
import { api } from '../api';
import RekomendasiKabupatenAI from '../components/RekomendasiKabupatenAI';
import { useTheme } from '../theme';
import { STATUS_COLORS, ACCENT_SECONDARY } from '../colors';

const BUM_TIER_ORDER = ['Perintis', 'Pemula', 'Berkembang', 'Maju', 'Tidak Ikut Pemeringkatan', 'Tidak Diketahui'];
const KDMP_ORDER = ['Tidak Ada', 'Ada, Belum Berbadan Hukum', 'Ada, Sudah Berbadan Hukum', 'Tidak Diketahui'];

function toChartData(countObj, order) {
  const known = order.filter((k) => countObj[k] != null).map((k) => ({ name: k, n: countObj[k] }));
  const extra = Object.entries(countObj)
    .filter(([k]) => !order.includes(k))
    .map(([k, n]) => ({ name: k, n }));
  return [...known, ...extra];
}

export default function AnalisisKabupaten() {
  const [kabupatenList, setKabupatenList] = useState([]);
  const [kabupaten, setKabupaten] = useState('');
  const [ringkasan, setRingkasan] = useState(null);
  const [error, setError] = useState(null);
  const { resolved } = useTheme();
  const statusColors = STATUS_COLORS[resolved];
  const accent = ACCENT_SECONDARY[resolved];

  useEffect(() => {
    api.kabupaten().then((list) => {
      setKabupatenList(list);
      if (list.length) setKabupaten(list[0]);
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!kabupaten) return;
    setRingkasan(null);
    setError(null);
    api.ringkasanKabupaten(kabupaten).then(setRingkasan).catch((e) => setError(e.message));
  }, [kabupaten]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Analisis Kabupaten</h1>
        <p className="page-desc">Kondisi BUM Desa dan rekomendasi kebijakan tingkat kabupaten.</p>
      </div>

      <div className="filter-bar">
        <select value={kabupaten} onChange={(e) => setKabupaten(e.target.value)} disabled={kabupatenList.length <= 1}>
          {kabupatenList.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </div>

      {error && <div className="state-msg state-error">{error}</div>}
      {!ringkasan && !error && <div className="state-msg">Memuat data...</div>}

      {ringkasan && (
        <>
          <div className="kpi-row">
            <div className="kpi-card">
              <div className="kpi-label">Jumlah Desa</div>
              <div className="kpi-value">{ringkasan.jumlahDesa.toLocaleString('id-ID')}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Rata-rata Skor Dimensi Ekonomi</div>
              <div className="kpi-value">{ringkasan.avgSkor !== null ? ringkasan.avgSkor.toFixed(1) : '-'}</div>
            </div>
            {Object.entries(ringkasan.statusCount).map(([status, n]) => (
              <div className="kpi-card" key={status}>
                <div className="kpi-label">Desa {status}</div>
                <div className="kpi-value" style={{ color: statusColors[status] || undefined }}>
                  {n.toLocaleString('id-ID')}
                </div>
              </div>
            ))}
          </div>

          <div className="grid-2">
            <div className="panel">
              <h2 className="panel-title">Kondisi BUM Desa (Pemeringkatan)</h2>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={toChartData(ringkasan.bumTier, BUM_TIER_ORDER)} layout="vertical" margin={{ left: 20 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="n" fill={accent} radius={[0, 4, 4, 0]} barSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="panel">
              <h2 className="panel-title">Kondisi Koperasi Desa Merah Putih (KDMP)</h2>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={toChartData(ringkasan.kdmpStatus, KDMP_ORDER)} layout="vertical" margin={{ left: 20 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="n" fill={accent} radius={[0, 4, 4, 0]} barSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel">
            <h2 className="panel-title">Sektor Potensi Ekonomi Terbanyak</h2>
            <ResponsiveContainer width="100%" height={Math.max(180, ringkasan.sektorRows.length * 32)}>
              <BarChart data={ringkasan.sektorRows} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="sektor" width={180} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="n" radius={[0, 4, 4, 0]} barSize={20}>
                  {ringkasan.sektorRows.map((_, i) => <Cell key={i} fill={accent} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <RekomendasiKabupatenAI kabupaten={kabupaten} />

          <div className="panel">
            <h2 className="panel-title">Desa Prioritas (Potensi Tinggi, Kinerja Rendah)</h2>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0 }}>
              Kandidat utama untuk intervensi/pendampingan - dihitung dari jumlah sektor potensi vs skor Dimensi Ekonomi.
            </p>
            {ringkasan.priorityDesa.length === 0 && <p className="state-msg">Tidak ada desa yang menonjol sebagai prioritas.</p>}
            {ringkasan.priorityDesa.length > 0 && (
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Desa</th><th>Kecamatan</th><th>Jumlah Sektor Potensi</th><th>Skor Ekonomi</th></tr></thead>
                  <tbody>
                    {ringkasan.priorityDesa.map((d) => (
                      <tr key={d.kode_desa}>
                        <td><Link to={`/profil-desa?kode=${d.kode_desa}`}>{d.nama_desa}</Link></td>
                        <td>{d.kecamatan}</td>
                        <td>{d.potensi}</td>
                        <td>{d.skor}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
