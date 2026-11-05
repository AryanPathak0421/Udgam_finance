import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useEmpApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

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
            <button
              className="emp-icon-btn"
              onClick={() => navigate(-1)}
              aria-label="Back"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}
            >
              <Icon name="arrowleft" size={15} />
              <span style={{ fontSize: '0.85rem' }}>Back</span>
            </button>
          ) : (
            <div className="emp-header-brand" onClick={() => navigate('/employee')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <img src="/logo.png" alt="Udgam" style={{ height: 24, borderRadius: 4 }} />
              <span style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--emp-primary)' }}>{t('app_title')}</span>
            </div>
          )}
        </div>

        <div className="emp-header-actions">
          <button className="emp-icon-btn" onClick={() => setSearchOpen((s) => !s)} title="Search borrower">
            <Icon name="search" size={16} />
          </button>
          <button className="emp-icon-btn" onClick={toggleLang} title="Switch language" style={{ gap: 4 }}>
            <Icon name="globe" size={15} />
            <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>{t('switch_lang')}</span>
          </button>
          <button className="emp-icon-btn" onClick={toggleTheme} title="Switch theme">
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
          </button>
          <button className="emp-icon-btn" style={{ position: 'relative' }} onClick={() => setNotifOpen((o) => !o)} title="Notifications">
            <Icon name="bell" size={16} />
            {unreadCount > 0 && (
              <span style={{ position: 'absolute', top: -4, right: -4, background: 'var(--emp-danger)', color: '#fff', borderRadius: '50%', width: 16, height: 16, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
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
                <Icon name="user" size={16} />
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
            Search
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="bell" size={18} />
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>Notifications</h3>
              </div>
              <button className="emp-icon-btn" onClick={() => setNotifOpen(false)}>
                <Icon name="cross" size={16} />
              </button>
            </div>
            {notifications.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--emp-text-muted)', marginTop: 40, fontSize: '0.9rem' }}>
                No new notifications
              </div>
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
