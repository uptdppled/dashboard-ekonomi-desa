import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { cleanParams } from '../utils';

const LEVEL_LABEL = { kab: 'Kabupaten/Kota', prov: 'Provinsi' };

const PRIORITAS_STYLE = {
  Tinggi: { background: 'var(--critical-soft)', color: 'var(--critical)' },
  Sedang: { background: 'var(--warning-soft)', color: 'var(--warning)' },
  Rendah: { background: 'var(--panel-2)', color: 'var(--text-muted)' },
};

const PERAN_STYLE = {
  Utama: { background: 'var(--accent-soft)', color: 'var(--accent-ink)' },
  Pendukung: { background: 'var(--panel-2)', color: 'var(--text-muted)' },
  Fasilitasi: { background: 'var(--panel-2)', color: 'var(--text-muted)' },
};

const fmt = (n) => n.toLocaleString('id-ID');
const pct = (p) => `${Math.round(p * 100)}%`;
const namaIndikator = (i) => (i.induk ? `${i.label} (${i.induk})` : i.label);

function DesaGapList({ filter, indikator }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.insightGapDesa(cleanParams({ ...filter, indikator })).then(setList).catch((e) => setError(e.message));
  }, [filter, indikator]);
  if (error) return <p className="state-msg state-error">{error}</p>;
  if (!list) return <p className="state-msg">Memuat...</p>;
  return (
    <table className="data-table">
      <thead><tr><th>Desa</th><th>Kecamatan</th><th>Kabupaten</th><th>Skor</th></tr></thead>
      <tbody>
        {list.map((d) => (
          <tr key={d.kode_desa}>
            <td><Link to={`/profil-desa?kode=${d.kode_desa}`}>{d.nama_desa}</Link></td>
            <td>{d.kecamatan}</td>
            <td>{d.kabupaten}</td>
            <td>{d.skor} / {d.bobot_maks}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function RujukanIntervensi({ filter, defaultLevel }) {
  const [level, setLevel] = useState(defaultLevel);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [openUrusan, setOpenUrusan] = useState(() => new Set());
  const [openDesa, setOpenDesa] = useState(null);

  useEffect(() => {
    setData(null);
    setError(null);
    setOpenDesa(null);
    api.insightRujukanIntervensi(cleanParams({ ...filter, level }))
      .then((d) => {
        setData(d);
        setOpenUrusan(new Set(d.urusan.slice(0, 1).map((u) => u.kodeUrusan)));
      })
      .catch((e) => setError(e.message));
  }, [filter, level]);

  function toggleUrusan(kode) {
    setOpenUrusan((prev) => {
      const next = new Set(prev);
      if (next.has(kode)) next.delete(kode);
      else next.add(kode);
      return next;
    });
  }

  function toggleDesa(id) {
    setOpenDesa((cur) => (cur === id ? null : id));
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {Object.entries(LEVEL_LABEL).map(([key, label]) => (
          <button key={key} className={key === level ? 'btn' : 'btn btn-secondary'} onClick={() => setLevel(key)}>
            Kewenangan {label}
          </button>
        ))}
      </div>

      <div className="panel">
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0 }}>
          Indikator yang gap (skor di bawah 60% bobot maksimal) dipetakan ke bidang urusan, program, dan kegiatan sesuai nomenklatur
          Permendagri 90/2019 dan Kepmendagri 050-5889/2021, serta SKPD yang lazim menangani, menurut pembagian kewenangan UU 23/2014.
          <strong> Ini rujukan perencanaan, bukan instruksi kepada SKPD.</strong> Nama SKPD perlu disesuaikan dengan SOTK daerah, dan kode
          bertanda <em>perlu cek</em> perlu dicocokkan dengan nomenklatur terbaru di SIPD. Kebutuhan dana tidak dihitung di sini, karena
          ditentukan masing-masing SKPD berdasarkan SSH daerahnya.
        </p>
      </div>

      {error && <div className="state-msg state-error">{error}</div>}
      {!data && !error && <div className="state-msg">Memuat data...</div>}

      {data && (
        <>
          <div className="kpi-row">
            <div className="kpi-card">
              <div className="kpi-label">Indikator Gap dalam Kewenangan</div>
              <div className="kpi-value">
                {fmt(data.ringkasan.indikatorDalamKewenangan)}
                <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 400 }}> / {fmt(data.ringkasan.indikatorGap)}</span>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Bidang Urusan Terlibat</div>
              <div className="kpi-value">{fmt(data.ringkasan.jumlahUrusan)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Indikator Prioritas Tinggi</div>
              <div className="kpi-value">{fmt(data.ringkasan.prioritasTinggi)}</div>
            </div>
          </div>

          <div className="panel">
            <h2 className="panel-title">Rujukan per Bidang Urusan &middot; Kewenangan {LEVEL_LABEL[level]}</h2>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0 }}>
              Diurutkan dari jumlah kasus gap terbanyak pada indikator yang ditangani sebagai peran <strong>Utama</strong>.
              Satu desa bisa terhitung di beberapa indikator. Prioritas: Tinggi bila ≥30% desa gap, Sedang bila ≥10%.
            </p>
            {data.urusan.length === 0 && <p className="state-msg">Tidak ada indikator gap dalam kewenangan ini pada filter yang dipilih.</p>}
            {/* minmax(0, 1fr): tanpa ini kolom grid melebar mengikuti tabel rincian dan halaman ikut bergeser ke samping. */}
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'minmax(0, 1fr)' }}>
              {data.urusan.map((u) => {
                const open = openUrusan.has(u.kodeUrusan);
                return (
                  <div key={u.kodeUrusan} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                          <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{u.kodeUrusan}</span> {u.namaUrusan}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{u.skpd.join(' · ')}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {u.jumlahUtama > 0 ? (
                          <span className="badge" style={{ background: 'var(--critical-soft)', color: 'var(--critical)' }}>
                            {fmt(u.kasusGapUtama)} kasus gap
                          </span>
                        ) : (
                          <span className="badge" style={PERAN_STYLE.Pendukung}>peran pendukung</span>
                        )}
                        <span className="badge" style={{ background: 'var(--panel-2)', color: 'var(--text-muted)' }}>
                          {u.indikator.length} indikator
                        </span>
                        <button className="btn btn-secondary" onClick={() => toggleUrusan(u.kodeUrusan)}>
                          {open ? 'Tutup' : 'Rincian'}
                        </button>
                      </div>
                    </div>
                    {open && (
                      <div className="table-scroll" style={{ marginTop: 12 }}>
                        <table className="data-table">
                          <thead>
                            <tr><th>Indikator</th><th>Desa Gap</th><th>Prioritas</th><th>Peran</th><th>Program</th><th>Kegiatan Rujukan</th><th>SKPD Lazim</th><th></th></tr>
                          </thead>
                          <tbody>
                            {u.indikator.map((i, idx) => {
                              const id = `${u.kodeUrusan}|${i.key}|${idx}`;
                              return (
                                <Fragment key={id}>
                                  <tr>
                                    <td style={{ fontWeight: 600, whiteSpace: 'normal', minWidth: 180 }}>{namaIndikator(i)}</td>
                                    <td style={{ whiteSpace: 'nowrap' }}>{fmt(i.jumlahGap)} <span style={{ color: 'var(--text-muted)' }}>({pct(i.persenGap)})</span></td>
                                    <td><span className="badge" style={PRIORITAS_STYLE[i.prioritas]}>{i.prioritas}</span></td>
                                    <td><span className="badge" style={PERAN_STYLE[i.peran]}>{i.peran}</span></td>
                                    <td style={{ fontSize: 12, whiteSpace: 'normal', minWidth: 200 }}>
                                      <span style={{ color: 'var(--text-muted)' }}>{i.kodeProgram}</span> {i.program}
                                      {i.perluCek && (
                                        <span className="badge" style={{ marginLeft: 6, background: 'var(--warning-soft)', color: 'var(--warning)' }}>perlu cek</span>
                                      )}
                                    </td>
                                    <td style={{ fontSize: 12, whiteSpace: 'normal', minWidth: 240 }}>
                                      {i.kegiatan}
                                      {i.catatan && !u.indikator.slice(0, idx).some((p) => p.key === i.key) && <div style={{ color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>{i.catatan}</div>}
                                    </td>
                                    <td style={{ fontSize: 12, whiteSpace: 'normal', minWidth: 140 }}>{i.skpd}</td>
                                    <td>
                                      <button className="btn btn-secondary" style={{ whiteSpace: 'nowrap' }} onClick={() => toggleDesa(id)}>
                                        {openDesa === id ? 'Tutup' : 'Lihat Desa'}
                                      </button>
                                    </td>
                                  </tr>
                                  {openDesa === id && (
                                    <tr>
                                      <td colSpan={8} style={{ background: 'var(--panel-2)' }}>
                                        <DesaGapList filter={filter} indikator={i.key} />
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {data.diLuarKewenangan.length > 0 && (
            <div className="panel">
              <h2 className="panel-title">Di Luar Kewenangan {LEVEL_LABEL[level]}</h2>
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0 }}>
                Indikator gap yang tidak punya nomenklatur urusan di tingkat ini. Penanganannya ada di tingkat lain, di pusat, atau di desa melalui APBDes.
              </p>
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Indikator</th><th>Desa Gap</th><th>Kewenangan</th><th>Peran Pusat</th><th>Peran Desa</th><th>Catatan</th></tr></thead>
                  <tbody>
                    {data.diLuarKewenangan.map((i) => (
                      <tr key={i.key}>
                        <td style={{ fontWeight: 600, whiteSpace: 'normal', minWidth: 180 }}>{namaIndikator(i)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmt(i.jumlahGap)} <span style={{ color: 'var(--text-muted)' }}>({pct(i.persenGap)})</span></td>
                        <td style={{ fontSize: 12 }}>{i.kewenanganLain || 'Pusat/Desa'}</td>
                        <td style={{ fontSize: 12, whiteSpace: 'normal', minWidth: 180 }}>{i.pusat || '-'}</td>
                        <td style={{ fontSize: 12, whiteSpace: 'normal', minWidth: 180 }}>{i.desa || '-'}</td>
                        <td style={{ fontSize: 12, whiteSpace: 'normal', minWidth: 200 }}>{i.catatan || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
