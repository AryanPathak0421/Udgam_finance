import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { ROLE_LABELS } from '../config/nav.js';

export default function Header({ title, parent, onMenu }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="header">
      <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Open menu">
        <Icon name="menu" />
      </button>
      <h1 className="header-title">
        {parent && <span className="crumb">{parent} /</span>} {title}
      </h1>

      <div className="header-spacer" />

      <div className="search">
        <Icon name="search" size={16} />
        <input type="search" placeholder="Search customer, loan, mobile…" aria-label="Search" />
      </div>

      <button className="icon-btn" aria-label="Notifications">
        <Icon name="bell" />
      </button>

      <div className="user-menu" ref={ref}>
        <button className="user-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="avatar">{initials}</span>
          <span className="user-meta">
            <strong>{user.name}</strong>
            <small>{ROLE_LABELS[user.role] || user.role}</small>
          </span>
        </button>
        {open && (
          <div className="dropdown" role="menu">
            <div className="dropdown-info">{user.email}</div>
            <button role="menuitem" onClick={logout}>
              <Icon name="logout" size={16} /> Log out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
