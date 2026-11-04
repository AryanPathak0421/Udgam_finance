import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useEmpApp } from '../EmployeeAppContext.jsx';

export default function EmployeeHeader({ title }) {
  const { lang, toggleLang, theme, toggleTheme, t, notifications, notifOpen, setNotifOpen, empUser } = useEmpApp();
  const navigate = useNavigate();
  const location = useLocation();
  const isRoot = location.pathname === '/employee' || location.pathname === '/employee/';
  const unreadCount = notifications.filter((n) => !n.read).length;
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  const handleSearch = (e) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/employee/synopsis?q=${encodeURIComponent(query.trim())}`);
      setSearchOpen(false);
    }
  };

  return (
    <>
      <header className="emp-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!isRoot ? (
            <button className="emp-icon-btn" onClick={() => navigate(-1)} aria-label="Back">
              ‹ Back
            </button>
          ) : (
            <div className="emp-header-brand" onClick={() => navigate('/employee')} style={{ cursor: 'pointer' }}>
              <span>🪙</span>
              <span>{t('app_title')}</span>
            </div>
          )}
        </div>

        <div className="emp-header-actions">
          <button className="emp-icon-btn" onClick={() => setSearchOpen((s) => !s)} title="Search borrower">
            🔍
          </button>
          <button className="emp-icon-btn" onClick={toggleLang} title="Switch language">
            🌐 {t('switch_lang')}
          </button>
          <button className="emp-icon-btn" onClick={toggleTheme} title="Switch theme">
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button className="emp-icon-btn" style={{ position: 'relative' }} onClick={() => setNotifOpen((o) => !o)} title="Notifications">
            🔔
            {unreadCount > 0 && (
              <span style={{ position: 'absolute', top: -4, right: -4, background: '#ef4444', color: '#fff', borderRadius: '50%', width: 16, height: 16, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {unreadCount}
              </span>
            )}
          </button>
          {empUser && (
            <button
              className="emp-icon-btn"
              onClick={() => navigate('/employee/profile')}
              style={{ padding: 4, borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              title="Profile"
            >
              {empUser.photo ? (
                <img src={empUser.photo} alt="avatar" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
              ) : (
                '👤'
              )}
            </button>
          )}
        </div>
      </header>

      {/* Expandable search bar */}
      {searchOpen && (
        <form onSubmit={handleSearch} style={{ padding: '8px 16px', background: 'var(--emp-header-bg)', borderBottom: '1px solid var(--emp-border)', display: 'flex', gap: 6 }}>
          <input
            type="search"
            className="emp-input"
            autoFocus
            placeholder={t('search_placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className="emp-btn sm" style={{ width: 'auto' }}>
            Go
          </button>
        </form>
      )}

      {/* Notifications Drawer Modal */}
      {notifOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'flex-end' }} onClick={() => setNotifOpen(false)}>
          <div
            style={{ width: '85%', maxWidth: 360, background: 'var(--emp-card-bg)', height: '100%', padding: 20, boxSizing: 'border-box', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid var(--emp-border)', paddingBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>🔔 Notifications</h3>
              <button className="emp-icon-btn" onClick={() => setNotifOpen(false)}>✕</button>
            </div>
            {notifications.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--emp-text-muted)', marginTop: 40 }}>No new notifications</div>
            ) : (
              notifications.map((n) => (
                <div key={n.id} style={{ padding: '12px 10px', borderBottom: '1px solid var(--emp-border)', fontSize: '0.9rem' }}>
                  <div style={{ fontWeight: 600 }}>{n.title}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 4 }}>{n.time}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}

