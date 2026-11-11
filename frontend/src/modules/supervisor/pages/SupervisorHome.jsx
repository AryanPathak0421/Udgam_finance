import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSupApp } from '../SupervisorAppContext.jsx';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorHome() {
  const { supUser, t = (k) => k } = useSupApp() || {};
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('staff'); // 'staff' | 'branch'
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    loadDashboard();
    loadNotifications();
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

  async function loadNotifications() {
    try {
      const res = await api.supervisorApp.notifications();
      setNotifications(res?.notifications || []);
    } catch {}
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
    pendingTasksCount: 0,
    branchVisitsCount: 0,
  };

  const branchVisits = data?.branchVisits || [];
  const pendingTasks = data?.pendingTasks || [];

  return (
    <div className="sup-page-container">
      {/* Hero Workspace Banner */}
      <div className="sup-hero-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 1, opacity: 0.85, fontWeight: 700 }}>
              SUPERVISOR OPERATIONAL WORKSPACE
            </div>
            <h1 style={{ margin: '4px 0', fontSize: '1.35rem', fontWeight: 800 }}>
              {supUser?.name || 'Supervisor'}
            </h1>
            <div style={{ fontSize: '0.8rem', opacity: 0.9 }}>
              Staff ID: <strong>{supUser?.employeeCode || 'SUP001'}</strong> • {supUser?.branch?.name || 'Main Branch'}
            </div>
          </div>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: 'rgba(255, 255, 255, 0.15)',
              border: '2px solid rgba(255, 255, 255, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="shield" size={22} color="#ffffff" />
          </div>
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link
            to="/supervisor/team-staff"
            style={{ textDecoration: 'none', color: '#fff', background: 'rgba(255, 255, 255, 0.2)', padding: '4px 10px', borderRadius: 12, fontSize: '0.74rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Icon name="users" size={12} color="#fff" />
            <span>{metrics.totalStaffCount} Attached Staff (View All Data →)</span>
          </Link>
          <span style={{ background: 'rgba(255, 255, 255, 0.2)', padding: '4px 10px', borderRadius: 12, fontSize: '0.74rem', fontWeight: 600 }}>
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

      {/* Notifications / Alerts Banner */}
      {notifications.length > 0 && (
        <div style={{ marginBottom: 14, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: '10px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#2563eb' }}>🔔</span>
              <strong style={{ fontSize: '0.85rem', color: '#1e40af' }}>Supervisor Alerts &amp; Updates ({notifications.length})</strong>
            </div>
            <span style={{ fontSize: '0.72rem', color: '#3b82f6', fontWeight: 700 }}>Live Feed</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {notifications.slice(0, 3).map((n) => (
              <Link
                key={n.id}
                to={n.link || '/supervisor'}
                style={{
                  textDecoration: 'none',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: '#fff',
                  padding: '6px 10px',
                  borderRadius: 8,
                  fontSize: '0.78rem',
                  border: '1px solid #e2e8f0',
                }}
              >
                <div>
                  <strong style={{ color: '#0f172a' }}>{n.title}: </strong>
                  <span style={{ color: '#475569' }}>{n.message}</span>
                </div>
                <span style={{ fontSize: '0.7rem', color: '#94a3b8', whiteSpace: 'nowrap', marginLeft: 8 }}>{n.time}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Top 2 KPI Metric Cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <Link to="/supervisor/today-due" className="sup-metric-card" style={{ textDecoration: 'none', color: 'inherit', borderLeft: '4px solid var(--sup-danger)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--sup-text-muted)' }}>
              {t('today_due')}
            </span>
            <Icon name="calendar" size={18} color="var(--sup-danger)" />
          </div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--sup-danger)', marginTop: 4 }}>
            ₹{metrics.totalDueToday.toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)', marginTop: 2 }}>
            {metrics.totalDueCount} members pending
          </div>
        </Link>

        <Link to="/supervisor/collection-paid" className="sup-metric-card" style={{ textDecoration: 'none', color: 'inherit', borderLeft: '4px solid var(--sup-success)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--sup-text-muted)' }}>
              {t('today_collected')}
            </span>
            <Icon name="checkcircle" size={18} color="var(--sup-success)" />
          </div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--sup-success)', marginTop: 4 }}>
            ₹{metrics.totalCollectedToday.toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)', marginTop: 2 }}>
            {metrics.totalCollectedCount} receipts settled
          </div>
        </Link>
      </div>

      {/* Secondary KPI Bar: NPA, New Members, Tasks & Branch Visits */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 }}>
        <Link to="/supervisor/tasks" className="sup-metric-card" style={{ textDecoration: 'none', color: 'inherit', borderLeft: '4px solid #e11d48' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--sup-text-muted)' }}>Pending Tasks</span>
            <span style={{ fontSize: '0.8rem' }}>📌</span>
          </div>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#e11d48', marginTop: 4 }}>
            {metrics.pendingTasksCount || 0}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>Action items due</div>
        </Link>

        <Link to="/supervisor/center-visits" className="sup-metric-card" style={{ textDecoration: 'none', color: 'inherit', borderLeft: '4px solid #7c3aed' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--sup-text-muted)' }}>Branch Visits</span>
            <span style={{ fontSize: '0.8rem' }}>🏢</span>
          </div>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#7c3aed', marginTop: 4 }}>
            {metrics.branchVisitsCount || branchVisits.length || 0}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>System scheduled</div>
        </Link>

        <Link to="/supervisor/npa-recovery" className="sup-metric-card" style={{ textDecoration: 'none', color: 'inherit', borderLeft: '4px solid var(--sup-accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--sup-text-muted)' }}>NPA Recovery</span>
            <Icon name="alerttriangle" size={16} color="var(--sup-accent)" />
          </div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--sup-accent)', marginTop: 4 }}>
            ₹{metrics.npaTotalAmount.toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>{metrics.npaCount} overdue loans</div>
        </Link>

        <Link to="/supervisor/new-member-report" className="sup-metric-card" style={{ textDecoration: 'none', color: 'inherit', borderLeft: '4px solid var(--sup-primary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--sup-text-muted)' }}>New Members</span>
            <Icon name="users" size={16} color="var(--sup-primary)" />
          </div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--sup-primary)', marginTop: 4 }}>
            {metrics.newMembersCount}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>This month</div>
        </Link>
      </div>

      {/* Point 9: Scheduled Branch Visits from System */}
      <div className="sup-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '1rem' }}>🏢</span>
            <strong style={{ fontSize: '0.95rem' }}>Scheduled Branch Visits (System)</strong>
          </div>
          <Link to="/supervisor/center-visits" style={{ fontSize: '0.76rem', color: 'var(--sup-primary)', fontWeight: 700, textDecoration: 'none' }}>
            Manage All →
          </Link>
        </div>

        {branchVisits.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--sup-text-muted)', fontSize: '0.82rem' }}>
            No upcoming branch visits scheduled in system
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {branchVisits.slice(0, 3).map((v) => (
              <div
                key={v._id}
                style={{
                  padding: '10px 12px',
                  background: 'var(--sup-bg)',
                  borderRadius: 8,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <strong style={{ fontSize: '0.88rem', color: 'var(--sup-text)' }}>
                    {v.branchName || v.branch?.name || 'Branch'} ({v.branchCode || v.branch?.code})
                  </strong>
                  <div style={{ fontSize: '0.74rem', color: 'var(--sup-text-muted)', marginTop: 2 }}>
                    Date: <strong>{v.visitDate ? new Date(v.visitDate).toISOString().slice(0, 10) : 'Today'}</strong> • City: {v.branchCity || v.branch?.city || '—'}
                    {v.branchPincode || v.branch?.pincode ? ` (Pin: ${v.branchPincode || v.branch?.pincode})` : ''}
                  </div>
                </div>
                <span
                  style={{
                    background: v.status === 'completed' ? 'var(--sup-success-light)' : '#fef3c7',
                    color: v.status === 'completed' ? 'var(--sup-success)' : '#b45309',
                    padding: '3px 8px',
                    borderRadius: 8,
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                >
                  {v.status || 'Scheduled'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Point 12: Pending Team Tasks Follow-up */}
      <div className="sup-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '1rem' }}>📌</span>
            <strong style={{ fontSize: '0.95rem' }}>Pending Follow-up Tasks ({pendingTasks.length})</strong>
          </div>
          <Link to="/supervisor/tasks" style={{ fontSize: '0.76rem', color: '#e11d48', fontWeight: 700, textDecoration: 'none' }}>
            View All Tasks →
          </Link>
        </div>

        {pendingTasks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--sup-text-muted)', fontSize: '0.82rem' }}>
            ✓ No pending tasks! All team assignments up to date.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pendingTasks.slice(0, 3).map((t) => (
              <div
                key={t._id}
                style={{
                  padding: '10px 12px',
                  background: 'var(--sup-bg)',
                  borderRadius: 8,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ background: '#fef2f2', color: '#b91c1c', padding: '2px 6px', borderRadius: 6, fontSize: '0.68rem', fontWeight: 700 }}>
                      {t.category || 'General'}
                    </span>
                    <strong style={{ fontSize: '0.88rem' }}>{t.title}</strong>
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--sup-text-muted)' }}>
                    {t.assignedToCode === supUser?.employeeCode ? (
                      <strong style={{ color: 'var(--sup-primary)' }}>Assigned to YOU</strong>
                    ) : (
                      <span>Assigned: {t.assignedToName || t.assignedToCode}</span>
                    )} • Due: {t.dueDate ? new Date(t.dueDate).toLocaleDateString() : 'Immediate'}
                  </div>
                </div>
                <Link
                  to="/supervisor/tasks"
                  className="sup-btn sm"
                  style={{ width: 'auto', padding: '4px 8px', fontSize: '0.72rem', textDecoration: 'none' }}
                >
                  Action →
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Staff-wise & Branch-wise Overview Section */}
      <div className="sup-card" style={{ marginBottom: 16 }}>
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

      {/* SECTION 1: FINANCIAL & FIELD OPERATIONS */}
      <div style={{ marginBottom: 8, fontWeight: 700, fontSize: '0.88rem', color: 'var(--sup-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Financial &amp; Field Operations
      </div>
      <div className="sup-grid-3" style={{ marginBottom: 16 }}>
        <Link to="/supervisor/today-due" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#fef2f2', color: '#b91c1c' }}>
            <Icon name="calendar" size={20} />
          </div>
          <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>Today Due</span>
        </Link>

        <Link to="/supervisor/collection-paid" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#f0fdf4', color: '#15803d' }}>
            <Icon name="checkcircle" size={20} />
          </div>
          <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>Collected</span>
        </Link>

        <Link to="/supervisor/emi-payment" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#ecfdf5', color: '#059669' }}>
            <Icon name="creditcard" size={20} />
          </div>
          <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>EMI Collect</span>
        </Link>

        <Link to="/supervisor/npa-recovery" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#fffbeb', color: '#b45309' }}>
            <Icon name="alerttriangle" size={20} />
          </div>
          <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>NPA Recovery</span>
        </Link>

        <Link to="/supervisor/new-member" className="sup-action-card">
          <div className="sup-action-icon">
            <Icon name="userplus" size={20} />
          </div>
          <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>New Member</span>
        </Link>

        <Link to="/supervisor/center-visits" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#faf5ff', color: '#9333ea' }}>
            <Icon name="map" size={20} />
          </div>
          <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>Branch &amp; Visits</span>
        </Link>
      </div>

      {/* SECTION 2: HR & STAFF SUPERVISION */}
      <div style={{ marginBottom: 8, fontWeight: 700, fontSize: '0.88rem', color: 'var(--sup-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        HR &amp; Staff Supervision
      </div>
      <div className="sup-grid-3" style={{ marginBottom: 16 }}>
        <Link to="/supervisor/team-staff" className="sup-action-card" style={{ border: '2px solid var(--sup-primary)' }}>
          <div className="sup-action-icon" style={{ background: 'var(--sup-primary)', color: '#fff' }}>
            <Icon name="users" size={20} />
          </div>
          <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--sup-primary)' }}>Attached Staff</span>
        </Link>

        <Link to="/supervisor/tasks" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#fff1f2', color: '#e11d48' }}>
            <Icon name="check" size={20} />
          </div>
          <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>Team Tasks</span>
        </Link>

        <Link to="/supervisor/attendance-records" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#f5f3ff', color: '#7c3aed' }}>
            <Icon name="clock" size={20} />
          </div>
          <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>Attendance</span>
        </Link>

        <Link to="/supervisor/leaves" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#ecfeff', color: '#0891b2' }}>
            <Icon name="filetext" size={20} />
          </div>
          <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>Leave Decision</span>
        </Link>

        <Link to="/supervisor/staff-rating" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#fef3c7', color: '#d97706' }}>
            <Icon name="check" size={20} />
          </div>
          <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>Staff Rating</span>
        </Link>

        <Link to="/supervisor/staff-requisition" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#eff6ff', color: '#2563eb' }}>
            <Icon name="userplus" size={20} />
          </div>
          <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>Hiring Demand</span>
        </Link>

        <Link to="/supervisor/staff-attendance" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#fdf4ff', color: '#c026d3' }}>
            <Icon name="user" size={20} />
          </div>
          <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>Branch Present</span>
        </Link>

        <Link to="/supervisor/salary-slips" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#fff7ed', color: '#ea580c' }}>
            <Icon name="creditcard" size={20} />
          </div>
          <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>Salary Slips</span>
        </Link>
      </div>

      {/* SECTION 3: SUPERVISORY AUDITS & COMPLIANCE */}
      <div style={{ marginBottom: 8, fontWeight: 700, fontSize: '0.88rem', color: 'var(--sup-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Supervisory Audits &amp; Compliance
      </div>
      <div className="sup-grid-3" style={{ marginBottom: 20 }}>
        <Link to="/supervisor/complaints" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#fef2f2', color: '#ef4444' }}>
            <Icon name="phone" size={20} />
          </div>
          <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>Complaints</span>
        </Link>

        <Link to="/supervisor/product-sales" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#fffbeb', color: '#f59e0b' }}>
            <Icon name="shoppingbag" size={20} />
          </div>
          <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>Product Sell Report</span>
        </Link>

        <Link to="/supervisor/branch-transfers" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#f0fdf4', color: '#10b981' }}>
            <Icon name="arrowright" size={20} />
          </div>
          <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>Transfers</span>
        </Link>

        <Link to="/supervisor/resignation" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#f8fafc', color: '#64748b' }}>
            <Icon name="filetext" size={20} />
          </div>
          <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>Resignation</span>
        </Link>

        <Link to="/supervisor/calculator" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#eff6ff', color: '#3b82f6' }}>
            <Icon name="calculator" size={20} />
          </div>
          <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>Calculator</span>
        </Link>

        <Link to="/supervisor/death-request" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#fef2f2', color: '#991b1b' }}>
            <Icon name="shield" size={20} />
          </div>
          <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>Death Settlement</span>
        </Link>

        <Link to="/supervisor/reports" className="sup-action-card">
          <div className="sup-action-icon" style={{ background: '#f5f3ff', color: '#8b5cf6' }}>
            <Icon name="download" size={20} />
          </div>
          <span style={{ fontSize: '0.76rem', fontWeight: 600 }}>Reports</span>
        </Link>
      </div>
    </div>
  );
}
