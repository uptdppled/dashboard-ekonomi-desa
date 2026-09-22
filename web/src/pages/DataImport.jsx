import { useEffect, useState } from 'react';
import { api } from '../api';

export default function DataImport() {
  const [log, setLog] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState(null);

  function refresh() {
    api.importLog().then(setLog).catch((e) => setError(e.message));
  }

  useEffect(refresh, []);

  async function runImport() {
    setRunning(true);
    setRunResult(null);
    try {
      const res = await api.importRun();
      setRunResult({ ok: true, log: res.log });
      refresh();
    } catch (e) {
      setRunResult({ ok: false, log: e.message });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Data</h1>
        <p className="page-desc">Riwayat import data dari file sumber Excel, dan opsi menjalankan ulang.</p>
      </div>

      <div className="panel">
        <h2 className="panel-title">Jalankan Ulang Import</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Membaca ulang <code>ekonomi.xlsx</code> dan <code>row data ID Aplikasi final kirim.xlsx</code> dari folder
          Downloads, lalu mengisi ulang seluruh database (data lama akan ditimpa). Untuk sumber file baru, ganti
          kedua file di folder yang sama dengan nama yang sama sebelum menjalankan ini.
        </p>
        <button className="btn" onClick={runImport} disabled={running}>
          {running ? 'Sedang mengimpor...' : 'Jalankan Import Ulang'}
        </button>
        {runResult && (
          <pre
            style={{
              marginTop: 14,
              background: runResult.ok ? 'var(--good-soft)' : 'var(--critical-soft)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 12,
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              color: 'var(--text)',
            }}
          >
            {runResult.log}
          </pre>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">Riwayat Import</h2>
        {error && <div className="state-msg state-error">{error}</div>}
        {!log && !error && <div className="state-msg">Memuat...</div>}
        {log && log.length === 0 && <div className="state-msg">Belum ada riwayat import.</div>}
        {log && log.length > 0 && (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Waktu</th><th>Sumber</th><th>Sheet</th><th>Jumlah Baris</th></tr></thead>
              <tbody>
                {log.map((r, i) => (
                  <tr key={i}>
                    <td>{new Date(r.waktu_import).toLocaleString('id-ID')}</td>
                    <td>{r.sumber_file}</td>
                    <td>{r.sheet}</td>
                    <td>{r.jumlah_baris.toLocaleString('id-ID')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">Cakupan Data v1</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Dashboard ini mengimpor 5 sheet inti (identitas &amp; skor dari <code>rekap</code>, jawaban kuesioner
          Ekonomi dari <code>Rekap kuisioner 1</code>, potensi sektor dari <code>Rekap Isu</code>, dan ekosistem
          pendukung dari <code>Rekap Tambahan</code>). Sheet tata kelola &amp; modal sosial (<code>rekap ISU DESA
          PERDESAAN</code>, 2.283 kolom) belum diimpor karena sebagian besar di luar cakupan ekonomi - lihat kamus
          data untuk rincian lengkap.
        </p>
      </div>
    </div>
  );
}
