import { NavLink } from 'react-router-dom';
import { useTheme } from '../theme';
import { useAuth, ROLE_LABEL } from '../auth';

// `roles: undefined` = visible to everyone already past the desa-only cut
// below; `roles: [...]` restricts further (admin-only tools).
const NAV = [
  { to: '/', label: 'Dashboard', icon: '▦', end: true },
  { to: '/dimensi-ekonomi', label: 'Dimensi Ekonomi', icon: '▤' },
  { to: '/potensi-desa', label: 'Potensi Desa', icon: '⬢' },
  { to: '/profil-desa', label: 'Profil Desa', icon: '⌂' },
  { to: '/ekosistem-ekonomi', label: 'Ekosistem Ekonomi', icon: '⛁' },
  { to: '/peta-ekonomi', label: 'Peta Ekonomi', icon: '⚑' },
  { to: '/analisis', label: 'Analisis Kuadran', icon: '✦' },
  { to: '/analisis-bumdes', label: 'Analisis BUMDes', icon: '⛛' },
  { to: '/data', label: 'Data', icon: '⚙', roles: ['admin'] },
  { to: '/pengguna', label: 'Manajemen Pengguna', icon: '⚉', roles: ['admin'] },
];

// Operator desa only has one meaningful destination - their own village -
// so the rest of the multi-village nav (Dashboard, Peta, Analisis, ...)
// would just be confusing clutter around a single scoped-down data point.
const DESA_NAV = [{ to: '/profil-desa', label: 'Profil Desa', icon: '⌂' }];

const MODES = [
  { key: 'light', label: 'Terang', icon: '☀' },
  { key: 'system', label: 'Auto', icon: '◑' },
  { key: 'dark', label: 'Gelap', icon: '☽' },
];

export default function Sidebar({ open, onClose }) {
  const { mode, setMode } = useTheme();
  const { user, logout } = useAuth();

  const items = user.role === 'desa' ? DESA_NAV : NAV.filter((item) => !item.roles || item.roles.includes(user.role));

  return (
    <>
      <div className={`sidebar-backdrop ${open ? 'open' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div>
            <div className="sidebar-brand-title">Dashboard Ekonomi Desa</div>
            <div className="sidebar-brand-sub">KALIMANTAN SELATAN</div>
          </div>
          <button className="sidebar-close-btn" onClick={onClose} aria-label="Tutup menu">&times;</button>
        </div>
        <nav>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onClose}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              <span className="sidebar-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div style={{ fontSize: 12, color: '#c9d6e3', marginBottom: 2 }}>{user.email}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 10 }}>
            {ROLE_LABEL[user.role]}{user.kabupaten ? ` · ${user.kabupaten}` : ''}
          </div>
          <button
            onClick={logout}
            style={{
              width: '100%', background: 'rgba(255,255,255,0.06)', border: 'none', color: '#c9d6e3',
              borderRadius: 8, padding: '8px 0', fontSize: 12, cursor: 'pointer', marginBottom: 10,
            }}
          >
            Keluar
          </button>
          <div className="theme-toggle">
            {MODES.map((m) => (
              <button key={m.key} className={mode === m.key ? 'active' : ''} onClick={() => setMode(m.key)}>
                <span aria-hidden="true">{m.icon}</span> {m.label}
              </button>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}
