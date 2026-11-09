import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMemberApp } from '../MemberAppContext.jsx';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function MemberProfile() {
  const { memUser, logout } = useMemberApp();
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

    window.addEventListener('pwa-prompt-available', onPromptAvailable);
    if (window.__pwaInstallPrompt) {
      setDeferredPrompt(window.__pwaInstallPrompt);
    }

    return () => {
      window.removeEventListener('pwa-prompt-available', onPromptAvailable);
    };
  }, []);

  async function loadProfile() {
    setLoading(true);
    setError('');
    try {
      const res = await api.memberApp.profile();
      setProfile(res.profile);
    } catch (err) {
      setError(err.message || 'Failed to load member profile');
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    if (window.confirm('Are you sure you want to log out from Udgam Member App?')) {
      logout();
      navigate('/member/login', { replace: true });
    }
  }

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

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--mem-text-muted)' }}>
        <Icon name="loader" size={26} className="spin" />
        <p style={{ marginTop: 8, fontSize: '0.85rem' }}>Loading profile…</p>
      </div>
    );
  }

  const p = profile || memUser || {};

  return (
    <div>
      {/* Header Profile Card */}
      <div
        className="mem-card"
        style={{
          background: 'linear-gradient(135deg, #059669, #065f46)',
          color: '#ffffff',
          borderRadius: 18,
          padding: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <div
          style={{
            width: 58,
            height: 58,
            borderRadius: 29,
            background: 'rgba(255, 255, 255, 0.2)',
            border: '2px solid rgba(255, 255, 255, 0.4)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.4rem',
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {p.name ? p.name.charAt(0).toUpperCase() : 'M'}
        </div>

        <div>
          <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{p.name}</div>
          <div style={{ fontSize: '0.8rem', opacity: 0.9, marginTop: 2 }}>
            Member Code: <strong>{p.code}</strong>
          </div>
          <div style={{ fontSize: '0.74rem', opacity: 0.85, marginTop: 2 }}>
            {p.branch?.name ? `${p.branch.name} Branch` : 'Udgam Finance'}
          </div>
        </div>
      </div>

      {/* Personal Details */}
      <div className="mem-card">
        <div className="mem-card-title">Personal &amp; Contact Information</div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Mobile Number</span>
          <span className="mem-stat-val">{p.mobile || '—'}</span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Husband / Father</span>
          <span className="mem-stat-val">{p.husbandName || '—'}</span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Occupation</span>
          <span className="mem-stat-val">{p.occupation || '—'}</span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Village / Address</span>
          <span className="mem-stat-val">{p.address || '—'}</span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">District, State</span>
          <span className="mem-stat-val">{p.district ? `${p.district}, ${p.state}` : '—'} ({p.pincode || ''})</span>
        </div>
      </div>

      {/* Banking & Identity */}
      <div className="mem-card">
        <div className="mem-card-title">Bank &amp; KYC Verification</div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Bank Name</span>
          <span className="mem-stat-val">{p.bankName || '—'}</span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Account Number</span>
          <span className="mem-stat-val">{p.accountNumberMasked || '••••••••'}</span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">IFSC Code</span>
          <span className="mem-stat-val">{p.ifsc || '—'}</span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Aadhaar Card</span>
          <span className="mem-stat-val">{p.aadhaarMasked || '••••••••'}</span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">PAN Card</span>
          <span className="mem-stat-val">{p.panMasked || '—'}</span>
        </div>
      </div>

      {/* Guarantor Info */}
      {p.guarantor && (
        <div className="mem-card">
          <div className="mem-card-title">Nominee &amp; Guarantor</div>
          <div className="mem-stat-row">
            <span className="mem-stat-label">Guarantor Name</span>
            <span className="mem-stat-val">{p.guarantor.name}</span>
          </div>
          <div className="mem-stat-row">
            <span className="mem-stat-label">Relationship</span>
            <span className="mem-stat-val">{p.guarantor.relation || 'Family / Relative'}</span>
          </div>
          <div className="mem-stat-row">
            <span className="mem-stat-label">Guarantor Mobile</span>
            <span className="mem-stat-val">{p.guarantor.mobile || '—'}</span>
          </div>
        </div>
      )}

      {/* App & PWA Info */}
      <div className="mem-card">
        <div className="mem-card-title">
          <span>Udgam Member App (PWA)</span>
          <span className="mem-badge active">v1.0 Customer</span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Platform</span>
          <span className="mem-stat-val">Progressive Web App</span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Display Mode</span>
          <span className="mem-stat-val" style={{ color: isStandalone ? 'var(--mem-success)' : 'inherit' }}>
            {isStandalone ? '✓ Installed Standalone App' : 'Web Browser (Installable)'}
          </span>
        </div>

        {!isStandalone && (
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="mem-btn"
              onClick={handleInstallApp}
              style={{ background: 'linear-gradient(135deg, #059669, #047857)' }}
            >
              <Icon name="download" size={16} />
              <span>Install Member App on this Phone</span>
            </button>
            <div style={{ fontSize: '0.72rem', color: 'var(--mem-text-muted)', textAlign: 'center', marginTop: 6 }}>
              Instant home screen icon for checking loans anytime
            </div>
          </div>
        )}
      </div>

      {/* Logout button */}
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          className="mem-btn"
          style={{ background: 'var(--mem-danger)', borderColor: 'var(--mem-danger)' }}
          onClick={handleLogout}
        >
          <Icon name="logout" size={16} />
          <span>Logout from Member App</span>
        </button>
      </div>

      {/* Guide modal */}
      {showGuide && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setShowGuide(false)}
        >
          <div
            style={{
              background: '#ffffff',
              color: '#0f172a',
              borderRadius: 16,
              padding: 20,
              maxWidth: 400,
              width: '100%',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <strong style={{ fontSize: '1rem', display: 'block', marginBottom: 8 }}>
              Install Member App
            </strong>
            <p style={{ fontSize: '0.84rem', color: '#64748b', lineHeight: 1.5 }}>
              Android Chrome me upar <strong>3 dots (⋮)</strong> tap karke <strong>"Install app"</strong> ya <strong>"Add to Home screen"</strong> chunein.
            </p>
            <div style={{ textAlign: 'right', marginTop: 12 }}>
              <button
                type="button"
                className="mem-btn sm"
                style={{ width: 'auto' }}
                onClick={() => setShowGuide(false)}
              >
                Theek Hai
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
