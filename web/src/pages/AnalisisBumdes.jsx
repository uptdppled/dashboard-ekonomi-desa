import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import RekomendasiKabupatenAI from '../components/RekomendasiKabupatenAI';
import StatusBadge from '../components/StatusBadge';
import { useTheme } from '../theme';
import { STATUS_COLORS, ACCENT_SECONDARY } from '../colors';

const BUM_TIER_ORDER = ['Perintis', 'Pemula', 'Berkembang', 'Maju', 'Tidak Ikut Pemeringkatan', 'Tidak Diketahui'];
const KDMP_ORDER = ['Tidak Ada', 'Ada, Belum Berbadan Hukum', 'Ada, Sudah Berbadan Hukum', 'Tidak Diketahui'];

// Sentinel select value representing "all kabupaten at once" - only ever
// offered when the wilayah list has more than one entry, which server-side
// scoping already guarantees is true only for admin/provinsi accounts.
const PROVINSI_VALUE = '__PROVINSI__';

function toChartData(countObj, order) {
  const known = order.filter((k) => countObj[k] != null).map((k) => ({ name: k, n: countObj[k] }));
  const extra = Object.entries(countObj)
    .filter(([k]) => !order.includes(k))
    .map(([k, n]) => ({ name: k, n }));
  return [...known, ...extra];
}

const DRILLDOWN = {
  aktif: { title: 'Desa dengan BUM Desa Belum Aktif (Tidak Ikut Pemeringkatan)', field: 'daftarTidakAktifBumdes' },
  hukum: { title: 'Desa dengan BUM Desa Belum Berbadan Hukum', field: 'daftarBelumBerbadanHukum' },
};

