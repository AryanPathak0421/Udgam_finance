import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Header from './Header.jsx';
import { routableItems } from '../config/nav.js';

const items = routableItems();

function pageFor(pathname) {
  const match = items.find((i) => (i.path === '/' ? pathname === '/' : pathname.startsWith(i.path)));
  return match ? { title: match.label, parent: match.parent } : { title: 'Udgam Finance' };
}

function useIsMobile() {
  const query = '(max-width: 991px)';
  const [mobile, setMobile] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e) => setMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

export default function Layout() {
  const { pathname } = useLocation();
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebar-collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }, [collapsed]);

  useEffect(() => setMobileOpen(false), [pathname]);

  const { title, parent } = pageFor(pathname);
  // The mobile drawer is always full width, regardless of the desktop collapse choice.
  const sidebarCollapsed = collapsed && !isMobile;

  return (
    <div className={`app-shell${collapsed ? ' is-collapsed' : ''}`}>
      <Sidebar
        collapsed={sidebarCollapsed}
        mobileOpen={mobileOpen}
        onNavigate={() => setMobileOpen(false)}
        onToggleCollapse={() => setCollapsed((c) => !c)}
        onExpandSidebar={() => setCollapsed(false)}
      />
      {mobileOpen && <div className="scrim" onClick={() => setMobileOpen(false)} />}
      <div className="main">
        <Header title={title} parent={parent} onMenu={() => setMobileOpen(true)} />
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
