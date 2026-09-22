import { useEffect, useState } from 'react';
import { api } from '../api';

const ROLE_LABEL = { desa: 'Desa', kabupaten: 'Kabupaten', provinsi: 'Provinsi', admin: 'Admin' };

export default function ManajemenPengguna() {
  const [role, setRole] = useState('desa');
  const [kabupatenList, setKabupatenList] = useState([]);
  const [kecamatanList, setKecamatanList] = useState([]);
  const [desaList, setDesaList] = useState([]);
  const [kabupaten, setKabupaten] = useState('');
  const [kecamatan, setKecamatan] = useState('');
  const [kodeDesa, setKodeDesa] = useState('');
  const [generated, setGenerated] = useState(null);
  const [error, setError] = useState(null);
  const [kodeList, setKodeList] = useState(null);
  const [userList, setUserList] = useState(null);

  function refreshLists() {
    api.kodeRegistrasiList().then(setKodeList).catch((e) => setError(e.message));
    api.usersList().then(setUserList).catch((e) => setError(e.message));
  }

  useEffect(() => {
    api.kabupaten().then(setKabupatenList).catch((e) => setError(e.message));
    refreshLists();
  }, []);

  useEffect(() => {
    if (!kabupaten) { setKecamatanList([]); return; }
    api.kecamatan(kabupaten).then(setKecamatanList).catch((e) => setError(e.message));
  }, [kabupaten]);

  useEffect(() => {
    if (!kabupaten) { setDesaList([]); return; }
    api.desaList({ kabupaten, kecamatan }).then(setDesaList).catch((e) => setError(e.message));
  }, [kabupaten, kecamatan]);

  async function generate() {
    setError(null);
    setGenerated(null);
    try {
      const payload = { role };
      if (role === 'desa') payload.kode_desa = kodeDesa;
      if (role === 'kabupaten') payload.kabupaten = kabupaten;
      const res = await api.kodeRegistrasiBuat(payload);
      setGenerated(res.kode);
      refreshLists();
    } catch (e) {
      setError(e.message);
    }
  }

  const canGenerate = role === 'provinsi' || role === 'admin' || (role === 'desa' && kodeDesa) || (role === 'kabupaten' && kabupaten);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Manajemen Pengguna</h1>
        <p className="page-desc">Buat kode registrasi untuk operator desa/kabupaten, lihat kode & user yang sudah terdaftar.</p>
      </div>

      <div className="panel">
        <h2 className="panel-title">Buat Kode Registrasi Baru</h2>
        {error && <div className="state-msg state-error" style={{ padding: '8px 0' }}>{error}</div>}
        <div className="filter-bar" style={{ marginTop: 0 }}>
          <select value={role} onChange={(e) => { setRole(e.target.value); setGenerated(null); }}>
            <option value="desa">Desa</option>
            <option value="kabupaten">Kabupaten</option>
            <option value="provinsi">Provinsi</option>
            <option value="admin">Admin</option>
          </select>

          {(role === 'desa' || role === 'kabupaten') && (
            <select value={kabupaten} onChange={(e) => { setKabupaten(e.target.value); setKecamatan(''); setKodeDesa(''); }}>
              <option value="">Pilih Kabupaten</option>
              {kabupatenList.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          )}

          {role === 'desa' && kabupaten && (
            <select value={kecamatan} onChange={(e) => { setKecamatan(e.target.value); setKodeDesa(''); }}>
              <option value="">Semua Kecamatan</option>
              {kecamatanList.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          )}

          {role === 'desa' && kabupaten && (
            <select value={kodeDesa} onChange={(e) => setKodeDesa(e.target.value)}>
              <option value="">Pilih Desa</option>
              {desaList.map((d) => <option key={d.kode_desa} value={d.kode_desa}>{d.nama_desa} ({d.kecamatan})</option>)}
            </select>
          )}
        </div>
        <button className="btn" onClick={generate} disabled={!canGenerate}>Generate Kode</button>

        {generated && (
          <div style={{ marginTop: 14, background: 'var(--good-soft)', borderRadius: 10, padding: '12px 16px' }}>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 4px' }}>Kode registrasi baru (bagikan ke operator terkait):</p>
            <p style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', margin: 0, letterSpacing: 1 }}>{generated}</p>
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">Daftar Kode Registrasi</h2>
        {!kodeList && <p className="state-msg">Memuat...</p>}
        {kodeList && kodeList.length === 0 && <p className="state-msg">Belum ada kode dibuat.</p>}
        {kodeList && kodeList.length > 0 && (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr><th>Kode</th><th>Role</th><th>Target</th><th>Dibuat</th><th>Status</th><th>Dipakai Oleh</th></tr>
              </thead>
              <tbody>
                {kodeList.map((k) => (
                  <tr key={k.id}>
                    <td style={{ fontFamily: 'monospace' }}>{k.kode}</td>
                    <td>{ROLE_LABEL[k.role]}</td>
                    <td>{k.kode_desa || k.kabupaten || '-'}</td>
                    <td>{new Date(k.dibuat_pada).toLocaleDateString('id-ID')}</td>
                    <td>{k.dipakai_oleh_user_id ? <span className="badge badge-mandiri">Terpakai</span> : <span className="badge badge-berkembang">Belum</span>}</td>
                    <td>{k.dipakai_oleh_email || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">Daftar Pengguna Terdaftar</h2>
        {!userList && <p className="state-msg">Memuat...</p>}
        {userList && userList.length === 0 && <p className="state-msg">Belum ada pengguna terdaftar.</p>}
        {userList && userList.length > 0 && (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr><th>Email</th><th>Nama</th><th>Role</th><th>Wilayah</th><th>Login Terakhir</th></tr>
              </thead>
              <tbody>
                {userList.map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>{u.nama || '-'}</td>
                    <td>{ROLE_LABEL[u.role]}</td>
                    <td>{u.kode_desa || u.kabupaten || '-'}</td>
                    <td>{u.login_terakhir ? new Date(u.login_terakhir).toLocaleString('id-ID') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
