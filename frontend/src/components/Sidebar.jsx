import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import Icon from './Icon.jsx';
import { navForUser } from '../config/nav.js';
import { useAuth } from '../context/AuthContext.jsx';

function NavGroup({ item, collapsed, onNavigate, onExpandSidebar }) {
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

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}${mobileOpen ? ' open' : ''}`} aria-label="Main navigation">
      <div className="sidebar-brand">
        <div className="logo-mark" role="img" aria-label="Udgam Microfinance" />
        {!collapsed && <span>Udgam Microfinance</span>}
      </div>

      <nav>
        {sections.map((section) => (
          <div key={section.title} className="nav-section">
            {!collapsed && <div className="nav-title">{section.title}</div>}
            {section.items.map((item) =>
              item.children ? (
                <NavGroup
                  key={item.path}
                  item={item}
                  collapsed={collapsed}
                  onNavigate={onNavigate}
                  onExpandSidebar={onExpandSidebar}
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
