import React, { useState, useEffect } from 'react';
import { api } from '../../../api/client.js';
import { useEmpApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

export default function EmployeeProfile() {
  const { t, logout } = useEmpApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Rating modal
  const [rateModal, setRateModal] = useState(false);
  const [stars, setStars] = useState(5);
  const [review, setReview] = useState('');
  const [ratingBusy, setRatingBusy] = useState(false);

  const loadProfile = () => {
    setLoading(true);
    api.employeeApp.profile()
      .then((r) => setData(r.profile))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadProfile();
  }, []);

  async function submitRating(e) {
    e.preventDefault();
    if (!data) return;
    setRatingBusy(true);
    try {
      await api.employeeApp.rateEmployee({
        targetEmployeeCode: data.employeeCode,
        stars,
        review,
      });
      alert('Rating submitted successfully!');
      setRateModal(false);
      loadProfile();
    } catch (err) {
      alert(err.message || 'Failed to submit rating');
    } finally {
      setRatingBusy(false);
    }
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}>Loading profile…</div>;
  if (error) return <div style={{ padding: 20, color: 'var(--emp-danger)' }}>{error}</div>;

  return (
    <div>
      {/* Profile Header Card */}
      <div className="emp-card" style={{ textAlign: 'center', paddingTop: 20 }}>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          {data.photo ? (
            <img
              src={data.photo}
              alt="Profile"
              style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--emp-primary)' }}
            />
          ) : (
            <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'var(--emp-primary-light)', color: 'var(--emp-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
              <Icon name="user" size={36} />
            </div>
          )}
          <span className={`emp-badge ${data.status === 'Active' ? 'green' : 'red'}`} style={{ position: 'absolute', bottom: -6, right: -4 }}>
            {data.status}
          </span>
        </div>

        <h3 style={{ margin: '10px 0 2px', fontSize: '1.25rem', fontWeight: 800 }}>{data.name}</h3>
        <div style={{ color: 'var(--emp-primary)', fontWeight: 600, fontSize: '0.88rem' }}>{data.designation}</div>
        <div style={{ color: 'var(--emp-text-muted)', fontSize: '0.8rem' }}>{data.employeeCode} · {data.department}</div>

        {/* Staff Rating display */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8 }}>
          <span style={{ color: '#eab308' }}><Icon name="rank" size={16} /></span>
          <strong style={{ fontSize: '1rem' }}>{data.averageRating || 5.0}</strong>
          <span style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)' }}>({data.ratings?.length || 0} reviews)</span>
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button className="emp-btn sm secondary" onClick={() => setRateModal(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="rank" size={14} />
            <span>Rate Staff</span>
          </button>
          <button className="emp-btn sm secondary" onClick={logout} style={{ color: 'var(--emp-danger)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="logout" size={14} />
            <span>{t('logout')}</span>
          </button>
        </div>
      </div>

      {/* Profile Details List */}
      <div className="emp-card">
        <div className="emp-card-title">Employee Details</div>

        <div className="emp-stat-row">
          <span className="emp-stat-label">Phone Number</span>
          <span className="emp-stat-value">{data.mobile || '—'}</span>
        </div>

        <div className="emp-stat-row">
          <span className="emp-stat-label">Email</span>
          <span className="emp-stat-value">{data.email || '—'}</span>
        </div>

        <div className="emp-stat-row">
          <span className="emp-stat-label">Address</span>
          <span className="emp-stat-value">{data.address || '—'}</span>
        </div>

        <div className="emp-stat-row">
          <span className="emp-stat-label">DOB / Age</span>
          <span className="emp-stat-value">{data.dob || '—'}</span>
        </div>

        <div className="emp-stat-row">
          <span className="emp-stat-label">Original Marksheet Submitted</span>
          <span className="emp-stat-value">
            {data.originalMarksheet ? (
              <span className="emp-badge green">
                Yes {[...data.marksheetTypes, data.marksheetOther].filter(Boolean).join(', ')}
              </span>
            ) : (
              'No'
            )}
          </span>
        </div>

        <div className="emp-stat-row">
          <span className="emp-stat-label">Date of Joining</span>
          <span className="emp-stat-value">{data.joiningDate || '—'}</span>
        </div>

        <div className="emp-stat-row">
          <span className="emp-stat-label">Branch</span>
          <span className="emp-stat-value">{data.branch} {data.branchPincode ? `(${data.branchPincode})` : ''}</span>
        </div>

        <div className="emp-stat-row">
          <span className="emp-stat-label">{t('security_amount')}</span>
          <span className="emp-stat-value" style={{ color: 'var(--emp-primary)' }}>
            ₹{data.securityAmount?.toLocaleString('en-IN') || 0}
          </span>
        </div>

        <div className="emp-stat-row">
          <span className="emp-stat-label">Supervisor</span>
          <span className="emp-stat-value">
            {data.supervisor ? `${data.supervisor.name} (${data.supervisor.code})` : '—'}
          </span>
        </div>
      </div>

      {/* Security Passbook / Deductions */}
      {data.passbook && data.passbook.length > 0 && (
        <div className="emp-card">
          <div className="emp-card-title">Security Passbook</div>
          {data.passbook.map((p, idx) => (
            <div key={idx} className="emp-stat-row">
              <span className="emp-stat-label">{p.date?.slice(0, 10)} {p.remark || 'Deduction'}</span>
              <span className="emp-stat-value" style={{ color: p.type === 'refund' ? 'var(--emp-danger)' : 'var(--emp-success)' }}>
                {p.type === 'refund' ? '−' : '+'}₹{((p.amountPaise || 0) / 100).toLocaleString('en-IN')}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* App & Device Info Card */}
      <div className="emp-card">
        <div className="emp-card-title">Udgam Staff App (PWA)</div>
        <div className="emp-stat-row">
          <span className="emp-stat-label">App Platform</span>
          <span className="emp-stat-value">Progressive Web App</span>
        </div>
        <div className="emp-stat-row">
          <span className="emp-stat-label">Offline Support</span>
          <span className="emp-stat-value" style={{ color: '#059669', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="checkcircle" size={13} /> Active
          </span>
        </div>
        <div className="emp-stat-row">
          <span className="emp-stat-label">Display Mode</span>
          <span className="emp-stat-value">
            {typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone)
              ? 'Installed Standalone App'
              : 'Web Browser (Installable)'}
          </span>
        </div>
      </div>

      {/* Supervisor Rating Modal */}
      {rateModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--emp-card-bg)', width: '100%', maxWidth: 360, borderRadius: 16, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ fontSize: '1.05rem' }}>Rate Staff Performance</strong>
              <button className="emp-icon-btn" onClick={() => setRateModal(false)}>✕</button>
            </div>
            <form onSubmit={submitRating}>
              <div className="emp-input-group">
                <label className="emp-label">Rating (1 to 5 Stars)</label>
                <div style={{ display: 'flex', gap: 8, fontSize: '1.8rem', cursor: 'pointer', margin: '4px 0 10px' }}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <span
                      key={star}
                      onClick={() => setStars(star)}
                      style={{ color: star <= stars ? '#eab308' : '#cbd5e1' }}
                    >
                      ★
                    </span>
                  ))}
                </div>
              </div>
              <div className="emp-input-group">
                <label className="emp-label">Feedback / Remarks</label>
                <textarea
                  className="emp-textarea"
                  rows={3}
                  value={review}
                  onChange={(e) => setReview(e.target.value)}
                  placeholder="Field collection quality, member relations, punctuality…"
                />
              </div>
              <button type="submit" className="emp-btn" disabled={ratingBusy}>
                {ratingBusy ? 'Submitting…' : 'Submit Rating'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

