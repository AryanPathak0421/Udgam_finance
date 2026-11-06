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

  useEffect(() => {
    loadProfile();
  }, []);

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
