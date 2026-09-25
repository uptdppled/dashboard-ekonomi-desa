import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../api';
import FilterBar from '../components/FilterBar';
import StatusBadge from '../components/StatusBadge';
import AnalisisIndeksAI from '../components/AnalisisIndeksAI';
import { cleanParams } from '../utils';
import { useTheme } from '../theme';
import { ACCENT_SECONDARY } from '../colors';
import { useDefinisiSkor, formatTooltip } from '../definisi';

const DIMENSI_LABEL = {
  'LAYANAN DASAR': 'Layanan Dasar',
  SOSIAL: 'Sosial',
  EKONOMI: 'Ekonomi',
  LINGKUNGAN: 'Lingkungan',
  AKSESIBILITAS: 'Aksesibilitas',
  'TATA KELOLA PEMERINTAHAN DESA': 'Tata Kelola',
};

// ratio = avgSkor / avgBobot. Same threshold as insight.js's Gap Analysis,
// so "gap" here means the same thing it means everywhere else in the app.
function severity(ratio) {
  if (ratio === null) return { color: 'var(--text-faint)', bg: 'var(--panel-2)', label: '-' };
  if (ratio < 0.6) return { color: 'var(--critical)', bg: 'var(--critical-soft)', label: 'Gap' };
  if (ratio < 0.8) return { color: 'var(--warning)', bg: 'var(--warning-soft)', label: 'Sedang' };
  return { color: 'var(--good)', bg: 'var(--good-soft)', label: 'Baik' };
}

