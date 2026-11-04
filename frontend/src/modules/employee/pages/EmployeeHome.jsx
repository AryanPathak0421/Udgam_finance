import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api/client.js';
import { useEmpApp } from '../EmployeeAppContext.jsx';

export default function EmployeeHome() {
  const { t, empUser } = useEmpApp();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.employeeApp.dashboard()
      .then((r) => setData(r))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  const summary = data?.summary || {
    todayCollected: 0,
    todayReceiptsCount: 0,
    todayDue: 0,
    dueCount: 0,
    pendingTasksCount: 0,
  };

  const graph = data?.performanceGraph || [];

  return (
    <div>
      {/* Welcome Card */}
      <div className="emp-card" style={{ background: 'linear-gradient(135deg, var(--emp-primary) 0%, #1e40af 100%)', color: '#ffffff', border: 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: '0.8rem', opacity: 0.9 }}>Welcome back,</span>
            <h3 style={{ margin: '2px 0', fontSize: '1.25rem' }}>{empUser?.name || 'Staff Officer'}</h3>
            <span style={{ fontSize: '0.75rem', opacity: 0.85 }}>Code: {empUser?.employeeCode} · {empUser?.branch?.name || 'Branch'}</span>
          </div>
          <div style={{ width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem' }}>
            {empUser?.photo ? <img src={empUser.photo} alt="dp" style={{ width: 50, height: 50, borderRadius: '50%', objectFit: 'cover' }} /> : '👤'}
          </div>
        </div>
      </div>

      {/* Today KPI Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 14 }}>
        <div className="emp-card" style={{ margin: 0, cursor: 'pointer' }} onClick={() => navigate('/employee/due-list')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="emp-stat-label">{t('today_due')}</span>
            <span style={{ fontSize: '1.1rem' }}>📅</span>
          </div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, margin: '6px 0 2px', color: 'var(--emp-danger)' }}>
            ₹{summary.todayDue.toLocaleString('en-IN')}
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>{summary.dueCount} members due</span>
        </div>

        <div className="emp-card" style={{ margin: 0, cursor: 'pointer' }} onClick={() => navigate('/employee/collections')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="emp-stat-label">{t('today_collected')}</span>
            <span style={{ fontSize: '1.1rem' }}>✅</span>
          </div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, margin: '6px 0 2px', color: 'var(--emp-success)' }}>
            ₹{summary.todayCollected.toLocaleString('en-IN')}
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>{summary.todayReceiptsCount} receipts today</span>
        </div>
      </div>

      {/* Staff Performance Graph */}
      <div className="emp-card">
        <div className="emp-card-title">
          <span>📊 {t('performance_graph')}</span>
          <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--emp-text-muted)' }}>Last 6 Months</span>
        </div>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--emp-text-muted)' }}>Loading graph…</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', height: 140, paddingTop: 10, borderBottom: '1px solid var(--emp-border)' }}>
            {graph.map((g) => {
              const maxVal = Math.max(...graph.map((x) => Math.max(x.collected, x.disbursed)), 1000);
              const colH = Math.max(8, Math.round((g.collected / maxVal) * 100));
              const disbH = Math.max(8, Math.round((g.disbursed / maxVal) * 100));
              return (
                <div key={g.month} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: '14%' }}>
                  <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 100 }}>
                    <div
                      title={`Collected: ₹${g.collected}`}
                      style={{ width: 8, height: `${colH}px`, background: 'var(--emp-success)', borderRadius: '4px 4px 0 0' }}
                    />
                    <div
                      title={`Disbursed: ₹${g.disbursed}`}
                      style={{ width: 8, height: `${disbH}px`, background: 'var(--emp-primary)', borderRadius: '4px 4px 0 0' }}
                    />
                  </div>
                  <span style={{ fontSize: '0.68rem', color: 'var(--emp-text-muted)', whiteSpace: 'nowrap' }}>{g.label}</span>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 8, fontSize: '0.75rem' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, background: 'var(--emp-success)', borderRadius: 2 }} /> Collection</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, background: 'var(--emp-primary)', borderRadius: 2 }} /> Disbursement</span>
        </div>
      </div>

      {/* Main Operations Grid */}
      <h4 style={{ margin: '14px 0 8px', fontSize: '0.95rem' }}>{t('quick_actions')}</h4>
      <div className="emp-actions-grid">
        <div className="emp-action-tile" onClick={() => navigate('/employee/emi-payment')}>
          <div className="tile-icon">💰</div>
          <div className="tile-title">EMI Payment (Daily/Wk/Mo)</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/advance-payment')}>
          <div className="tile-icon">💳</div>
          <div className="tile-title">Advance Payment (QR/Cash)</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/npa-recovery')}>
          <div className="tile-icon">🚨</div>
          <div className="tile-title">NPA Recovery</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/track-loan')}>
          <div className="tile-icon">🔎</div>
          <div className="tile-title">Track Loan History</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/new-member')}>
          <div className="tile-icon">👥</div>
          <div className="tile-title">{t('new_member')}</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/kyc')}>
          <div className="tile-icon">🆔</div>
          <div className="tile-title">{t('member_kyc')}</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/requisition')}>
          <div className="tile-icon">📝</div>
          <div className="tile-title">{t('loan_requisition')}</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/collection-history')}>
          <div className="tile-icon">💵</div>
          <div className="tile-title">{t('collection_history')}</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/today-due')}>
          <div className="tile-icon">📅</div>
          <div className="tile-title">{t('due_list')}</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/guarantor-change')}>
          <div className="tile-icon">🔄</div>
          <div className="tile-title">{t('guarantor_change')}</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/synopsis')}>
          <div className="tile-icon">📋</div>
          <div className="tile-title">{t('synopsis')}</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/calculator')}>
          <div className="tile-icon">🧮</div>
          <div className="tile-title">{t('calculator')}</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/borrower-savings')}>
          <div className="tile-icon">🏦</div>
          <div className="tile-title">Borrower Savings &amp; Return</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/reports')}>
          <div className="tile-icon">📊</div>
          <div className="tile-title">My Reports &amp; Targets</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/attendance')}>
          <div className="tile-icon">📸</div>
          <div className="tile-title">Meeting Attendance</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/salary-slips')}>
          <div className="tile-icon">📑</div>
          <div className="tile-title">Salary Slips</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/center-visits')}>
          <div className="tile-icon">🏘️</div>
          <div className="tile-title">Center &amp; CGT Visits</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/hr-services')}>
          <div className="tile-icon">⚙️</div>
          <div className="tile-title">HR Services &amp; Leaves</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/product-sale')}>
          <div className="tile-icon">📦</div>
          <div className="tile-title">Product Sale</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/tasks')}>
          <div className="tile-icon">📌</div>
          <div className="tile-title">My Tasks</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/holidays')}>
          <div className="tile-icon">🎉</div>
          <div className="tile-title">Holiday Calendar</div>
        </div>
      </div>
    </div>
  );
}

