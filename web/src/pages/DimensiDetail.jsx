import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../api';
import FilterBar from '../components/FilterBar';
import StatusBadge from '../components/StatusBadge';
import { cleanParams } from '../utils';
import { useTheme } from '../theme';
import { ACCENT_SECONDARY } from '../colors';

const DIMENSI_LABEL = {
  'LAYANAN DASAR': 'Layanan Dasar',
  SOSIAL: 'Sosial',
  EKONOMI: 'Ekonomi',
  LINGKUNGAN: 'Lingkungan',
  AKSESIBILITAS: 'Aksesibilitas',
  'TATA KELOLA PEMERINTAHAN DESA': 'Tata Kelola',
};

export default function DimensiDetail() {
  const { dimensi } = useParams();
  const label = DIMENSI_LABEL[dimensi] || dimensi;
  const [filter, setFilter] = useState({});
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState({ field: 'skor_dimensi', dir: 'desc' });
  const { resolved } = useTheme();
  const accent = ACCENT_SECONDARY[resolved];

  useEffect(() => {
    setData(null);
    setError(null);
    api.indeksDimensi(dimensi, cleanParams(filter)).then(setData).catch((e) => setError(e.message));
  }, [dimensi, filter]);

  const bySubDimensi = useMemo(() => {
    if (!data) return {};
    const out = {};
    for (const r of data.indikatorRows) (out[r.subDimensi] ||= []).push(r);
    return out;
  }, [data]);

  const sortedDesa = useMemo(() => {
    if (!data) return [];
    const copy = [...data.desaRows];
    copy.sort((a, b) => {
      const av = a[sort.field] ?? -Infinity;
      const bv = b[sort.field] ?? -Infinity;
      if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sort.dir === 'asc' ? av - bv : bv - av;
    });
    return copy;
  }, [data, sort]);

  function toggleSort(field) {
    setSort((s) => (s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'desc' }));
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">BANUA INDEX &middot; {label}</h1>
        <p className="page-desc">Skor dimensi {label} sampai ke tingkat indikator, per desa se-Kalimantan Selatan.</p>
      </div>
      <FilterBar value={filter} onChange={setFilter} showSearch />

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
              <div className="kpi-label">Rata-rata Skor {label}</div>
              <div className="kpi-value">{data.avgSkor ?? '-'}</div>
            </div>
          </div>

          <div className="panel">
            <h2 className="panel-title">Komposisi Sub-Dimensi (rata-rata skor)</h2>
            <ResponsiveContainer width="100%" height={Math.max(140, data.subDimensiRows.length * 50)}>
              <BarChart data={data.subDimensiRows} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="subDimensi"
                  width={220}
                  tickFormatter={(v) => v.replace(/^SUB-DIMENSI /i, '')}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip formatter={(v) => v.toFixed(2)} />
                <Bar dataKey="avgSkor" fill={accent} radius={[0, 4, 4, 0]} barSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="panel">
            <h2 className="panel-title">Rincian per Indikator</h2>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0 }}>
              Rata-rata skor tiap indikator individual, dikelompokkan per sub-dimensi.
            </p>
            {Object.entries(bySubDimensi).map(([sub, items]) => (
              <div key={sub} style={{ marginBottom: 16 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                  {sub.replace(/^SUB-DIMENSI /i, '')}
                </p>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead><tr><th>Indikator</th><th>Rata-rata Skor</th><th>Bobot Maks</th></tr></thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.indikator}>
                          <td>{it.indikator.replace(/^SKOR /i, '')}</td>
                          <td>{it.avgSkor}</td>
                          <td>{it.avgBobot}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>

          <div className="panel">
            <h2 className="panel-title">Daftar Desa</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>{sortedDesa.length} desa</p>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Desa</th>
                    <th>Kabupaten</th>
                    <th>Kecamatan</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('skor_dimensi')}>
                      Skor {label} {sort.field === 'skor_dimensi' ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
                    </th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedDesa.slice(0, 300).map((d) => (
                    <tr key={d.kode_desa}>
                      <td><Link to={`/profil-desa?kode=${d.kode_desa}`}>{d.nama_desa}</Link></td>
                      <td>{d.kabupaten}</td>
                      <td>{d.kecamatan}</td>
                      <td>{d.skor_dimensi ?? '-'}</td>
                      <td><StatusBadge status={d.status_desa} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sortedDesa.length > 300 && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Menampilkan 300 dari {sortedDesa.length} desa. Persempit dengan filter untuk melihat lebih spesifik.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
