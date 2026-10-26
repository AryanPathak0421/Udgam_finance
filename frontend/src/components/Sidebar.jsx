import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import Icon from './Icon.jsx';
import { navForUser } from '../config/nav.js';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';

// the number next to a module: how many things wait there (leave to approve, EMI to approve ...). It goes once the module has been opened.
const Badge = ({ n }) => (n > 0 ? <span className="nav-badge" aria-label={`${n} waiting`}>{n > 99 ? '99+' : n}</span> : null);

function NavGroup({ item, collapsed, onNavigate, onExpandSidebar, badge }) {
  const groupCount = item.children.reduce((s, c) => s + badge(c.path), 0);
  const { pathname } = useLocation();
  const childActive = item.children.some((c) => pathname.startsWith(c.path));
  const [open, setOpen] = useState(childActive);

  // Landing on a child route (link, refresh, back button) opens its group.
  useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);

  const onClick = () => {
    if (collapsed) {
      onExpandSidebar();
      setOpen(true);
    } else {
      setOpen((o) => !o);
    }
  };

  return (
    <div className="nav-group">
      <button
        className={`nav-item group-btn${childActive ? ' parent-active' : ''}`}
        onClick={onClick}
        aria-expanded={open && !collapsed}
        title={collapsed ? item.label : undefined}
      >
        <Icon name={item.icon} />
        {!collapsed && (
          <>
            <span>{item.label}</span>
            <Badge n={groupCount} />
            <span className={`caret${open ? ' open' : ''}`}>
              <Icon name="chevron" size={16} />
            </span>
          </>
        )}
      </button>
      {open && !collapsed && (
        <div className="nav-sub">
          {item.children.map((c) => (
            <NavLink
              key={c.path}
              to={c.path}
              className={({ isActive }) => `nav-item sub${isActive ? ' active' : ''}`}
              onClick={onNavigate}
            >
              <Icon name={c.icon} size={16} />
              <span>{c.label}</span>
              <Badge n={badge(c.path)} />
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ collapsed, mobileOpen, onNavigate, onToggleCollapse, onExpandSidebar }) {
  const { user } = useAuth();
  const sections = navForUser(user);
  const { pathname } = useLocation();
  const seenKey = `udgam.seen.${user?.employeeCode || user?.email || ''}`;
  const [counts, setCounts] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [seen, setSeen] = useState(() => { try { return JSON.parse(localStorage.getItem(seenKey) || '{}'); } catch { return {}; } });
  useEffect(() => {
    let live = true;
    const load = () => api.badges().then((r) => { if (live) { setCounts(r.items || {}); setLoaded(true); } }).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => { live = false; clearInterval(t); };
  }, [user]);
  // what was seen can never be more than what is there now: when the work is done and new work comes, the new work shows again
  useEffect(() => {
    if (!loaded) return;
    setSeen((s) => {
      const n = { ...s };
      let changed = false;
      Object.keys(n).forEach((k) => { const c = counts[k] || 0; if (n[k] > c) { n[k] = c; changed = true; } });
      if (!changed) return s;
      try { localStorage.setItem(seenKey, JSON.stringify(n)); } catch { /* not kept */ }
      return n;
    });
  }, [counts, loaded, seenKey]);
  // opening a module marks what waits in it as seen
  useEffect(() => {
    const hit = Object.keys(counts).filter((p) => pathname === p || pathname.startsWith(`${p}/`));
    if (!hit.length) return;
    setSeen((s) => {
      if (hit.every((p) => s[p] === counts[p])) return s;
      const n = { ...s };
      hit.forEach((p) => { n[p] = counts[p]; });
      try { localStorage.setItem(seenKey, JSON.stringify(n)); } catch { /* not kept */ }
      return n;
    });
  }, [pathname, counts, seenKey]);
  const badge = (p) => Math.max((counts[p] || 0) - (seen[p] || 0), 0);
  // a section (Product, Members ...) shows the total of what is new in it
  const sectionCount = (section) => section.items.reduce((t, i) => t + (i.children ? i.children.reduce((x, c) => x + badge(c.path), 0) : badge(i.path)), 0);

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}${mobileOpen ? ' open' : ''}`} aria-label="Main navigation">
      <div className="sidebar-brand">
        <div className="logo-mark" role="img" aria-label="Udgam Microfinance" />
        {!collapsed && <span>Udgam Microfinance</span>}
      </div>

      <nav>
        {sections.map((section) => (
          <div key={section.title} className="nav-section">
            {!collapsed && <div className="nav-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>{section.title}<Badge n={sectionCount(section)} /></div>}
            {section.items.map((item) =>
              item.children ? (
                <NavGroup
                  key={item.path}
                  item={item}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                  onExpandSidebar={onExpandSidebar}
                  badge={badge}
                />
              ) : (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/'}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                  onClick={onNavigate}
                >
                  <Icon name={item.icon} />
                  {!collapsed && <span>{item.label}</span>}
                  {!collapsed && <Badge n={badge(item.path)} />}
                </NavLink>
              )
            )}
          </div>
        ))}
      </nav>

      <button className="collapse-btn" onClick={onToggleCollapse} aria-label="Collapse sidebar">
        <span style={{ display: 'inline-flex', transform: collapsed ? 'rotate(180deg)' : 'none' }}>
          <Icon name="chevron" />
        </span>
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  );
}
