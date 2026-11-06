import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSupApp } from '../SupervisorAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorHeader() {
  const { supUser, logout, lang, toggleLang, theme, toggleTheme, notifications, notifOpen, setNotifOpen, t } = useSupApp();
  const navigate = useNavigate();

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <header className="sup-header">
      <div className="sup-header-brand">
        <Link to="/supervisor" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <img src="/logo.png" alt="Udgam" className="sup-header-logo" />
          <div>
            <div className="sup-header-title">{t('app_title')}</div>
            <span className="sup-header-role-badge">
              <Icon name="shield" size={10} />
              <span>Supervisor</span>
            </span>
          </div>
        </Link>
      </div>

      <div className="sup-header-actions">
        {/* Language switch */}
        <button
          type="button"
          className="sup-btn secondary sm"
          style={{ padding: '4px 8px', fontSize: '0.75rem', gap: 4, width: 'auto' }}
          onClick={toggleLang}
          title="Switch Language"
        >
          <Icon name="globe" size={13} />
          <span>{lang === 'hi' ? 'English' : 'हिंदी'}</span>
        </button>

        {/* Theme toggle */}
        <button
          type="button"
          className="sup-icon-btn"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          aria-label="Toggle Theme"
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
        </button>

        {/* Notifications */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="sup-icon-btn"
            onClick={() => setNotifOpen(!notifOpen)}
            aria-label="Notifications"
          >
            <Icon name="bell" size={15} />
            {unreadCount > 0 && <span className="sup-notif-badge">{unreadCount}</span>}
          </button>

          {notifOpen && (
            <div
              style={{
                position: 'absolute',
                top: '110%',
                right: 0,
                width: 280,
                background: 'var(--sup-card-bg)',
                border: '1px solid var(--sup-border)',
                borderRadius: 12,
                boxShadow: 'var(--sup-shadow)',
                padding: 12,
                zIndex: 60,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong style={{ fontSize: '0.85rem' }}>Notifications</strong>
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', fontSize: '0.75rem', color: 'var(--sup-primary)', cursor: 'pointer' }}
                  onClick={() => setNotifOpen(false)}
                >
                  Close
                </button>
              </div>
              {notifications.map((n) => (
                <div key={n.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--sup-border)', fontSize: '0.8rem' }}>
                  <div style={{ fontWeight: 600 }}>{n.title}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--sup-text-muted)' }}>{n.time}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Profile Link */}
        <Link to="/supervisor/profile" className="sup-icon-btn" title="Supervisor Profile" aria-label="Profile">
          {supUser?.photo ? (
            <img src={supUser.photo} alt={supUser.name} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            <Icon name="user" size={16} />
          )}
        </Link>
      </div>
    </header>
  );
}
