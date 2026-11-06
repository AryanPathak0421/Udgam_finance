import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSupApp } from '../SupervisorAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorHeader() {
  const {
    supUser,
    logout,
    lang,
    toggleLang,
    theme,
    toggleTheme,
    notifications,
    dismissNotification,
    dismissAllNotifications,
    notifOpen,
    setNotifOpen,
    t,
  } = useSupApp();
  const navigate = useNavigate();

  const unreadCount = notifications.length;

  const handleNotificationClick = (n) => {
    // Dismiss the notification ("dekhne ke baad jayega")
    dismissNotification(n.id);
    setNotifOpen(false);
    if (n.link) {
      navigate(n.link);
    }
  };

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

        {/* Notifications (Sheet Point 2: "Notification aayega dekhne ke baad jayega") */}
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
                top: '115%',
                right: 0,
                width: 300,
                maxHeight: 380,
                overflowY: 'auto',
                background: 'var(--sup-card-bg)',
                border: '1px solid var(--sup-border)',
                borderRadius: 12,
                boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                padding: 12,
                zIndex: 100,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--sup-border)' }}>
                <strong style={{ fontSize: '0.88rem' }}>Live Alerts ({unreadCount})</strong>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', fontSize: '0.72rem', color: 'var(--sup-primary)', cursor: 'pointer', fontWeight: 600 }}
                    onClick={dismissAllNotifications}
                  >
                    Clear All
                  </button>
                )}
              </div>

              {notifications.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px 0', fontSize: '0.78rem', color: 'var(--sup-text-muted)' }}>
                  No pending alerts or notifications
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => handleNotificationClick(n)}
                    style={{
                      padding: '8px 6px',
                      borderBottom: '1px solid var(--sup-border)',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      borderRadius: 6,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sup-bg)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <strong style={{ fontSize: '0.82rem', color: 'var(--sup-text)' }}>{n.title}</strong>
                      <span style={{ fontSize: '0.68rem', color: 'var(--sup-text-muted)' }}>{n.time}</span>
                    </div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--sup-text-muted)', marginTop: 2 }}>
                      {n.message}
                    </div>
                  </div>
                ))
              )}
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
