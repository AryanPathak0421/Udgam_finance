import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api/client.js';
import { useEmpApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

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
    <div className="emp-page-container">
      {/* Executive Welcome Card */}
      <div
        className="emp-card"
        style={{
          background: 'linear-gradient(135deg, #0a4f4a 0%, #107870 60%, #0d615a 100%)',
          color: '#ffffff',
          border: 'none',
          boxShadow: '0 8px 20px rgba(16, 120, 112, 0.25)',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        <div style={{ position: 'absolute', right: -20, top: -20, opacity: 0.08, pointerEvents: 'none' }}>
          <Icon name="shield" size={140} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: 1 }}>
          <div>
            <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: 0.8, color: 'rgba(255,255,255,0.75)' }}>
              Operational Workspace
            </span>
            <h3 style={{ margin: '3px 0 2px', fontSize: '1.25rem', fontWeight: 800 }}>{empUser?.name || 'Staff Officer'}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.76rem', color: 'rgba(255,255,255,0.85)' }}>
                Staff ID: <strong>{empUser?.employeeCode || '—'}</strong> · {empUser?.branch?.name || 'Main Branch'}
              </span>
              <span
                style={{
                  background: 'rgba(254, 240, 138, 0.25)',
                  color: '#fef08a',
                  border: '1px solid rgba(254, 240, 138, 0.5)',
                  padding: '1px 7px',
                  borderRadius: 10,
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                ★ {Number(summary.averageRating || 5).toFixed(1)} Rating
              </span>
            </div>
          </div>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.18)',
              border: '2px solid rgba(254, 186, 16, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              overflow: 'hidden',
              flexShrink: 0
            }}
          >
            {empUser?.photo ? (
              <img src={empUser.photo} alt="dp" style={{ width: 48, height: 48, objectFit: 'cover' }} />
            ) : (
              <Icon name="user" size={24} />
            )}
          </div>
        </div>
      </div>

      {/* Today KPI Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 14 }}>
        <div className="emp-card" style={{ margin: 0, cursor: 'pointer', borderLeft: '4px solid var(--emp-danger)' }} onClick={() => navigate('/employee/today-due')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="emp-stat-label" style={{ fontWeight: 600 }}>{t('today_due')}</span>
            <span style={{ color: 'var(--emp-danger)' }}>
              <Icon name="calendar" size={18} />
            </span>
          </div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, margin: '6px 0 2px', color: 'var(--emp-danger)' }}>
            ₹{(summary.todayTotalDue || summary.todayDue || 0).toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)', lineHeight: 1.3 }}>
            {summary.todayRemainingDue !== undefined && summary.todayRemainingDue > 0 ? (
              <span style={{ color: '#dc2626', fontWeight: 700 }}>Remaining: ₹{summary.todayRemainingDue.toLocaleString('en-IN')}</span>
            ) : summary.todayCollected > 0 ? (
              <span style={{ color: '#16a34a', fontWeight: 700 }}>✓ All Dues Collected</span>
            ) : (
              <span>Target: ₹{(summary.todayTotalDue || summary.todayDue || 0).toLocaleString('en-IN')}</span>
            )}
            {summary.todayCollected > 0 && <span style={{ color: '#16a34a' }}> • Collect: ₹{summary.todayCollected.toLocaleString('en-IN')}</span>}
            <div>{summary.dueCount || summary.totalDueCount || 0} installments scheduled</div>
          </div>
        </div>

        <div className="emp-card" style={{ margin: 0, cursor: 'pointer', borderLeft: '4px solid var(--emp-success)' }} onClick={() => navigate('/employee/collections')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="emp-stat-label" style={{ fontWeight: 600 }}>{t('today_collected')}</span>
            <span style={{ color: 'var(--emp-success)' }}>
              <Icon name="checkcircle" size={18} />
            </span>
          </div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, margin: '6px 0 2px', color: 'var(--emp-success)' }}>
            ₹{summary.todayCollected.toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)', lineHeight: 1.3 }}>
            Total Due: <strong>₹{(summary.todayTotalDue ?? summary.todayTargetDue ?? summary.todayDue).toLocaleString('en-IN')}</strong>
            {summary.todayDue > 0 && <span style={{ color: '#dc2626' }}> • Due: ₹{summary.todayDue.toLocaleString('en-IN')}</span>}
            <div>{summary.todayReceiptsCount} receipts settled</div>
          </div>
        </div>
      </div>

      {/* Staff Performance Graph */}
      <div className="emp-card">
        <div className="emp-card-title">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="chart" size={18} style={{ color: 'var(--emp-primary)' }} />
            <span style={{ fontWeight: 700 }}>{t('performance_graph')}</span>
          </div>
          <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--emp-text-muted)' }}>Last 6 Months</span>
        </div>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--emp-text-muted)', fontSize: '0.88rem' }}>Loading analytics…</div>
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
                      style={{ width: 8, height: `${colH}px`, background: 'var(--emp-success)', borderRadius: '3px 3px 0 0' }}
                    />
                    <div
                      title={`Disbursed: ₹${g.disbursed}`}
                      style={{ width: 8, height: `${disbH}px`, background: 'var(--emp-primary)', borderRadius: '3px 3px 0 0' }}
                    />
                  </div>
                  <span style={{ fontSize: '0.68rem', color: 'var(--emp-text-muted)', whiteSpace: 'nowrap', fontWeight: 600 }}>{g.label}</span>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 10, fontSize: '0.75rem' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
            <span style={{ width: 10, height: 10, background: 'var(--emp-success)', borderRadius: 2 }} /> Collection
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
            <span style={{ width: 10, height: 10, background: 'var(--emp-primary)', borderRadius: 2 }} /> Disbursement
          </span>
        </div>
      </div>

      {/* Main Operations Grid */}
      <h4 style={{ margin: '18px 0 10px', fontSize: '0.92rem', textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--emp-text-muted)', fontWeight: 700 }}>
        Financial & Field Operations
      </h4>
      <div className="emp-actions-grid">
        <div className="emp-action-tile" onClick={() => navigate('/employee/emi-payment')}>
          <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
            <Icon name="rupee" size={22} />
          </div>
          <div className="tile-title">EMI Payment</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/advance-payment')}>
          <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
            <Icon name="creditcard" size={22} />
          </div>
          <div className="tile-title">Advance Deposit</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/npa-recovery')}>
          <div className="tile-icon" style={{ color: 'var(--emp-danger)' }}>
            <Icon name="alert" size={22} />
          </div>
          <div className="tile-title">NPA Recovery</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/track-loan')}>
          <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
            <Icon name="search" size={22} />
          </div>
          <div className="tile-title">Track Loans</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/new-member')}>
          <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
            <Icon name="userplus" size={22} />
          </div>
          <div className="tile-title">{t('new_member')}</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/kyc')}>
          <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
            <Icon name="kyc" size={22} />
          </div>
          <div className="tile-title">{t('member_kyc')}</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/requisition')}>
          <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
            <Icon name="file" size={22} />
          </div>
          <div className="tile-title">{t('loan_requisition')}</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/collection-history')}>
          <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
            <Icon name="cash" size={22} />
          </div>
          <div className="tile-title">{t('collection_history')}</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/today-due')}>
          <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
            <Icon name="calendar" size={22} />
          </div>
          <div className="tile-title">{t('due_list')}</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/guarantor-nominee')}>
          <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
            <Icon name="shieldcheck" size={22} />
          </div>
          <div className="tile-title">Guarantor &amp; Nominee</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/synopsis')}>
          <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
            <Icon name="book" size={22} />
          </div>
          <div className="tile-title">{t('synopsis')}</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/calculator')}>
          <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
            <Icon name="calculator" size={22} />
          </div>
          <div className="tile-title">{t('calculator')}</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/borrower-savings')}>
          <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
            <Icon name="bank" size={22} />
          </div>
          <div className="tile-title">Savings &amp; Returns</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/reports')}>
          <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
            <Icon name="chart" size={22} />
          </div>
          <div className="tile-title">Reports &amp; Targets</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/attendance')}>
          <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
            <Icon name="camera" size={22} />
          </div>
          <div className="tile-title">Meeting Check-in</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/salary-slips')}>
          <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
            <Icon name="ledger" size={22} />
          </div>
          <div className="tile-title">Salary Slips</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/center-visits')}>
          <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
            <Icon name="building" size={22} />
          </div>
          <div className="tile-title">Center &amp; CGT</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/hr-services')}>
          <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
            <Icon name="settings" size={22} />
          </div>
          <div className="tile-title">HR Services</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/product-sale')}>
          <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
            <Icon name="product" size={22} />
          </div>
          <div className="tile-title">Product Booking</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/tasks')}>
          <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
            <Icon name="ticket" size={22} />
          </div>
          <div className="tile-title">Tasks &amp; Follow-up</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/civil-check')}>
          <div className="tile-icon" style={{ color: '#0284c7' }}>
            <Icon name="shield-check" size={22} />
          </div>
          <div className="tile-title">Civil Score Check</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/death-request')}>
          <div className="tile-icon" style={{ color: '#dc2626' }}>
            <Icon name="file-text" size={22} />
          </div>
          <div className="tile-title">Death Request</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/notifications')}>
          <div className="tile-icon" style={{ color: '#8b5cf6' }}>
            <Icon name="bell" size={22} />
          </div>
          <div className="tile-title">Notifications</div>
        </div>

        <div className="emp-action-tile" onClick={() => navigate('/employee/holidays')}>
          <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
            <Icon name="award" size={22} />
          </div>
          <div className="tile-title">Holidays</div>
        </div>
      </div>

      {/* Point 26: Supervisor App Link at the bottom of Employee App */}
      <div
        className="emp-card"
        onClick={() => navigate('/supervisor/login')}
        style={{
          background: 'linear-gradient(135deg, #1e1b4b, #312e81)',
          color: '#fff',
          marginTop: 14,
          padding: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 8, background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="shield" size={20} style={{ color: '#a5b4fc' }} />
          </div>
          <div>
            <strong style={{ fontSize: '0.92rem', display: 'block' }}>Supervisor App Portal</strong>
            <span style={{ fontSize: '0.72rem', opacity: 0.85 }}>Login to Supervisor Portal</span>
          </div>
        </div>
        <span style={{ background: '#fff', color: '#1e1b4b', fontWeight: 700, fontSize: '0.75rem', padding: '6px 12px', borderRadius: 6 }}>
          Open →
        </span>
      </div>
    </div>
  );
}
