import { useEffect, useState } from 'react';
import { Routes, Route, useLocation, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import DimensiEkonomi from './pages/DimensiEkonomi';
import PotensiDesa from './pages/PotensiDesa';
import PotensiSektorDetail from './pages/PotensiSektorDetail';
import ProfilDesa from './pages/ProfilDesa';
import EkosistemEkonomi from './pages/EkosistemEkonomi';
import PetaEkonomi from './pages/PetaEkonomi';
import Analisis from './pages/Analisis';
import AnalisisBumdes from './pages/AnalisisBumdes';
import DataImport from './pages/DataImport';
import ManajemenPengguna from './pages/ManajemenPengguna';
import { useAuth } from './auth';

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { user, loading } = useAuth();

  useEffect(() => setSidebarOpen(false), [location.pathname]);

  if (loading) {
    return <div className="state-msg" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Memuat...</div>;
  }

  if (!user) {
    return <Login />;
  }

  // Operator desa only ever needs their own village's profile - no
  // multi-village views apply to them, so they land straight on it instead
  // of an empty Dashboard. The server independently enforces this scope on
  // every endpoint regardless of what the frontend routes to.
  const homeElement = user.role === 'desa'
    ? <Navigate to={`/profil-desa?kode=${user.kode_desa}`} replace />
    : <Dashboard />;

  return (
    <div className="app-shell">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="content-area">
        <div className="topbar">
          <button className="icon-btn" onClick={() => setSidebarOpen(true)} aria-label="Buka menu">
            &#9776;
          </button>
          <span className="topbar-title">Dashboard Ekonomi Desa</span>
        </div>
        <main className="main">
          <Routes>
            <Route path="/" element={homeElement} />
            <Route path="/dimensi-ekonomi" element={<DimensiEkonomi />} />
            <Route path="/potensi-desa" element={<PotensiDesa />} />
            <Route path="/potensi-desa/:sektor" element={<PotensiSektorDetail />} />
            <Route path="/profil-desa" element={<ProfilDesa />} />
            <Route path="/ekosistem-ekonomi" element={<EkosistemEkonomi />} />
            <Route path="/peta-ekonomi" element={<PetaEkonomi />} />
            <Route path="/analisis" element={<Analisis />} />
            <Route path="/analisis-bumdes" element={<AnalisisBumdes />} />
            {user.role === 'admin' && <Route path="/data" element={<DataImport />} />}
            {user.role === 'admin' && <Route path="/pengguna" element={<ManajemenPengguna />} />}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
