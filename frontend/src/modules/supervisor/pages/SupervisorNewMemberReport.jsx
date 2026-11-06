import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorNewMemberReport() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState('month'); // 'month' | 'week'
  const [mode, setMode] = useState('staff'); // 'staff' | 'branch'

  useEffect(() => {
    loadReport();
  }, [period]);

  async function loadReport() {
    setLoading(true);
    setError('');
    try {
      const res = await api.supervisorApp.newMemberReport({ period });
      setData(res);
    } catch (err) {
      setError(err.message || 'Failed to load member registration report');
    } finally {
      setLoading(false);
    }
  }

  const staffWise = data?.staffWise || [];
  const branchWise = data?.branchWise || [];
  const totalCount = data?.totalCount || 0;

  return (
    <div className="sup-page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>New Member Report</h2>
          <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>Staff-wise & Branch-wise Registrations</div>
        </div>
        <select
          className="sup-select"
          style={{ width: 'auto', padding: '6px 10px', fontSize: '0.8rem' }}
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        >
          <option value="month">This Month</option>
          <option value="week">Last 7 Days</option>
        </select>
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

      {/* Metric Card */}
      <div className="sup-card" style={{ borderLeft: '4px solid var(--sup-primary)', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '0.78rem', color: 'var(--sup-text-muted)', fontWeight: 600 }}>
              TOTAL NEW MEMBERS ONBOARDED
            </div>
            <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--sup-primary)', marginTop: 2 }}>
              {totalCount} Members
            </div>
          </div>
          <Icon name="users" size={28} color="var(--sup-primary)" />
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
          Loading member report…
        </div>
      ) : (
        <div>
          {mode === 'staff' ? (
            staffWise.length === 0 ? (
              <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
                No new members registered by staff in this period
              </div>
            ) : (
              staffWise.map((s) => (
                <div key={s.staffCode} className="sup-card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong style={{ fontSize: '0.95rem' }}>Staff Code: {s.staffCode}</strong>
                      <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>{s.count} members added</div>
                    </div>
                    <span style={{ background: 'var(--sup-primary-light)', color: 'var(--sup-primary)', padding: '4px 10px', borderRadius: 12, fontWeight: 700, fontSize: '0.85rem' }}>
                      {s.count}
                    </span>
                  </div>
                  <div style={{ marginTop: 10, borderTop: '1px solid var(--sup-border)', paddingTop: 8 }}>
                    {(s.members || []).map((m, idx) => (
                      <div key={m.id || idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.82rem' }}>
                        <span>{m.name}</span>
                        <span style={{ color: 'var(--sup-text-muted)' }}>{m.mobile}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )
          ) : (
            branchWise.length === 0 ? (
              <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
                No new members registered in branches in this period
              </div>
            ) : (
              branchWise.map((b, idx) => (
                <div key={b.branchName || idx} className="sup-card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong style={{ fontSize: '0.95rem' }}>{b.branchName}</strong>
                      <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>{b.count} members added</div>
                    </div>
                    <span style={{ background: 'var(--sup-primary-light)', color: 'var(--sup-primary)', padding: '4px 10px', borderRadius: 12, fontWeight: 700, fontSize: '0.85rem' }}>
                      {b.count}
                    </span>
                  </div>
                  <div style={{ marginTop: 10, borderTop: '1px solid var(--sup-border)', paddingTop: 8 }}>
                    {(b.members || []).map((m, mIdx) => (
                      <div key={m.id || mIdx} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '0.82rem' }}>
                        <span>{m.name}</span>
                        <span style={{ color: 'var(--sup-text-muted)' }}>{m.mobile}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )
          )}
        </div>
      )}
    </div>
  );
}
