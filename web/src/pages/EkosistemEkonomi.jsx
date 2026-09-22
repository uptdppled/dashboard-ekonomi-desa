import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../api';
import { useTheme } from '../theme';
import { ACCENT_SECONDARY } from '../colors';

export default function EkosistemEkonomi() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const { resolved } = useTheme();

  useEffect(() => {
    api.ekosistemSummary().then(setRows).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Ekosistem Ekonomi Pendukung</h1>
        <p className="page-desc">
          Sebaran BUM Desa, Koperasi Desa Merah Putih (KDMP), dan komponen ekosistem ekonomi lain per desa.
        </p>
      </div>

      {error && <div className="state-msg state-error">{error}</div>}
      {!rows && !error && <div className="state-msg">Memuat data...</div>}

      {rows && (
        <div className="panel">
          <h2 className="panel-title">Jumlah Desa per Komponen (30 teratas)</h2>
          <ResponsiveContainer width="100%" height={Math.max(300, rows.length * 26)}>
            <BarChart data={rows} layout="vertical" margin={{ left: 20 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="komponen" width={340} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="jumlah_desa" fill={ACCENT_SECONDARY[resolved]} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
