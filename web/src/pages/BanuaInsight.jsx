import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { cleanParams } from '../utils';

const DIMENSI_OPTIONS = ['LAYANAN DASAR', 'SOSIAL', 'EKONOMI', 'LINGKUNGAN', 'AKSESIBILITAS', 'TATA KELOLA PEMERINTAHAN DESA'];

export default function BanuaInsight() {
  const { user } = useAuth();
  const [kabupatenList, setKabupatenList] = useState([]);
  const [kecamatanList, setKecamatanList] = useState([]);
  const [filter, setFilter] = useState({ kabupaten: '', kecamatan: '', dimensi: '' });
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [expandedGap, setExpandedGap] = useState(null);
  const [gapDesaList, setGapDesaList] = useState(null);
  const [showTanpaKoordinat, setShowTanpaKoordinat] = useState(false);
  const [tanpaKoordinatList, setTanpaKoordinatList] = useState(null);
  const [naikStatus, setNaikStatus] = useState(null);

  const kabupatenLocked = kabupatenList.length === 1 && user.role !== 'admin' && user.role !== 'provinsi';

  useEffect(() => {
    api.kabupaten().then((list) => {
      setKabupatenList(list);
      if (list.length === 1) setFilter((f) => ({ ...f, kabupaten: list[0] }));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    api.kecamatan(filter.kabupaten).then(setKecamatanList).catch(() => {});
  }, [filter.kabupaten]);

  useEffect(() => {
    setData(null);
    setError(null);
    setExpandedGap(null);
    setShowTanpaKoordinat(false);
    api.insightRingkasan(cleanParams(filter)).then(setData).catch((e) => setError(e.message));
  }, [filter]);

  useEffect(() => {
    setNaikStatus(null);
    api.insightNaikStatus(cleanParams(filter)).then(setNaikStatus).catch(() => {});
  }, [filter]);

  function update(field, val) {
    const next = { ...filter, [field]: val };
    if (field === 'kabupaten') next.kecamatan = '';
    setFilter(next);
  }

  function toggleGap(indikator) {
    if (expandedGap === indikator) {
      setExpandedGap(null);
      return;
    }
    setExpandedGap(indikator);
    setGapDesaList(null);
    api.insightGapDesa(cleanParams({ ...filter, indikator })).then(setGapDesaList).catch((e) => setError(e.message));
  }

  function toggleTanpaKoordinat() {
    if (showTanpaKoordinat) {
      setShowTanpaKoordinat(false);
      return;
    }
    setShowTanpaKoordinat(true);
    setTanpaKoordinatList(null);
    api.insightTanpaKoordinat(cleanParams(filter)).then(setTanpaKoordinatList).catch((e) => setError(e.message));
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">BANUA INSIGHT</h1>
        <p className="page-desc">
          Analisis berbasis data untuk menemukan area perhatian, potensi pengembangan, dan kandidat naik status desa. Tahun 2026.
          Untuk peluang keterhubungan antar desa, lihat <Link to="/banua-opportunity">BANUA OPPORTUNITY</Link>.
        </p>
      </div>

      <div className="filter-bar">
        <select value={filter.kabupaten} onChange={(e) => update('kabupaten', e.target.value)} disabled={kabupatenLocked}>
          {!kabupatenLocked && <option value="">Semua Kabupaten</option>}
          {kabupatenList.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <select value={filter.kecamatan} onChange={(e) => update('kecamatan', e.target.value)}>
          <option value="">Semua Kecamatan</option>
          {kecamatanList.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <select value={filter.dimensi} onChange={(e) => update('dimensi', e.target.value)}>
          <option value="">Semua Dimensi</option>
          {DIMENSI_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {error && <div className="state-msg state-error">{error}</div>}
      {!data && !error && <div className="state-msg">Memuat data...</div>}

      {data && (
        <>
          <div className="panel">
            <h2 className="panel-title">Cakupan Data</h2>
            <div className="kpi-row" style={{ marginBottom: 0 }}>
              <div className="kpi-card">
                <div className="kpi-label">Desa</div>
                <div className="kpi-value">{data.coverage.totalDesa.toLocaleString('id-ID')}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Desa dengan Data Potensi</div>
                <div className="kpi-value">
                  {data.coverage.desaDenganPotensi.toLocaleString('id-ID')}
                  <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400 }}> ({Math.round((data.coverage.desaDenganPotensi / data.coverage.totalDesa) * 100)}%)</span>
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Desa dengan Koordinat</div>
                <div className="kpi-value">
                  {data.coverage.desaDenganKoordinat.toLocaleString('id-ID')}
                  <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400 }}> ({Math.round((data.coverage.desaDenganKoordinat / data.coverage.totalDesa) * 100)}%)</span>
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
            <h2 className="panel-title">Area Perhatian</h2>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0 }}>
              Indikator dengan skor di bawah 60% dari bobot maksimalnya, diurutkan dari yang paling banyak desa terdampak.
            </p>
            {data.gapAnalysis.length === 0 && <p className="state-msg">Tidak ada gap yang menonjol pada filter ini.</p>}
            <div style={{ display: 'grid', gap: 10 }}>
              {data.gapAnalysis.slice(0, 12).map((g) => (
                <div key={g.indikator} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{g.indikator.replace(/^SKOR /i, '')}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                        {g.dimensi} &middot; {g.subDimensi.replace(/^SUB-DIMENSI /i, '')}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="badge" style={{ background: 'var(--critical-soft)', color: 'var(--critical)' }}>
                        {g.jumlahGap.toLocaleString('id-ID')} desa
                      </span>
                      <button className="btn btn-secondary" onClick={() => toggleGap(g.indikator)}>
                        {expandedGap === g.indikator ? 'Tutup' : 'Lihat Desa'}
                      </button>
                    </div>
                  </div>
                  {expandedGap === g.indikator && (
                    <div className="table-scroll" style={{ marginTop: 12 }}>
                      {!gapDesaList && <p className="state-msg">Memuat...</p>}
                      {gapDesaList && (
                        <table className="data-table">
                          <thead><tr><th>Desa</th><th>Kecamatan</th><th>Kabupaten</th><th>Skor</th></tr></thead>
                          <tbody>
                            {gapDesaList.map((d) => (
                              <tr key={d.kode_desa}>
                                <td><Link to={`/profil-desa?kode=${d.kode_desa}`}>{d.nama_desa}</Link></td>
                                <td>{d.kecamatan}</td>
                                <td>{d.kabupaten}</td>
                                <td>{d.skor} / {d.bobot_maks}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <h2 className="panel-title">Potensi Pengembangan</h2>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0 }}>
              Potensi pengembangan teridentifikasi berdasarkan keberadaan potensi sektor dan gap pada indikator Fasilitas Pendukung Ekonomi. Ini bukan klaim kebutuhan spesifik, hanya irisan dua data yang sudah ada.
            </p>
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Sektor</th><th>Desa dengan Potensi</th><th>Desa dengan Gap Fasilitas</th></tr></thead>
                <tbody>
                  {data.potensiPengembangan.map((p) => (
                    <tr key={p.sektor}>
                      <td>{p.sektor}</td>
                      <td>{p.jumlahDesaPotensi.toLocaleString('id-ID')}</td>
                      <td>{p.jumlahDesaGapFasilitas.toLocaleString('id-ID')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <h2 className="panel-title">Kandidat Naik Status</h2>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0 }}>
              Desa BERKEMBANG dan MAJU diurutkan berdasarkan skor komposit 6 dimensi BANUA INDEX milik desa itu sendiri - desa dengan skor tertinggi di tier-nya adalah kandidat paling realistis untuk intervensi cepat menuju tier berikutnya. <strong>Ini peringkat internal aplikasi berdasarkan skor komposit, bukan hasil perhitungan resmi status desa dari Kemendes</strong> (rumus resminya tidak ada di data sumber) - gunakan sebagai titik awal diskusi, bukan keputusan final.
            </p>
            {!naikStatus && <p className="state-msg">Memuat...</p>}
            {naikStatus && naikStatus.map((grup) => (
              <div key={grup.dari} style={{ marginBottom: 22 }}>
                <h3 style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>
                  {grup.dari} &rarr; {grup.ke}
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
                    (menampilkan {grup.kandidat.length} dari {grup.totalDiTier.toLocaleString('id-ID')} desa {grup.dari})
                  </span>
                </h3>
                {grup.kandidat.length === 0 && <p className="state-msg">Tidak ada desa {grup.dari} pada filter ini.</p>}
                {grup.kandidat.length > 0 && (
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr><th>No.</th><th>Desa</th><th>Kabupaten</th><th>Kecamatan</th><th>Skor Komposit</th><th>Indikator Prioritas Diperbaiki</th></tr>
                      </thead>
                      <tbody>
                        {grup.kandidat.map((d, i) => (
                          <tr key={d.kode_desa}>
                            <td>{i + 1}</td>
                            <td><Link to={`/profil-desa?kode=${d.kode_desa}`}>{d.nama_desa}</Link></td>
                            <td>{d.kabupaten}</td>
                            <td>{d.kecamatan}</td>
                            <td>{d.totalSkor} / {d.totalBobot} <span style={{ color: 'var(--text-muted)' }}>({Math.round(d.ratio * 100)}%)</span></td>
                            <td style={{ fontSize: 12 }}>
                              {d.gapIndikator.length === 0
                                ? <span style={{ color: 'var(--text-faint)' }}>-</span>
                                : d.gapIndikator.map((g) => g.indikator).join('; ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>

          {data.coverage.desaTanpaKoordinat > 0 && (
            <div className="panel">
              <h2 className="panel-title">Data yang Belum Tersedia</h2>
              <p style={{ fontSize: 13, marginBottom: 12 }}>
                <strong>{data.coverage.desaTanpaKoordinat.toLocaleString('id-ID')} desa</strong> belum memiliki data koordinat, sehingga belum dapat dianalisis pada BANUA OPPORTUNITY. Desa ini tetap masuk pada Area Perhatian dan Potensi Pengembangan.
              </p>
              <button className="btn btn-secondary" onClick={toggleTanpaKoordinat}>
                {showTanpaKoordinat ? 'Tutup' : 'Lihat Desa'}
              </button>
              {showTanpaKoordinat && (
                <div className="table-scroll" style={{ marginTop: 12 }}>
                  {!tanpaKoordinatList && <p className="state-msg">Memuat...</p>}
                  {tanpaKoordinatList && (
                    <table className="data-table">
                      <thead><tr><th>Desa</th><th>Kecamatan</th><th>Kabupaten</th></tr></thead>
                      <tbody>
                        {tanpaKoordinatList.map((d) => (
                          <tr key={d.kode_desa}>
                            <td><Link to={`/profil-desa?kode=${d.kode_desa}`}>{d.nama_desa}</Link></td>
                            <td>{d.kecamatan}</td>
                            <td>{d.kabupaten}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
