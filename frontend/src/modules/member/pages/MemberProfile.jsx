import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMemberApp } from '../MemberAppContext.jsx';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function MemberProfile() {
  const { memUser, logout } = useMemberApp();
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deferredPrompt, setDeferredPrompt] = useState(() => window.__pwaInstallPrompt || null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    loadProfileAndSummary();

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

  async function loadProfileAndSummary() {
    setLoading(true);
    setError('');
    try {
      const [pRes, dRes] = await Promise.all([
        api.memberApp.profile(),
        api.memberApp.dashboard().catch(() => null),
      ]);
      setProfile(pRes.profile);
      setDashboardData(dRes);
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
  const graph = dashboardData?.graph || {};
  const summary = dashboardData?.summary || {};

  const totalBorrowed = (graph.totalBorrowedPaise || 0) / 100;
  const totalPaid = (graph.totalPaidPaise || 0) / 100;
  const remaining = (graph.remainingPrincipalPaise || 0) / 100;
  const securityBalance = (summary.totalSecurityBalancePaise || 0) / 100;
  const securityInterest = (summary.securityInterestPaise || 0) / 100;
  const repaidPct = totalBorrowed > 0 ? Math.min(100, Math.round((totalPaid / totalBorrowed) * 100)) : 0;
  const remainingPct = 100 - repaidPct;

  return (
    <div>
      {/* Header Profile Card - matches home design as per note */}
      <div
        style={{
          background: 'linear-gradient(135deg, #059669, #065f46)',
          color: '#ffffff',
          borderRadius: 18,
          padding: '18px 20px',
          marginBottom: 14,
          boxShadow: '0 8px 24px rgba(5, 150, 105, 0.25)',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <div
          style={{
            width: 54,
            height: 54,
            borderRadius: 27,
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
            Member ID: <strong>{p.code}</strong>
          </div>
          <div style={{ fontSize: '0.74rem', opacity: 0.85, marginTop: 2 }}>
            {p.branch?.name ? `${p.branch.name} Branch` : 'Udgam Finance'}
          </div>
        </div>
      </div>

      {/* Financial Health Graph */}
      <div className="mem-card" style={{ marginBottom: 14 }}>
        <div className="mem-card-title">
          <span>Financial Distribution Graph</span>
          <span style={{ fontSize: '0.74rem', color: 'var(--mem-text-muted)' }}>{repaidPct}% Cleared</span>
        </div>

        {/* Stacked Bar */}
        <div className="mem-stacked-bar">
          <div
            className="mem-bar-segment"
            style={{ width: `${repaidPct}%`, backgroundColor: 'var(--mem-primary)' }}
          />
          <div
            className="mem-bar-segment"
            style={{ width: `${remainingPct}%`, backgroundColor: '#cbd5e1' }}
          />
        </div>

        {/* Legend */}
        <div className="mem-legend-row">
          <div className="mem-legend-item">
            <span className="mem-legend-dot" style={{ backgroundColor: 'var(--mem-primary)' }} />
            <span>Repaid: ₹{totalPaid.toLocaleString('en-IN')}</span>
          </div>
          <div className="mem-legend-item">
            <span className="mem-legend-dot" style={{ backgroundColor: '#94a3b8' }} />
            <span>Remaining: ₹{remaining.toLocaleString('en-IN')}</span>
          </div>
        </div>
      </div>

      {/* Saving & Security Amount Card */}
      <div
        className="mem-card"
        style={{
          background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
          borderColor: '#bbf7d0',
          borderLeft: '5px solid #10b981',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="shield" size={18} style={{ color: '#059669' }} />
            <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#065f46', textTransform: 'uppercase' }}>
              Saving & Security Deposit
            </span>
          </div>
          <span style={{ fontSize: '0.72rem', background: '#059669', color: '#ffffff', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
            10% Interest
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 8 }}>
          <div>
            <div style={{ fontSize: '1.45rem', fontWeight: 900, color: '#064e3b' }}>
              ₹{securityBalance.toLocaleString('en-IN')}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#047857' }}>
              Includes ₹{securityInterest.toLocaleString('en-IN')} simple annual interest
            </div>
          </div>
          <Link to="/member/security" className="mem-btn sm" style={{ width: 'auto', background: '#059669', borderColor: '#059669', color: '#ffffff' }}>
            Withdrawal Request &rarr;
          </Link>
        </div>
      </div>

      {/* Profile Navigation Links */}
      <div className="mem-card" style={{ padding: 6, marginBottom: 14 }}>
        <Link
          to="/member/synopsis"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 10px',
            borderBottom: '1px solid var(--mem-border)',
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#ecfdf5', color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="creditcard" size={16} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.86rem' }}>Member Credit Synopsis</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--mem-text-muted)' }}>Credit rating, on-time percentage & loan history</div>
            </div>
          </div>
          <Icon name="chevronright" size={16} style={{ color: 'var(--mem-text-muted)' }} />
        </Link>

        <Link
          to="/member/kyc"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 10px',
            borderBottom: '1px solid var(--mem-border)',
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="user" size={16} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.86rem' }}>KYC Report & Documents</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--mem-text-muted)' }}>Pending, Approved or Rejected verification status</div>
            </div>
          </div>
          <Icon name="chevronright" size={16} style={{ color: 'var(--mem-text-muted)' }} />
        </Link>

        <Link
          to="/member/complaints"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 10px',
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#fee2e2', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="alert" size={16} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.86rem' }}>Grievance & Complaints</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--mem-text-muted)' }}>Raise an issue or track resolution status</div>
            </div>
          </div>
          <Icon name="chevronright" size={16} style={{ color: 'var(--mem-text-muted)' }} />
        </Link>
      </div>

      {/* Personal Details */}
      <div className="mem-card">
        <div className="mem-card-title">Personal &amp; Contact Details</div>
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
          <span className="mem-stat-label">Address</span>
          <span className="mem-stat-val">{p.address || '—'}</span>
        </div>
      </div>

      {/* Banking & Identity */}
      <div className="mem-card">
        <div className="mem-card-title">Bank Account Details</div>
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
      </div>

      {/* PWA Info */}
      <div className="mem-card">
        <div className="mem-card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src="/icon-member-192.png" alt="Member" style={{ width: 24, height: 24, borderRadius: 6 }} />
            <span>Udgam Member App (Alag Customer App)</span>
          </div>
          <span className="mem-badge active">Dedicated App</span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Platform</span>
          <span className="mem-stat-val"><strong>Progressive Web App (PWA)</strong></span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Offline &amp; Precache</span>
          <span className="mem-stat-val" style={{ color: '#059669', display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>
            <Icon name="checkcircle" size={13} /> Active
          </span>
        </div>
        <div className="mem-stat-row">
          <span className="mem-stat-label">Display Mode</span>
          <span className="mem-stat-val" style={{ color: isStandalone ? 'var(--mem-success)' : 'inherit', fontWeight: 700 }}>
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