export default function AnalisisBumdes() {
  const navigate = useNavigate();
  const [kabupatenList, setKabupatenList] = useState([]);
  const [selected, setSelected] = useState('');
  const [ringkasan, setRingkasan] = useState(null);
  const [error, setError] = useState(null);
  const [drilldown, setDrilldown] = useState(null);
  const [komponenDrill, setKomponenDrill] = useState(null);
  const [komponenDesa, setKomponenDesa] = useState(null);
  const [komponenError, setKomponenError] = useState(null);
  const { resolved } = useTheme();
  const statusColors = STATUS_COLORS[resolved];
  const accent = ACCENT_SECONDARY[resolved];

  const isProvinsi = selected === PROVINSI_VALUE;
  const canSeeProvinsi = kabupatenList.length > 1;

  useEffect(() => {
    api.kabupaten().then((list) => {
      setKabupatenList(list);
      if (list.length) setSelected(list[0]);
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setRingkasan(null);
    setError(null);
    setDrilldown(null);
    setKomponenDrill(null);
    const req = selected === PROVINSI_VALUE ? api.ringkasanProvinsi() : api.ringkasanKabupaten(selected);
    req.then(setRingkasan).catch((e) => setError(e.message));
  }, [selected]);

  useEffect(() => {
    if (!komponenDrill) return;
    setKomponenDesa(null);
    setKomponenError(null);
    const req = isProvinsi
      ? api.desaKomponenProvinsi(komponenDrill.komponen, komponenDrill.value)
      : api.desaKomponenKabupaten(selected, komponenDrill.komponen, komponenDrill.value);
    req.then(setKomponenDesa).catch((e) => setKomponenError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [komponenDrill]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Analisis BUMDes</h1>
        <p className="page-desc">Kondisi BUM Desa dan rekomendasi kebijakan tingkat kabupaten atau provinsi.</p>
      </div>

      <div className="filter-bar">
        <select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={kabupatenList.length <= 1}>
          {canSeeProvinsi && <option value={PROVINSI_VALUE}>Provinsi (Semua Kabupaten)</option>}
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
            <div
              className="kpi-card"
              onClick={() => setDrilldown(drilldown === 'aktif' ? null : 'aktif')}
              style={{ cursor: 'pointer', outline: drilldown === 'aktif' ? `2px solid ${accent}` : undefined }}
              title="Klik untuk lihat daftar desa yang belum aktif"
            >
              <div className="kpi-label">BUM Desa Aktif (Ikut Pemeringkatan)</div>
              <div className="kpi-value">
                {ringkasan.desaBumDesaAktif.toLocaleString('id-ID')}
                <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400 }}> / {ringkasan.jumlahDesa.toLocaleString('id-ID')} desa</span>
              </div>
            </div>
            <div
              className="kpi-card"
              onClick={() => setDrilldown(drilldown === 'hukum' ? null : 'hukum')}
              style={{ cursor: 'pointer', outline: drilldown === 'hukum' ? `2px solid ${accent}` : undefined }}
              title="Klik untuk lihat daftar desa yang belum berbadan hukum"
            >
              <div className="kpi-label">BUM Desa Berbadan Hukum</div>
              <div className="kpi-value">
                {ringkasan.desaBerbadanHukum.toLocaleString('id-ID')}
                <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400 }}> / {ringkasan.jumlahDesa.toLocaleString('id-ID')} desa</span>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Rata-rata Hari Operasional BUM Desa</div>
              <div className="kpi-value">
                {ringkasan.hariOperasionalAvg !== null ? ringkasan.hariOperasionalAvg.toFixed(1) : '-'}
                <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400 }}> hari/minggu</span>
              </div>
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

          {drilldown && (
            <div className="panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <h2 className="panel-title">{DRILLDOWN[drilldown].title}</h2>
                <button className="btn" onClick={() => setDrilldown(null)}>Tutup</button>
              </div>
              {(() => {
                const rows = ringkasan[DRILLDOWN[drilldown].field] || [];
                if (rows.length === 0) return <p className="state-msg">Tidak ada desa - semua sudah memenuhi kriteria ini.</p>;
                return (
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Desa</th>
                          <th>Kecamatan</th>
                          {isProvinsi && <th>Kabupaten</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((d) => (
                          <tr key={d.kode_desa}>
                            <td><Link to={`/profil-desa?kode=${d.kode_desa}`}>{d.nama_desa}</Link></td>
                            <td>{d.kecamatan}</td>
                            {isProvinsi && <td>{d.kabupaten}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          )}

          <div className="grid-2">
            <div className="panel">
              <h2 className="panel-title">Kondisi BUM Desa (Pemeringkatan)</h2>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>Klik bar untuk melihat daftar desanya.</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={toChartData(ringkasan.bumTier, BUM_TIER_ORDER)} layout="vertical" margin={{ left: 20 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar
                    dataKey="n"
                    fill={accent}
                    radius={[0, 4, 4, 0]}
                    barSize={22}
                    cursor="pointer"
                    onClick={(d) => setKomponenDrill({ komponen: 'bum', value: d.name, title: `Desa dengan BUM Desa "${d.name}"` })}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="panel">
              <h2 className="panel-title">Kondisi Koperasi Desa Merah Putih (KDMP)</h2>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>Klik bar untuk melihat daftar desanya.</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={toChartData(ringkasan.kdmpStatus, KDMP_ORDER)} layout="vertical" margin={{ left: 20 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar
                    dataKey="n"
                    fill={accent}
                    radius={[0, 4, 4, 0]}
                    barSize={22}
                    cursor="pointer"
                    onClick={(d) => setKomponenDrill({ komponen: 'kdmp', value: d.name, title: `Desa dengan KDMP "${d.name}"` })}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {komponenDrill && (
            <div className="panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <h2 className="panel-title">{komponenDrill.title}</h2>
                <button className="btn" onClick={() => setKomponenDrill(null)}>Tutup</button>
              </div>
              {komponenError && <div className="state-msg state-error">{komponenError}</div>}
              {!komponenDesa && !komponenError && <p className="state-msg">Memuat...</p>}
              {komponenDesa && komponenDesa.length === 0 && <p className="state-msg">Tidak ada desa pada filter ini.</p>}
              {komponenDesa && komponenDesa.length > 0 && (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>No.</th>
                        <th>Desa</th>
                        <th>Kecamatan</th>
                        {isProvinsi && <th>Kabupaten</th>}
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {komponenDesa.slice(0, 200).map((d, i) => (
                        <tr key={d.kode_desa}>
                          <td>{i + 1}</td>
                          <td><Link to={`/profil-desa?kode=${d.kode_desa}`}>{d.nama_desa}</Link></td>
                          <td>{d.kecamatan}</td>
                          {isProvinsi && <td>{d.kabupaten}</td>}
                          <td><StatusBadge status={d.status_desa} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {komponenDesa.length > 200 && (
                    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Menampilkan 200 dari {komponenDesa.length} desa.</p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="panel">
            <h2 className="panel-title">Sektor Potensi Ekonomi Terbanyak</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>Klik bar untuk membuka detail sektor itu di Potensi Desa.</p>
            <ResponsiveContainer width="100%" height={Math.max(180, ringkasan.sektorRows.length * 32)}>
              <BarChart data={ringkasan.sektorRows} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="sektor" width={180} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar
                  dataKey="n"
                  radius={[0, 4, 4, 0]}
                  barSize={20}
                  cursor="pointer"
                  onClick={(d) => navigate(`/potensi-desa/${encodeURIComponent(d.sektor)}`)}
                >
                  {ringkasan.sektorRows.map((_, i) => <Cell key={i} fill={accent} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <RekomendasiKabupatenAI kabupaten={isProvinsi ? null : selected} isProvinsi={isProvinsi} />

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
