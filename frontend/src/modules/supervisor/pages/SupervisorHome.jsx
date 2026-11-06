import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSupApp } from '../SupervisorAppContext.jsx';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorHome() {
  const { supUser, t } = useSupApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('staff'); // 'staff' | 'branch'

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    setLoading(true);
    setError('');
    try {
      const res = await api.supervisorApp.dashboard();
      setData(res);
    } catch (err) {
      setError(err.message || 'Failed to load supervisor dashboard');
    } finally {
      setLoading(false);
    }
  }

  const metrics = data?.metrics || {
    totalDueToday: 0,
    totalDueCount: 0,
    totalCollectedToday: 0,
    totalCollectedCount: 0,
    totalStaffCount: 0,
    totalBranchCount: 0,
    npaCount: 0,
    npaTotalAmount: 0,
    newMembersCount: 0,
  };

  return (
    <div className="sup-page-container">
      {/* Hero Workspace Banner */}
      <div className="sup-hero-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: 1, opacity: 0.85, fontWeight: 700 }}>
              SUPERVISOR OPERATIONAL WORKSPACE
            </div>
            <h1 style={{ margin: '4px 0', fontSize: '1.4rem', fontWeight: 800 }}>
              {supUser?.name || 'Supervisor'}
            </h1>
            <div style={{ fontSize: '0.82rem', opacity: 0.9 }}>
              Staff ID: <strong>{supUser?.employeeCode || 'SUP001'}</strong> • {supUser?.branch?.name || 'Main Branch'}
            </div>
          </div>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.15)',
              border: '2px solid rgba(255, 255, 255, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="shield" size={24} color="#ffffff" />
          </div>
        </div>

        <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ background: 'rgba(255, 255, 255, 0.2)', padding: '3px 9px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 }}>
            {metrics.totalStaffCount} Supervised Staff
          </span>
          <span style={{ background: 'rgba(255, 255, 255, 0.2)', padding: '3px 9px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 }}>
            {metrics.totalBranchCount} Branches
          </span>
        </div>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--sup-danger-light)', color: 'var(--sup-danger)', borderRadius: 10, fontSize: '0.85rem', marginBottom: 14 }}>
          <Icon name="alertcircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Top 2 KPI Metric Cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <Link to="/supervisor/today-due" className="sup-metric-card" style={{ textDecoration: 'none', color: 'inherit', borderLeft: '4px solid var(--sup-danger)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--sup-text-muted)' }}>
              {t('today_due')}
            </span>
            <Icon name="calendar" size={18} color="var(--sup-danger)" />
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--sup-danger)', marginTop: 6 }}>
            ₹{metrics.totalDueToday.toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)', marginTop: 2 }}>
            {metrics.totalDueCount} members pending
          </div>
        </Link>

        <Link to="/supervisor/collection-paid" className="sup-metric-card" style={{ textDecoration: 'none', color: 'inherit', borderLeft: '4px solid var(--sup-success)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--sup-text-muted)' }}>
              {t('today_collected')}
            </span>
            <Icon name="checkcircle" size={18} color="var(--sup-success)" />
          </div>
          <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--sup-success)', marginTop: 6 }}>
            ₹{metrics.totalCollectedToday.toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)', marginTop: 2 }}>
            {metrics.totalCollectedCount} receipts settled
          </div>
        </Link>
      </div>

      {/* Secondary KPI Bar: NPA & New Members */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <Link to="/supervisor/npa-recovery" className="sup-metric-card" style={{ textDecoration: 'none', color: 'inherit', borderLeft: '4px solid var(--sup-accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--sup-text-muted)' }}>NPA Recovery</span>
            <Icon name="alerttriangle" size={16} color="var(--sup-accent)" />
          </div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--sup-accent)', marginTop: 4 }}>
            ₹{metrics.npaTotalAmount.toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>{metrics.npaCount} overdue loans</div>
        </Link>

        <Link to="/supervisor/new-member-report" className="sup-metric-card" style={{ textDecoration: 'none', color: 'inherit', borderLeft: '4px solid var(--sup-primary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--sup-text-muted)' }}>New Members</span>
            <Icon name="users" size={16} color="var(--sup-primary)" />
          </div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--sup-primary)', marginTop: 4 }}>
            {metrics.newMembersCount}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>This month</div>
        </Link>
      </div>

      {/* Staff-wise & Branch-wise Overview Section */}
      <div className="sup-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong style={{ fontSize: '0.95rem' }}>Collection Performance</strong>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              className={`sup-btn sm ${activeTab === 'staff' ? '' : 'secondary'}`}
              style={{ width: 'auto', padding: '4px 10px' }}
              onClick={() => setActiveTab('staff')}
            >
              Staff-wise
            </button>
            <button
              type="button"
              className={`sup-btn sm ${activeTab === 'branch' ? '' : 'secondary'}`}
              style={{ width: 'auto', padding: '4px 10px' }}
              onClick={() => setActiveTab('branch')}
            >
              Branch-wise
            </button>
          </div>
        </div>

        {activeTab === 'staff' ? (
          <div>
            {(data?.staffWiseDues || []).length === 0 ? (
              <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--sup-text-muted)', fontSize: '0.85rem' }}>
                No active staff assignments found
              </div>
            ) : (
              (data?.staffWiseDues || []).map((s) => (
                <div
                  key={s.staffCode}
                  style={{
                    padding: '10px 0',
                    borderBottom: '1px solid var(--sup-border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <strong style={{ fontSize: '0.9rem', color: 'var(--sup-text)' }}>{s.staffName}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>
                      {s.staffCode} • {s.branchName}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--sup-success)' }}>
                      ₹{(s.collectedAmount || 0).toLocaleString('en-IN')}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--sup-danger)' }}>
                      Due: ₹{(s.dueAmount || 0).toLocaleString('en-IN')}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div>
            {(data?.branchWiseDues || []).length === 0 ? (
              <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--sup-text-muted)', fontSize: '0.85rem' }}>
                No supervised branches found
              </div>
            ) : (
              (data?.branchWiseDues || []).map((b) => (
                <div
                  key={b.branchId}
                  style={{
                    padding: '10px 0',
                    borderBottom: '1px solid var(--sup-border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <strong style={{ fontSize: '0.9rem', color: 'var(--sup-text)' }}>{b.branchName}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>Code: {b.branchCode}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--sup-success)' }}>
                      ₹{(b.collectedAmount || 0).toLocaleString('en-IN')}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--sup-danger)' }}>
                      Due: ₹{(b.dueAmount || 0).toLocaleString('en-IN')}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Quick Action Grid (User's Exact Handwritten List) */}
      <div style={{ marginBottom: 12, fontWeight: 700, fontSize: '0.92rem', color: 'var(--sup-text-muted)' }}>
        SUPERVISOR OPERATIONS & SERVICES
      </div>

      <div className="sup-grid-3" style={{ marginBottom: 16 }}>
        <Link to="/supervisor/today-due" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#fef2f2', color: '#b91c1c' }}>
            <Icon name="calendar" size={22} />
          </div>
          <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>Today Due</span>
        </Link>

        <Link to="/supervisor/collection-paid" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#f0fdf4', color: '#15803d' }}>
            <Icon name="checkcircle" size={22} />
          </div>
          <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>Collection Paid</span>
        </Link>

        <Link to="/supervisor/new-member" className="sup-action-card">
          <div className="sup-action-icon">
            <Icon name="userplus" size={22} />
          </div>
          <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>New Member</span>
        </Link>

        <Link to="/supervisor/new-member-report" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#eff6ff', color: '#2563eb' }}>
            <Icon name="users" size={22} />
          </div>
          <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>Member Report</span>
        </Link>

        <Link to="/supervisor/emi-payment" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#ecfdf5', color: '#059669' }}>
            <Icon name="creditcard" size={22} />
          </div>
          <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>EMI Collect</span>
        </Link>

        <Link to="/supervisor/npa-recovery" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#fffbeb', color: '#b45309' }}>
            <Icon name="alerttriangle" size={22} />
          </div>
          <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>NPA Recovery</span>
        </Link>

        <Link to="/supervisor/staff-attendance" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#f5f3ff', color: '#7c3aed' }}>
            <Icon name="clock" size={22} />
          </div>
          <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>Branch Present</span>
        </Link>

        <Link to="/supervisor/center-visits" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#faf5ff', color: '#9333ea' }}>
            <Icon name="map" size={22} />
          </div>
          <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>Center Visits</span>
        </Link>

        <Link to="/supervisor/reports" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#f0fdfa', color: '#0f766e' }}>
            <Icon name="chart" size={22} />
          </div>
          <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>Reports</span>
        </Link>

        <Link to="/supervisor/calculator" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#fdf4ff', color: '#c026d3' }}>
            <Icon name="calculator" size={22} />
          </div>
          <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>Calculator</span>
        </Link>

        <Link to="/supervisor/salary-slips" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#fff7ed', color: '#ea580c' }}>
            <Icon name="filetext" size={22} />
          </div>
          <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>Salary Slips</span>
        </Link>

        <Link to="/supervisor/profile" className="sup-action-card">
          <div className="sup-action-icon">
            <Icon name="user" size={22} />
          </div>
          <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>Profile</span>
        </Link>
      </div>
    </div>
  );
}
