import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { api } from '../api';
import { useAuth } from '../auth';
import FilterBar from '../components/FilterBar';
import { cleanParams } from '../utils';
import { useTheme } from '../theme';
import { STATUS_COLORS, QUADRAN_COLORS, ACCENT } from '../colors';

// Display order follows Permendesa 9/2024's own dimension sequence, not the
// alphabetical order SQL's GROUP BY happens to return.
const DIMENSI_ORDER = ['LAYANAN DASAR', 'SOSIAL', 'EKONOMI', 'LINGKUNGAN', 'AKSESIBILITAS', 'TATA KELOLA PEMERINTAHAN DESA'];
const BUM_TIER_ORDER = ['Maju', 'Berkembang', 'Pemula', 'Perintis', 'Tidak Ikut Pemeringkatan'];
const KUADRAN_II = 'II - Potensi Tinggi, Kinerja Rendah';

function toChartData(rows) {
  const byName = new Map(rows.map((r) => [r.dimensi, r.avgSkor]));
  return DIMENSI_ORDER.filter((d) => byName.has(d)).map((d) => ({ dimensi: d, avgSkor: byName.get(d) }));
}

// Each card loads on its own, so one slow endpoint never holds up the rest.
function useRingkasan(load, deps) {
  const [state, setState] = useState({ data: null, error: null });
  useEffect(() => {
    let aktif = true;
    setState({ data: null, error: null });
    load()
      .then((data) => aktif && setState({ data, error: null }))
      .catch((e) => aktif && setState({ data: null, error: e.message }));
    return () => {
      aktif = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function Kartu({ judul, keterangan, ke, label, state, children }) {
  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <h2 className="panel-title">{judul}</h2>
      {keterangan && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>{keterangan}</p>}
      {state.error && <div className="state-msg state-error">{state.error}</div>}
      {!state.data && !state.error && <div className="state-msg">Memuat data...</div>}
      {state.data && <div style={{ flex: 1 }}>{children(state.data)}</div>}
      <Link to={ke} style={{ marginTop: 14, fontSize: 13, fontWeight: 600 }}>{label} &rarr;</Link>
    </div>
  );
}

function DaftarBatang({ baris, total, warna }) {
  const maks = Math.max(1, ...baris.map((b) => b.n));
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {baris.map((b) => (
        <div key={b.nama}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
            <span>{b.nama}</span>
            <span style={{ fontWeight: 600 }}>
              {b.n.toLocaleString('id-ID')} desa
              {total ? <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> ({Math.round((b.n / total) * 100)}%)</span> : null}
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', marginTop: 4 }}>
            <div style={{ width: `${(b.n / maks) * 100}%`, height: '100%', borderRadius: 3, background: b.warna || warna }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function AngkaBesar({ nilai, warna, keterangan }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.1, color: warna }}>{nilai.toLocaleString('id-ID')}</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{keterangan}</div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [filter, setFilter] = useState({});
  const { resolved } = useTheme();
  const statusColors = STATUS_COLORS[resolved];
  const kuadranColors = QUADRAN_COLORS[resolved];
  const accent = ACCENT[resolved];

  const params = cleanParams(filter);
  const kunci = JSON.stringify(params);

  // BUM Desa data comes from the kabupaten/provinsi context builder, which
  // has no kecamatan/status filter - so it follows the kabupaten only.
  const lihatProvinsi = user?.role === 'admin' || user?.role === 'provinsi';
  const kabupatenBum = filter.kabupaten || (lihatProvinsi ? null : user?.kabupaten);

  const indeks = useRingkasan(() => api.indeksRingkasan(params), [kunci]);
  const potensi = useRingkasan(() => api.potensiSektor(params), [kunci]);
  const kuadran = useRingkasan(() => api.analisisKuadran(params), [kunci]);
  const insight = useRingkasan(() => api.insightRingkasan(params), [kunci]);
  const naik = useRingkasan(() => api.insightNaikStatus(params), [kunci]);
  const bum = useRingkasan(
    () => (kabupatenBum ? api.ringkasanKabupaten(kabupatenBum) : api.ringkasanProvinsi()),
    [kabupatenBum]
  );
  const perhatian = {
    data: insight.data && naik.data ? { gap: insight.data.gapAnalysis, naik: naik.data } : null,
    error: insight.error || naik.error,
  };

  const data = indeks.data;
  const dimensi = data ? toChartData(data.dimensi) : [];

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard Banua360</h1>
        <p className="page-desc">
          Gambaran singkat pembangunan desa se-Kalimantan Selatan, tahun 2026: Indeks Desa, potensi, BUM Desa, dan desa yang perlu perhatian. Klik tautan di tiap kartu untuk rinciannya.
        </p>
      </div>
      <FilterBar value={filter} onChange={setFilter} />

      {indeks.error && <div className="state-msg state-error">{indeks.error}</div>}
      {!data && !indeks.error && <div className="state-msg">Memuat data...</div>}

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

          <div className="grid-2">
            <div className="panel">
              <h2 className="panel-title">Rata-rata Skor per Dimensi</h2>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>Klik bar untuk rincian indikator dimensi itu.</p>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={dimensi} layout="vertical" margin={{ left: 20 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="dimensi" width={190} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => v.toFixed(2)} />
                  <Bar
                    dataKey="avgSkor"
                    fill={accent}
                    radius={[0, 4, 4, 0]}
                    barSize={24}
                    cursor="pointer"
                    onClick={(d) => navigate(`/banua-index/${encodeURIComponent(d.dimensi)}`)}
                  />
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

          <div className="grid-2">
            <Kartu
              judul="Sektor Potensi Terbanyak"
              keterangan="Lima sektor potensi ekonomi yang paling banyak dimiliki desa."
              ke="/potensi-desa"
              label="Lihat Banua Potensi"
              state={potensi}
            >
              {(rows) => (
                <DaftarBatang
                  baris={rows.slice(0, 5).map((r) => ({ nama: r.sektor, n: r.jumlah_desa }))}
                  total={data.totalDesa}
                  warna={accent}
                />
              )}
            </Kartu>

            <Kartu
              judul="Kandidat Intervensi"
              keterangan="Desa dengan potensi tinggi tetapi skor Dimensi Ekonomi rendah (Kuadran II)."
              ke="/analisis"
              label="Lihat Analisis Kuadran"
              state={kuadran}
            >
              {(k) => {
                const hitung = {};
                for (const d of k.desa) hitung[d.kuadran] = (hitung[d.kuadran] || 0) + 1;
                return (
                  <>
                    <AngkaBesar nilai={hitung[KUADRAN_II] || 0} warna={kuadranColors[KUADRAN_II]} keterangan="desa di Kuadran II" />
                    <DaftarBatang
                      baris={Object.keys(kuadranColors).map((nama) => ({ nama, n: hitung[nama] || 0, warna: kuadranColors[nama] }))}
                      total={k.desa.length}
                    />
                  </>
                );
              }}
            </Kartu>
          </div>

          <div className="grid-2">
            <Kartu
              judul={`Kondisi BUM Desa${bum.data ? ` · ${bum.data.label}` : ''}`}
              keterangan={
                filter.kecamatan || filter.status
                  ? 'Hasil Pemeringkatan BUM Desa. Kartu ini mengikuti kabupaten saja, tidak difilter per kecamatan atau status desa.'
                  : 'Hasil Pemeringkatan BUM Desa.'
              }
              ke="/analisis-bumdes"
              label="Lihat Analisis BUMDes"
              state={bum}
            >
              {(b) => (
                <>
                  <DaftarBatang
                    baris={BUM_TIER_ORDER.filter((t) => b.bumTier[t] != null).map((t) => ({ nama: t, n: b.bumTier[t] }))}
                    total={b.jumlahDesa}
                    warna={accent}
                  />
                  <p style={{ fontSize: 13, marginBottom: 0 }}>
                    Koperasi Desa Merah Putih sudah berbadan hukum:{' '}
                    <strong>{(b.kdmpStatus['Ada, Sudah Berbadan Hukum'] || 0).toLocaleString('id-ID')} desa</strong>
                  </p>
                </>
              )}
            </Kartu>

            <Kartu
              judul="Perlu Perhatian"
              keterangan="Indikator dengan desa terdampak terbanyak (skor di bawah 60% dari bobot maksimal)."
              ke="/banua-insight"
              label="Lihat Banua Insight"
              state={perhatian}
            >
              {({ gap, naik: naikStatus }) => (
                <>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {gap.length === 0 && <p className="state-msg">Tidak ada gap yang menonjol pada filter ini.</p>}
                    {gap.slice(0, 3).map((g) => (
                      <div key={g.indikator} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                        <span>
                          {g.indikator.replace(/^SKOR /i, '')}
                          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)' }}>{g.dimensi}</span>
                        </span>
                        <span className="badge" style={{ background: 'var(--critical-soft)', color: 'var(--critical)', alignSelf: 'flex-start', whiteSpace: 'nowrap' }}>
                          {g.jumlahGap.toLocaleString('id-ID')} desa
                        </span>
                      </div>
                    ))}
                  </div>
                  <h3 style={{ fontSize: 13.5, fontWeight: 700, margin: '18px 0 6px' }}>Kandidat naik status</h3>
                  {naikStatus.map((t) => (
                    <p key={t.dari} style={{ fontSize: 13, margin: '0 0 4px' }}>
                      {t.dari} &rarr; {t.ke}: <strong>{t.totalDiTier.toLocaleString('id-ID')} desa</strong>
                      {t.kandidat[0] && <span style={{ color: 'var(--text-muted)' }}> · teratas {t.kandidat[0].nama_desa}</span>}
                    </p>
                  ))}
                </>
              )}
            </Kartu>
          </div>
        </>
      )}
    </div>
  );
}
