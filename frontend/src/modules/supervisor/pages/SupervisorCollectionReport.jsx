import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorCollectionReport() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('staff'); // 'staff' | 'branch'
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    loadCollectionData();
  }, []);

  async function loadCollectionData() {
    setLoading(true);
    setError('');
    try {
      const res = await api.supervisorApp.collectionPaid();
      setData(res);
    } catch (err) {
      setError(err.message || 'Failed to load today collection data');
    } finally {
      setLoading(false);
    }
  }

  const staffWise = data?.staffWise || [];
  const branchWise = data?.branchWise || [];
  const totalAmount = data?.totalAmount || 0;
  const totalReceipts = data?.totalReceipts || 0;

  return (
    <div className="sup-page-container">
      {/* Title */}
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Today Collection Paid</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>Staff-wise & Branch-wise Settlements</div>
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

      {/* Summary Card */}
      <div className="sup-card" style={{ borderLeft: '4px solid var(--sup-success)', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '0.78rem', color: 'var(--sup-text-muted)', fontWeight: 600 }}>
              TOTAL COLLECTED TODAY
            </div>
            <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--sup-success)', marginTop: 2 }}>
              ₹{totalAmount.toLocaleString('en-IN')}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ background: 'var(--sup-success-light)', color: 'var(--sup-success)', padding: '4px 10px', borderRadius: 12, fontWeight: 700, fontSize: '0.8rem' }}>
              {totalReceipts} Receipts Settled
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
          Loading collection records…
        </div>
      ) : (
        <div>
          {mode === 'staff' ? (
            staffWise.length === 0 ? (
              <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
                No collections settled by staff today
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
                          ID: {s.staffCode} • {s.count} Receipts
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--sup-success)' }}>
                          ₹{s.totalCollected.toLocaleString('en-IN')}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--sup-primary)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <span>{isExpanded ? 'Hide' : 'View'} Receipts</span>
                          <Icon name={isExpanded ? 'chevronup' : 'chevrondown'} size={12} />
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{ marginTop: 12, borderTop: '1px solid var(--sup-border)', paddingTop: 10 }}>
                        {(s.receipts || []).map((rcpt, idx) => (
                          <div
                            key={rcpt.id || idx}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '8px 0',
                              borderBottom: idx !== s.receipts.length - 1 ? '1px dashed var(--sup-border)' : 'none',
                              fontSize: '0.82rem',
                            }}
                          >
                            <div>
                              <strong style={{ color: 'var(--sup-text)' }}>{rcpt.memberName}</strong>
                              <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>
                                Rcpt #{rcpt.receiptNo} • {rcpt.paymentMode} • {rcpt.time}
                              </div>
                            </div>
                            <div style={{ fontWeight: 700, color: 'var(--sup-success)' }}>
                              ₹{rcpt.amount?.toLocaleString('en-IN')}
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
                No collections settled for branches today
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
                          Branch Code: {b.branchCode} • {b.count} Receipts
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--sup-success)' }}>
                          ₹{b.totalCollected.toLocaleString('en-IN')}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--sup-primary)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <span>{isExpanded ? 'Hide' : 'View'} Receipts</span>
                          <Icon name={isExpanded ? 'chevronup' : 'chevrondown'} size={12} />
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{ marginTop: 12, borderTop: '1px solid var(--sup-border)', paddingTop: 10 }}>
                        {(b.receipts || []).map((rcpt, idx) => (
                          <div
                            key={rcpt.id || idx}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '8px 0',
                              borderBottom: idx !== b.receipts.length - 1 ? '1px dashed var(--sup-border)' : 'none',
                              fontSize: '0.82rem',
                            }}
                          >
                            <div>
                              <strong style={{ color: 'var(--sup-text)' }}>{rcpt.memberName}</strong>
                              <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>
                                Officer: {rcpt.staffCode} • {rcpt.paymentMode} • {rcpt.time}
                              </div>
                            </div>
                            <div style={{ fontWeight: 700, color: 'var(--sup-success)' }}>
                              ₹{rcpt.amount?.toLocaleString('en-IN')}
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