export default function DimensiDetail() {
  const { dimensi } = useParams();
  const label = DIMENSI_LABEL[dimensi] || dimensi;
  const [filter, setFilter] = useState({});
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selectedSubDimensi, setSelectedSubDimensi] = useState(null);
  const [selectedIndikator, setSelectedIndikator] = useState(null);
  const [gapDesaList, setGapDesaList] = useState(null);
  const [gapError, setGapError] = useState(null);
  const { resolved } = useTheme();
  const accent = ACCENT_SECONDARY[resolved];
  const definisiSkor = useDefinisiSkor();

  useEffect(() => {
    setData(null);
    setError(null);
    setSelectedSubDimensi(null);
    setSelectedIndikator(null);
    api.indeksDimensi(dimensi, cleanParams(filter)).then(setData).catch((e) => setError(e.message));
  }, [dimensi, filter]);

  useEffect(() => {
    setGapDesaList(null);
    setGapError(null);
    if (!selectedIndikator) return;
    api
      .insightGapDesa(cleanParams({ ...filter, indikator: selectedIndikator }))
      .then(setGapDesaList)
      .catch((e) => setGapError(e.message));
  }, [selectedIndikator, filter]);

  const indikatorRows = data
    ? selectedSubDimensi
      ? data.indikatorRows.filter((it) => it.subDimensi === selectedSubDimensi)
      : data.indikatorRows
    : [];

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">BANUA INDEX &middot; {label}</h1>
        <p className="page-desc">Indikator diurutkan dari yang paling butuh perhatian, untuk mendukung pengambilan kebijakan.</p>
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
              <div className="kpi-label">Rata-rata Skor {label}</div>
              <div className="kpi-value">{data.avgSkor ?? '-'}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Indikator dengan Gap (&lt;60%)</div>
              <div className="kpi-value" style={{ color: data.jumlahIndikatorGap > 0 ? 'var(--critical)' : undefined }}>
                {data.jumlahIndikatorGap} <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400 }}>/ {data.indikatorRows.length} indikator</span>
              </div>
            </div>
          </div>

          <div className="panel">
            <h2 className="panel-title">Komposisi Sub-Dimensi</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>
              Klik bar untuk mempersempit daftar indikator di bawah ke sub-dimensi itu saja.
              {selectedSubDimensi && (
                <button
                  className="link-button"
                  style={{ marginLeft: 8 }}
                  onClick={() => setSelectedSubDimensi(null)}
                >
                  Tampilkan semua sub-dimensi
                </button>
              )}
            </p>
            <ResponsiveContainer width="100%" height={Math.max(120, data.subDimensiRows.length * 44)}>
              <BarChart data={data.subDimensiRows} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="subDimensi"
                  width={200}
                  tickFormatter={(v) => v.replace(/^SUB-DIMENSI /i, '')}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip formatter={(v) => v.toFixed(2)} />
                <Bar
                  dataKey="avgSkor"
                  fill={accent}
                  radius={[0, 4, 4, 0]}
                  barSize={22}
                  cursor="pointer"
                  onClick={(d) => setSelectedSubDimensi((prev) => (prev === d.subDimensi ? null : d.subDimensi))}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <AnalisisIndeksAI
            scope={{ ...cleanParams(filter), dimensi }}
            desc={`Analisis kondisi dimensi ${label} di atas dan rekomendasi kegiatan untuk meningkatkan indikator yang masih lemah.`}
          />

          <div className="panel">
            <h2 className="panel-title">
              Indikator - Paling Butuh Perhatian Dulu
              {selectedSubDimensi && ` · ${selectedSubDimensi.replace(/^SUB-DIMENSI /i, '')}`}
            </h2>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0 }}>
              Diurutkan dari skor terendah (relatif terhadap bobot maksimalnya). Merah = di bawah 60% bobot maks. Klik satu indikator untuk melihat desa mana saja yang rendah.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
              {indikatorRows.map((it) => {
                const sev = severity(it.ratio);
                const tooltip = formatTooltip(definisiSkor[it.indikator]);
                const active = selectedIndikator === it.indikator;
                return (
                  <div
                    key={it.indikator}
                    title={tooltip}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedIndikator((prev) => (prev === it.indikator ? null : it.indikator))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedIndikator((prev) => (prev === it.indikator ? null : it.indikator));
                      }
                    }}
                    style={{
                      border: `${active ? 2 : 1}px solid ${sev.color}`,
                      borderRadius: 10,
                      padding: '10px 12px',
                      background: sev.bg,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                      {it.subDimensi.replace(/^SUB-DIMENSI /i, '')}
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8, minHeight: 32 }}>
                      {it.indikator.replace(/^SKOR /i, '')}{tooltip ? ' ⓘ' : ''}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ fontSize: 18, fontWeight: 700, color: sev.color }}>{it.avgSkor}<span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}> / {it.avgBobot}</span></span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: sev.color }}>{sev.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {selectedIndikator && (
            <div className="panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h2 className="panel-title" style={{ marginBottom: 0 }}>
                  Desa dengan Gap: {selectedIndikator.replace(/^SKOR /i, '')}
                </h2>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Link
                    className="btn"
                    style={{ textDecoration: 'none' }}
                    to={`/peta-ekonomi?${new URLSearchParams(cleanParams({
                      kabupaten: filter.kabupaten,
                      kecamatan: filter.kecamatan,
                      indikator: selectedIndikator,
                    }))}`}
                  >
                    Lihat di Peta
                  </Link>
                  <button className="btn btn-secondary" onClick={() => setSelectedIndikator(null)}>Tutup</button>
                </div>
              </div>
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                Desa yang skornya di bawah 60% bobot maksimal indikator ini, diurutkan dari yang paling rendah, pada filter saat ini
                {gapDesaList ? ` (${gapDesaList.length.toLocaleString('id-ID')} desa)` : ''}.
              </p>
              {gapError && <div className="state-msg state-error">{gapError}</div>}
              {!gapDesaList && !gapError && <p className="state-msg">Memuat...</p>}
              {gapDesaList && gapDesaList.length === 0 && <p className="state-msg">Tidak ada desa dengan gap pada filter ini.</p>}
              {gapDesaList && gapDesaList.length > 0 && (
                <div className="table-scroll" style={{ maxHeight: 420, overflowY: 'auto' }}>
                  <table className="data-table">
                    <thead><tr><th>No.</th><th>Desa</th><th>Kecamatan</th><th>Kabupaten</th><th>Skor</th></tr></thead>
                    <tbody>
                      {gapDesaList.slice(0, 300).map((d, i) => (
                        <tr key={d.kode_desa}>
                          <td>{i + 1}</td>
                          <td><Link to={`/profil-desa?kode=${d.kode_desa}`}>{d.nama_desa}</Link></td>
                          <td>{d.kecamatan}</td>
                          <td>{d.kabupaten}</td>
                          <td>{d.skor} / {d.bobot_maks}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {gapDesaList.length > 300 && (
                    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Menampilkan 300 dari {gapDesaList.length.toLocaleString('id-ID')} desa - persempit dengan filter kabupaten/kecamatan.</p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="panel">
            <h2 className="panel-title">Desa Prioritas (Skor {label} Terendah)</h2>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0 }}>
              12 desa dengan skor komposit dimensi ini paling rendah pada filter saat ini.
            </p>
            {data.desaTerendah.length === 0 && <p className="state-msg">Tidak ada data pada filter ini.</p>}
            {data.desaTerendah.length > 0 && (
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Desa</th><th>Kabupaten</th><th>Kecamatan</th><th>Skor {label}</th><th>Status</th></tr></thead>
                  <tbody>
                    {data.desaTerendah.map((d) => (
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
            )}
          </div>
        </>
      )}
    </div>
  );
}
