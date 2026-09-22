import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';

// Shared kabupaten/kecamatan/status filter, synced with URL search params
// via the (kabupaten, kecamatan, status, onChange) props the caller owns.
// /api/wilayah/kabupaten is itself scoped server-side (a `kabupaten`-role
// account only ever gets its own kabupaten back), so a locked single-option
// list here is just surfacing that - not a separate access check.
export default function FilterBar({ value, onChange, showSearch }) {
  const { user } = useAuth();
  const [kabupatenList, setKabupatenList] = useState([]);
  const [kecamatanList, setKecamatanList] = useState([]);
  const kabupatenLocked = kabupatenList.length === 1 && user.role !== 'admin' && user.role !== 'provinsi';

  useEffect(() => {
    api.kabupaten().then(setKabupatenList).catch(() => {});
  }, []);

  // Once the scoped kabupaten list resolves to a single forced value, fill
  // it in automatically so the rest of the filters (and the API calls that
  // depend on `value.kabupaten`) work without the user having to pick it.
  useEffect(() => {
    if (kabupatenLocked && value.kabupaten !== kabupatenList[0]) {
      onChange({ ...value, kabupaten: kabupatenList[0] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kabupatenLocked, kabupatenList]);

  useEffect(() => {
    api.kecamatan(value.kabupaten).then(setKecamatanList).catch(() => {});
  }, [value.kabupaten]);

  function update(field, val) {
    const next = { ...value, [field]: val };
    if (field === 'kabupaten') next.kecamatan = '';
    onChange(next);
  }

  return (
    <div className="filter-bar">
      <select value={value.kabupaten || ''} onChange={(e) => update('kabupaten', e.target.value)} disabled={kabupatenLocked}>
        {!kabupatenLocked && <option value="">Semua Kabupaten</option>}
        {kabupatenList.map((k) => (
          <option key={k} value={k}>{k}</option>
        ))}
      </select>
      <select value={value.kecamatan || ''} onChange={(e) => update('kecamatan', e.target.value)}>
        <option value="">Semua Kecamatan</option>
        {kecamatanList.map((k) => (
          <option key={k} value={k}>{k}</option>
        ))}
      </select>
      <select value={value.status || ''} onChange={(e) => update('status', e.target.value)}>
        <option value="">Semua Status Desa</option>
        <option value="MANDIRI">Mandiri</option>
        <option value="MAJU">Maju</option>
        <option value="BERKEMBANG">Berkembang</option>
        <option value="TERTINGGAL">Tertinggal</option>
        <option value="SANGAT TERTINGGAL">Sangat Tertinggal</option>
      </select>
      {showSearch && (
        <input
          type="text"
          placeholder="Cari nama desa..."
          value={value.q || ''}
          onChange={(e) => update('q', e.target.value)}
        />
      )}
    </div>
  );
}
