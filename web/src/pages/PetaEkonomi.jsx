import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import { Link } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import { api } from '../api';
import FilterBar from '../components/FilterBar';
import { cleanParams } from '../utils';
import { useTheme } from '../theme';
import { STATUS_COLORS } from '../colors';

const KALSEL_CENTER = [-3.05, 115.3];

export default function PetaEkonomi() {
  const [filter, setFilter] = useState({});
  const [points, setPoints] = useState(null);
  const [error, setError] = useState(null);
  const { resolved } = useTheme();
  const statusColors = STATUS_COLORS[resolved];

  useEffect(() => {
    setPoints(null);
    api.peta(cleanParams(filter)).then(setPoints).catch((e) => setError(e.message));
  }, [filter]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Peta Ekonomi</h1>
        <p className="page-desc">
          Titik lokasi seluruh desa berdasarkan koordinat GPS hasil geocoding alamat desa.
        </p>
      </div>
      <FilterBar value={filter} onChange={setFilter} />

      {error && <div className="state-msg state-error">{error}</div>}
      {!points && !error && <div className="state-msg">Memuat titik peta...</div>}

      {points && (
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <MapContainer center={KALSEL_CENTER} zoom={8} style={{ height: 560, width: '100%' }}>
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {points.map((p) => (
              <CircleMarker
                key={p.kode_desa}
                center={[p.lat, p.lng]}
                radius={5}
                pathOptions={{ color: statusColors[p.status_desa] || '#666', fillOpacity: 0.7 }}
              >
                <Popup>
                  <strong>{p.nama_desa}</strong><br />
                  {p.kecamatan}, {p.kabupaten}<br />
                  Status: {p.status_desa}<br />
                  Skor Ekonomi: {p.skor_ekonomi ?? '-'}<br />
                  <Link to={`/profil-desa?kode=${p.kode_desa}`}>Lihat profil desa</Link>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      )}
      {points && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{points.length.toLocaleString('id-ID')} desa dengan koordinat tersedia.</p>}
    </div>
  );
}
