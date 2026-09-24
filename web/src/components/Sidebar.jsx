import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTheme } from '../theme';
import { useAuth, ROLE_LABEL } from '../auth';

// `roles: undefined` = visible to everyone already past the desa-only cut
// below; `roles: [...]` restricts further (admin-only tools).
// BANUA INDEX has 6 dimension sub-pages - Ringkasan (the first child) stays
// the macro/aggregate view across all 6; each other child drills into that
// one dimension down to indicator level (DimensiDetail.jsx).
const DIMENSI_SUBNAV = [
  ['LAYANAN DASAR', 'Layanan Dasar'],
  ['SOSIAL', 'Sosial'],
  ['EKONOMI', 'Ekonomi'],
  ['LINGKUNGAN', 'Lingkungan'],
  ['AKSESIBILITAS', 'Aksesibilitas'],
  ['TATA KELOLA PEMERINTAHAN DESA', 'Tata Kelola'],
];

// BANUA360 grouped IA, groups collapsible so the list stays short until you
// need it. Only groups with a real page today - Komoditas/BUMDesa(as its
// own group)/KDKMP/Produksi/Pasar/Pelaku Ekonomi/Rantai Nilai etc. from the
// proposed sitemap are deliberately left out until they're actually built
// (a nav entry with no page behind it is worse than not having the entry).
// "Potensi Pengembangan" specifically stays inside BANUA INSIGHT, not split
// out here - user's own earlier "ga usah dipisah" instruction for that page
// still applies. BANUA OPPORTUNITY (built 2026-09-23) reframes BANUA
// INSIGHT's Spatial Matching as "opportunity cards" - see server/lib/opportunity.js.
// A module becomes a `type: 'group'` only once it has 2+ distinct pages;
// a single-page module is a flat `type: 'link'` instead (BANUA INSIGHT,
// BANUA OPPORTUNITY, BANUA ECOSYSTEM, REVIEW RPKP) - a group header with
// one child is just a wasted click. Review RPKP was split out of the
// BANUA ECOSYSTEM group (2026-09-24) once it grew into its own 6-tab
// workspace (Overview/Dokumen/Review/Temuan/Keputusan/Riwayat) with 6 AI
// engines - it no longer belonged at the same nav depth as the plain
// Ekosistem Ekonomi page it used to sit beside.
const NAV = [
  { type: 'link', to: '/', label: 'Dashboard', icon: '▦', end: true },

  {
    type: 'group',
    label: 'BANUA INDEX',
    icon: '◆',
    children: [
      { to: '/indeks-desa', label: 'Ringkasan', end: true },
      ...DIMENSI_SUBNAV.map(([dimensi, label]) => ({ to: `/banua-index/${encodeURIComponent(dimensi)}`, label })),
    ],
  },
  { type: 'group', label: 'BANUA PROFILE', icon: '◇', children: [{ to: '/profil-desa', label: 'Profil Desa' }] },
  { type: 'group', label: 'BANUA POTENSI', icon: '◆', children: [{ to: '/potensi-desa', label: 'Potensi Desa' }] },
  { type: 'link', to: '/ekosistem-ekonomi', label: 'BANUA ECOSYSTEM', icon: '◈' },
  { type: 'group', label: 'BANUA MAP', icon: '◎', children: [{ to: '/peta-ekonomi', label: 'Peta Ekonomi' }] },
  {
    type: 'group',
    label: 'BANUA ANALYTICS',
    icon: '✦',
    children: [
      { to: '/analisis', label: 'Kuadran' },
      { to: '/analisis-bumdes', label: 'BUMDesa' },
    ],
  },

  { type: 'link', to: '/banua-insight', label: 'BANUA INSIGHT', icon: '◆' },
  { type: 'link', to: '/banua-opportunity', label: 'BANUA OPPORTUNITY', icon: '◇' },
  { type: 'link', to: '/rpkp/review', label: 'REVIEW RPKP', icon: '▤', roles: ['kabupaten', 'provinsi', 'admin'] },

  { type: 'link', to: '/data', label: 'Data', icon: '⚙', roles: ['admin'] },
  { type: 'group', label: 'ADMIN', icon: '●', roles: ['admin'], children: [{ to: '/pengguna', label: 'Manajemen Pengguna' }] },
];

// Operator desa only has one meaningful destination - their own village -
// so the rest of the multi-village nav (Dashboard, Peta, Analisis, ...)
// would just be confusing clutter around a single scoped-down data point.
const DESA_NAV = [{ type: 'link', to: '/profil-desa', label: 'Profil Desa', icon: '⌂' }];

const MODES = [
  { key: 'light', label: 'Terang', icon: '☀' },
  { key: 'system', label: 'Auto', icon: '◑' },
  { key: 'dark', label: 'Gelap', icon: '☽' },
];

function childMatches(child, pathname) {
  return child.end ? pathname === child.to : pathname.startsWith(child.to);
}

function activeGroupLabel(pathname) {
  for (const item of NAV) {
    if (item.type === 'group' && item.children.some((c) => childMatches(c, pathname))) return item.label;
  }
  return null;
}

export default function Sidebar({ open, onClose }) {
  const { mode, setMode } = useTheme();
  const { user, logout } = useAuth();
  const location = useLocation();
  const [expanded, setExpanded] = useState(() => {
    const active = activeGroupLabel(location.pathname);
    return new Set(active ? [active] : []);
  });

  // Whichever group holds the current page auto-opens on navigation
  // (without forcing others shut) - groups you opened yourself stay open.
  useEffect(() => {
    const active = activeGroupLabel(location.pathname);
    if (!active) return;
    setExpanded((prev) => (prev.has(active) ? prev : new Set(prev).add(active)));
  }, [location.pathname]);

  function toggleGroup(label) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  const items = user.role === 'desa' ? DESA_NAV : NAV.filter((item) => !item.roles || item.roles.includes(user.role));

  return (
    <>
      <div className={`sidebar-backdrop ${open ? 'open' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div>
            <div className="sidebar-brand-title">Banua360</div>
            <div className="sidebar-brand-sub">SISTEM INTELLIGENCE PEMBANGUNAN DESA KALIMANTAN SELATAN</div>
          </div>
          <button className="sidebar-close-btn" onClick={onClose} aria-label="Tutup menu">&times;</button>
        </div>
        <nav>
          {items.map((item) => {
            if (item.type === 'group') {
              const isOpen = expanded.has(item.label);
              const children = item.children.filter((c) => !c.roles || c.roles.includes(user.role));
              return (
                <div key={`group-${item.label}`}>
                  <button
                    type="button"
                    className={`sidebar-group ${isOpen ? 'open' : ''}`}
                    onClick={() => toggleGroup(item.label)}
                    aria-expanded={isOpen}
                  >
                    <span className="sidebar-group-icon" aria-hidden="true">{item.icon}</span>
                    <span className="sidebar-group-label">{item.label}</span>
                    <span className="sidebar-group-chevron" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                  </button>
                  {isOpen && children.map((c) => (
                    <NavLink
                      key={c.to}
                      to={c.to}
                      end={c.end}
                      onClick={onClose}
                      className={({ isActive }) => `indent ${isActive ? 'active' : ''}`.trim()}
                    >
                      <span className="sidebar-subdot" aria-hidden="true" />
                      {c.label}
                    </NavLink>
                  ))}
                </div>
              );
            }
            return (
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
            );
          })}
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
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 12, textAlign: 'center' }}>
            Dibangun oleh Dory Amanda Sari, S.Kom., M.M.
          </div>
        </div>
      </aside>
    </>
  );
}
