import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorTodayDue() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('staff'); // 'staff' | 'branch'
  const [selectedBranch, setSelectedBranch] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    loadDueData();
  }, [selectedBranch]);

  async function loadDueData() {
    setLoading(true);
    setError('');
    try {
      const params = selectedBranch !== 'all' ? { branchId: selectedBranch } : {};
      const res = await api.supervisorApp.todayDue(params);
      setData(res);
    } catch (err) {
      setError(err.message || 'Failed to load today due data');
    } finally {
      setLoading(false);
    }
  }

  const staffWise = data?.staffWise || [];
  const branchWise = data?.branchWise || [];
  const branches = data?.branches || [];

  const totalDueAmount = (mode === 'staff' ? staffWise : branchWise).reduce(
    (sum, item) => sum + (item.totalDue || 0),
    0
  );
  const totalDueCount = (mode === 'staff' ? staffWise : branchWise).reduce(
    (sum, item) => sum + (item.count || 0),
    0
  );

  return (
    <div className="sup-page-container">
      {/* Title & Filter Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Today Collection Due</h2>
          <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>Staff-wise & Branch-wise</div>
        </div>
        {branches.length > 1 && (
          <select
            className="sup-select"
            style={{ width: 'auto', padding: '6px 10px', fontSize: '0.8rem' }}
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
          >
            <option value="all">All Branches</option>
            {branches.map((b) => (
              <option key={b._id} value={b._id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Mode Switcher */}
      <div style={{ display: 'flex', background: 'var(--sup-border)', borderRadius: 10, padding: 3, marginBottom: 14 }}>
        <button
          type="button"
          style={{
            flex: 1,
            padding: '8px 0',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.85rem',
            background: mode === 'staff' ? 'var(--sup-card-bg)' : 'transparent',
            color: mode === 'staff' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            boxShadow: mode === 'staff' ? 'var(--sup-shadow)' : 'none',
            cursor: 'pointer',
          }}
          onClick={() => setMode('staff')}
        >
          Staff-wise
        </button>
        <button
          type="button"
          style={{
            flex: 1,
            padding: '8px 0',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.85rem',
            background: mode === 'branch' ? 'var(--sup-card-bg)' : 'transparent',
            color: mode === 'branch' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            boxShadow: mode === 'branch' ? 'var(--sup-shadow)' : 'none',
            cursor: 'pointer',
          }}
          onClick={() => setMode('branch')}
        >
          Branch-wise
        </button>
      </div>

      {/* Aggregate Due Card */}
      <div className="sup-card" style={{ borderLeft: '4px solid var(--sup-danger)', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '0.78rem', color: 'var(--sup-text-muted)', fontWeight: 600 }}>
              TOTAL PENDING DUE TODAY
            </div>
            <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--sup-danger)', marginTop: 2 }}>
              ₹{totalDueAmount.toLocaleString('en-IN')}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ background: 'var(--sup-danger-light)', color: 'var(--sup-danger)', padding: '4px 10px', borderRadius: 12, fontWeight: 700, fontSize: '0.8rem' }}>
              {totalDueCount} Members Due
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--sup-danger-light)', color: 'var(--sup-danger)', borderRadius: 10, fontSize: '0.85rem', marginBottom: 14 }}>
          <Icon name="alertcircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
          Loading collection due records…
        </div>
      ) : (
        <div>
          {mode === 'staff' ? (
            staffWise.length === 0 ? (
              <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
                No dues scheduled for staff today
              </div>
            ) : (
              staffWise.map((s) => {
                const isExpanded = expandedId === s.staffCode;
                return (
                  <div key={s.staffCode} className="sup-card" style={{ padding: 14 }}>
                    <div
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                      onClick={() => setExpandedId(isExpanded ? null : s.staffCode)}
                    >
                      <div>
                        <strong style={{ fontSize: '0.95rem' }}>{s.staffName}</strong>
                        <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>
                          ID: {s.staffCode} • {s.count} Borrowers
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--sup-danger)' }}>
                          ₹{s.totalDue.toLocaleString('en-IN')}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--sup-primary)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <span>{isExpanded ? 'Hide' : 'View'} Details</span>
                          <Icon name={isExpanded ? 'chevronup' : 'chevrondown'} size={12} />
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{ marginTop: 12, borderTop: '1px solid var(--sup-border)', paddingTop: 10 }}>
                        {(s.items || []).map((item, idx) => (
                          <div
                            key={item.loanId || idx}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '8px 0',
                              borderBottom: idx !== s.items.length - 1 ? '1px dashed var(--sup-border)' : 'none',
                              fontSize: '0.82rem',
                            }}
                          >
                            <div>
                              <strong style={{ color: 'var(--sup-text)' }}>{item.memberName}</strong>
                              <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>
                                {item.groupName} • Center: {item.centerName || '—'}
                              </div>
                            </div>
                            <div style={{ fontWeight: 700, color: 'var(--sup-danger)' }}>
                              ₹{item.emiAmount?.toLocaleString('en-IN')}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )
          ) : (
            branchWise.length === 0 ? (
              <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
                No dues scheduled for branches today
              </div>
            ) : (
              branchWise.map((b) => {
                const isExpanded = expandedId === b.branchId;
                return (
                  <div key={b.branchId} className="sup-card" style={{ padding: 14 }}>
                    <div
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                      onClick={() => setExpandedId(isExpanded ? null : b.branchId)}
                    >
                      <div>
                        <strong style={{ fontSize: '0.95rem' }}>{b.branchName}</strong>
                        <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>
                          Branch Code: {b.branchCode} • {b.count} Members
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--sup-danger)' }}>
                          ₹{b.totalDue.toLocaleString('en-IN')}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--sup-primary)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <span>{isExpanded ? 'Hide' : 'View'} Details</span>
                          <Icon name={isExpanded ? 'chevronup' : 'chevrondown'} size={12} />
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{ marginTop: 12, borderTop: '1px solid var(--sup-border)', paddingTop: 10 }}>
                        {(b.items || []).map((item, idx) => (
                          <div
                            key={item.loanId || idx}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '8px 0',
                              borderBottom: idx !== b.items.length - 1 ? '1px dashed var(--sup-border)' : 'none',
                              fontSize: '0.82rem',
                            }}
                          >
                            <div>
                              <strong style={{ color: 'var(--sup-text)' }}>{item.memberName}</strong>
                              <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>
                                Officer: {item.staffCode} • {item.groupName}
                              </div>
                            </div>
                            <div style={{ fontWeight: 700, color: 'var(--sup-danger)' }}>
                              ₹{item.emiAmount?.toLocaleString('en-IN')}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )
          )}
        </div>
      )}
    </div>
  );
}

