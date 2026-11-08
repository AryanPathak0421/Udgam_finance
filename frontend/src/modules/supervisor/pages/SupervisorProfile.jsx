import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSupApp } from '../SupervisorAppContext.jsx';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorProfile() {
  const { supUser, logout, t } = useSupApp();
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deferredPrompt, setDeferredPrompt] = useState(() => window.__pwaInstallPrompt || null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    loadProfile();

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    setIsStandalone(standalone);

    const onPromptAvailable = (e) => {
      setDeferredPrompt(e.detail || window.__pwaInstallPrompt);
    };

    const handler = (e) => {
      e.preventDefault();
      window.__pwaInstallPrompt = e;
      setDeferredPrompt(e);
    };

    const onInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };

    window.addEventListener('pwa-prompt-available', onPromptAvailable);
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('pwa-installed', onInstalled);
    window.addEventListener('appinstalled', onInstalled);

    if (window.__pwaInstallPrompt) {
      setDeferredPrompt(window.__pwaInstallPrompt);
    }

    return () => {
      window.removeEventListener('pwa-prompt-available', onPromptAvailable);
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('pwa-installed', onInstalled);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const handleInstallApp = async () => {
    const promptEvent = deferredPrompt || window.__pwaInstallPrompt;
    if (promptEvent) {
      try {
        promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        if (outcome === 'accepted') {
          setDeferredPrompt(null);
          window.__pwaInstallPrompt = null;
        }
      } catch (err) {
        setShowGuide(true);
      }
    } else {
      setShowGuide(true);
    }
  };

  async function loadProfile() {
    setLoading(true);
    setError('');
    try {
      const res = await api.supervisorApp.profile();
      setProfile(res.profile);
    } catch (err) {
      setError(err.message || 'Failed to load supervisor profile');
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    if (window.confirm('Are you sure you want to log out from Supervisor Portal?')) {
      logout();
      navigate('/supervisor/login', { replace: true });
    }
  }

  const p = profile || supUser || {};

  return (
    <div className="sup-page-container">
      {/* Profile Header Card */}
      <div className="sup-card" style={{ textAlign: 'center', borderTop: '4px solid var(--sup-primary)' }}>
        <div style={{ position: 'relative', display: 'inline-block', marginBottom: 10 }}>
          {p.photo ? (
            <img
              src={p.photo}
              alt={p.name}
              style={{ width: 84, height: 84, borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--sup-primary)' }}
            />
          ) : (
            <div
              style={{
                width: 84,
                height: 84,
                borderRadius: '50%',
                background: 'var(--sup-primary-light)',
                color: 'var(--sup-primary)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="shield" size={40} />
            </div>
          )}
        </div>

        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>{p.name || 'Supervisor'}</h2>
        <div style={{ fontSize: '0.82rem', color: 'var(--sup-text-muted)', marginTop: 2 }}>
          Code: <strong>{p.employeeCode}</strong> • {p.designation || 'Supervisor'}
        </div>
        <div style={{ marginTop: 6 }}>
          <span className="sup-header-role-badge">
            <Icon name="checkcircle" size={10} />
            <span>{p.status || 'Active'}</span>
          </span>
        </div>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--sup-danger-light)', color: 'var(--sup-danger)', borderRadius: 10, fontSize: '0.85rem', marginBottom: 14 }}>
          <Icon name="alertcircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Supervised Branches Card */}
      <div className="sup-card">
        <div className="sup-card-header">
          <span className="sup-card-title">
            <Icon name="building" size={16} />
            <span>Supervised Branches</span>
          </span>
          <span style={{ fontSize: '0.78rem', background: 'var(--sup-primary-light)', color: 'var(--sup-primary)', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
            {(p.supervisedBranches || []).length || 1} Branches
          </span>
        </div>

        <div style={{ fontSize: '0.85rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--sup-border)' }}>
            <span style={{ color: 'var(--sup-text-muted)' }}>Home Branch:</span>
            <strong>{typeof p.branch === 'object' ? p.branch?.name : p.branch || 'Assigned'}</strong>
          </div>

          {(p.supervisedBranches || []).map((b) => (
            <div key={b.id || b.code} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--sup-border)' }}>
              <span style={{ color: 'var(--sup-text-muted)' }}>Branch:</span>
              <span>{b.code} — {b.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Supervised Team Members Card */}
      <div className="sup-card">
        <div className="sup-card-header">
          <span className="sup-card-title">
            <Icon name="users" size={16} />
            <span>Supervised Staff Team</span>
          </span>
          <span style={{ fontSize: '0.78rem', background: 'var(--sup-primary-light)', color: 'var(--sup-primary)', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
            {p.teamCount || (p.teamStaff || []).length} Staff
          </span>
        </div>

        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
          {(p.teamStaff || []).length === 0 ? (
            <div style={{ textAlign: 'center', padding: '10px 0', color: 'var(--sup-text-muted)', fontSize: '0.85rem' }}>
              No field officers assigned under branch
            </div>
          ) : (
            (p.teamStaff || []).map((staff) => (
              <div
                key={staff._id || staff.employeeCode}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 0',
                  borderBottom: '1px solid var(--sup-border)',
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: '50%',
                    background: 'var(--sup-primary-light)',
                    color: 'var(--sup-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                  }}
                >
                  {staff.name?.slice(0, 1) || 'O'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{staff.name}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>
                    {staff.employeeCode} • {staff.designation?.name || 'Field Officer'}
                  </div>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--sup-primary)', fontWeight: 600 }}>
                  {staff.branch?.name}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Contact & Personal Details Card */}
      <div className="sup-card">
        <div className="sup-card-title" style={{ marginBottom: 10 }}>
          <Icon name="info" size={16} />
          <span>Supervisor Information</span>
        </div>

        <div style={{ fontSize: '0.85rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--sup-border)' }}>
            <span style={{ color: 'var(--sup-text-muted)' }}>Mobile Number:</span>
            <strong>{p.mobile || '—'}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--sup-border)' }}>
            <span style={{ color: 'var(--sup-text-muted)' }}>Email:</span>
            <span>{p.email || '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--sup-border)' }}>
            <span style={{ color: 'var(--sup-text-muted)' }}>Department:</span>
            <span>{p.department || 'Operations'}</span>
          </div>
          {p.joiningDate && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--sup-border)' }}>
              <span style={{ color: 'var(--sup-text-muted)' }}>Joining Date:</span>
              <span>{p.joiningDate}</span>
            </div>
          )}
        </div>
      </div>

      {/* App & Device Info Card (PWA) */}
      <div className="sup-card">
        <div className="sup-card-title" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src="/icon-supervisor-192.png" alt="Supervisor" style={{ width: 24, height: 24, borderRadius: 6 }} />
            <span>Udgam Supervisor App (Alag App)</span>
          </div>
          <span style={{ fontSize: '0.68rem', background: 'var(--sup-primary-light)', color: 'var(--sup-primary)', padding: '2px 8px', borderRadius: 8, fontWeight: 800 }}>
            Dedicated App
          </span>
        </div>

        <div style={{ fontSize: '0.85rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--sup-border)' }}>
            <span style={{ color: 'var(--sup-text-muted)' }}>Platform:</span>
            <strong>Progressive Web App (PWA)</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--sup-border)' }}>
            <span style={{ color: 'var(--sup-text-muted)' }}>Offline &amp; Precache:</span>
            <span style={{ color: '#059669', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>
              <Icon name="checkcircle" size={13} /> Active
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--sup-border)' }}>
            <span style={{ color: 'var(--sup-text-muted)' }}>Display Mode:</span>
            <span style={{ fontWeight: 700, color: isStandalone ? '#059669' : 'var(--sup-text)' }}>
              {isStandalone ? '✓ Installed Standalone App' : 'Web Browser (Installable)'}
            </span>
          </div>
        </div>

        {!isStandalone && (
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="sup-btn"
              style={{
                background: 'linear-gradient(135deg, #0f766e, #0d5f58)',
                borderColor: '#0f766e',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                fontWeight: 700,
              }}
              onClick={handleInstallApp}
            >
              <Icon name="download" size={16} />
              <span>Install Supervisor App on this Phone</span>
            </button>
            <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)', textAlign: 'center', marginTop: 6, lineHeight: 1.4 }}>
              <strong>Note:</strong> Yeh Web App (PWA) hai. Install karne par seedhe aapke phone ki home screen par app ban kar jud jati hai (kisi alag se .apk file download kiye bina).
            </div>
          </div>
        )}
      </div>

      {/* Installation Guide Modal */}
      {showGuide && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            backdropFilter: 'blur(3px)',
          }}
          onClick={() => setShowGuide(false)}
        >
          <div
            style={{
              background: '#0b131f',
              color: '#f8fafc',
              borderRadius: 16,
              padding: 20,
              maxWidth: 420,
              width: '100%',
              border: '1px solid rgba(15, 118, 110, 0.5)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: '#0f766e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="shield" size={18} />
                </div>
                <div style={{ fontWeight: 800, fontSize: '1rem' }}>Install Supervisor App</div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}
              >
                <Icon name="cross" size={18} />
              </button>
            </div>

            <div style={{ fontSize: '0.82rem', color: '#94a3b8', marginBottom: 16, lineHeight: 1.4 }}>
              PWA app phone me install karne ke aasan steps:
            </div>

            {/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream ? (
              <div style={{ background: '#131e2e', padding: 14, borderRadius: 12, border: '1px solid #1e293b' }}>
                <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#38bdf8', marginBottom: 8 }}>
                  iPhone / Safari me install kaise karein:
                </div>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: '0.82rem', lineHeight: 1.6, color: '#e2e8f0' }}>
                  <li>Neeche Safari ke <strong>Share icon</strong> (⬆️) par tap karein.</li>
                  <li>Menu me scroll karke <strong>"Add to Home Screen"</strong> (➕) chunein.</li>
                  <li>Upar right me <strong>"Add"</strong> tap karein. App screen par install ho jayegi!</li>
                </ol>
              </div>
            ) : (
              <div style={{ background: '#131e2e', padding: 14, borderRadius: 12, border: '1px solid #1e293b' }}>
                <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#10b981', marginBottom: 8 }}>
                  Android / Chrome me install kaise karein:
                </div>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: '0.82rem', lineHeight: 1.6, color: '#e2e8f0' }}>
                  <li>Chrome browser me upar right me <strong>3 dots (⋮)</strong> par tap karein.</li>
                  <li>Menu me se <strong>"Install app"</strong> ya <strong>"Add to Home screen"</strong> par tap karein.</li>
                  <li><strong>"Install"</strong> par click karein. App aapke phone ke icon list me add ho jayegi!</li>
                </ol>
              </div>
            )}

            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                style={{
                  background: '#0f766e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 18px',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Theek Hai
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logout button */}
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          className="sup-btn"
          style={{ background: 'var(--sup-danger)', borderColor: 'var(--sup-danger)' }}
          onClick={handleLogout}
        >
          <Icon name="logout" size={16} />
          <span>Logout from Supervisor App</span>
        </button>
      </div>
    </div>
  );
}

