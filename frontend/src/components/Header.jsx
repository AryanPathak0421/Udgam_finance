import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/client.js';
import { loadWorkDates } from '../utils/workDate.js';
import { ROLE_LABELS } from '../config/nav.js';

export default function Header({ title, parent, onMenu }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const bellRef = useRef(null);
  const [bell, setBell] = useState(false);
  const [work, setWork] = useState([]);
  // the date the branches of this user work on (the day after the last approved day close); the admin has none
  useEffect(() => {
    let live = true;
    const load = () => loadWorkDates(true).then((r) => { if (live) setWork(r.restricted ? r.items.filter((i) => i.workingDate) : []); });
    load();
    const t = setInterval(load, 300000);
    return () => { live = false; clearInterval(t); };
  }, []);
  const [notes, setNotes] = useState({ unread: 0, items: [] });

  // the bell: messages the admin sent (Super Admin → Bulk Notification)
  useEffect(() => {
    let live = true;
    const load = () => api.myNotifications().then((r) => { if (live) setNotes(r); }).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => { live = false; clearInterval(t); };
  }, []);
  useEffect(() => {
    const onClick = (e) => bellRef.current && !bellRef.current.contains(e.target) && setBell(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const markRead = async () => { try { await api.readNotifications(); setNotes((n) => ({ unread: 0, items: n.items.map((i) => ({ ...i, read: true })) })); } catch { /* the bell is not worth an error */ } };

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

      {work.length > 0 && (
        <span className="badge grey" title="The date your branch works on: the day after its last approved day close. Work is made on this date only.">
          Branch date: {work.map((w) => `${w.branch.code} ${new Date(`${w.workingDate}T00:00:00`).toLocaleDateString('en-IN')}`).join(' · ')}
        </span>
      )}

      <div className="search">
        <Icon name="search" size={16} />
        <input type="search" placeholder="Search customer, loan, mobile…" aria-label="Search" />
      </div>

      <div className="user-menu" ref={bellRef} style={{ position: 'relative' }}>
        <button className="icon-btn" aria-label="Notifications" aria-expanded={bell} onClick={() => setBell((o) => !o)} style={{ position: 'relative' }}>
          <Icon name="bell" />
          {notes.unread > 0 && <span style={{ position: 'absolute', top: 2, right: 2, background: '#d1495b', color: '#fff', borderRadius: 999, fontSize: 10, minWidth: 16, height: 16, lineHeight: '16px', textAlign: 'center', padding: '0 3px' }}>{notes.unread > 9 ? '9+' : notes.unread}</span>}
        </button>
        {bell && (
          <div className="dropdown" role="menu" style={{ width: 320, maxHeight: 380, overflowY: 'auto', right: 0 }}>
            <div className="dropdown-info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>Notifications</strong>
              {notes.unread > 0 && <button type="button" className="link-btn" onClick={markRead}>Mark all read</button>}
            </div>
            {notes.items.length === 0 && <div className="dropdown-info muted">No notification.</div>}
            {notes.items.map((n) => (
              <div key={n.id} className="dropdown-info" style={{ borderTop: '1px solid rgba(120,130,140,.2)', opacity: n.read ? 0.7 : 1 }}>
                <strong>{n.title}</strong>
                <div className="small">{n.message}</div>
                <div className="muted small">{new Date(n.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            ))}
          </div>
        )}
      </div>

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
