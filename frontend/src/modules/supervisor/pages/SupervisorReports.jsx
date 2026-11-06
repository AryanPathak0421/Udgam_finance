import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorReports() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reportType, setReportType] = useState('collection'); // 'collection' | 'staff' | 'branch'

  useEffect(() => {
    loadReports();
  }, [reportType]);

  async function loadReports() {
    setLoading(true);
    setError('');
    try {
      const res = await api.supervisorApp.dashboard();
      setData(res);
    } catch (err) {
      setError(err.message || 'Failed to load supervisor reports');
    } finally {
      setLoading(false);
    }
  }

  const staffWise = data?.staffWiseDues || [];
  const branchWise = data?.branchWiseDues || [];
  const metrics = data?.metrics || {};

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Supervisor Operational Reports</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>Staff-wise & Branch-wise Analytics</div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', background: 'var(--sup-border)', borderRadius: 10, padding: 3, marginBottom: 14 }}>
        <button
          type="button"
          style={{
            flex: 1,
            padding: '8px 0',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.8rem',
            background: reportType === 'collection' ? 'var(--sup-card-bg)' : 'transparent',
            color: reportType === 'collection' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            cursor: 'pointer',
          }}
          onClick={() => setReportType('collection')}
        >
          Overall
        </button>
        <button
          type="button"
          style={{
            flex: 1,
            padding: '8px 0',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.8rem',
            background: reportType === 'staff' ? 'var(--sup-card-bg)' : 'transparent',
            color: reportType === 'staff' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            cursor: 'pointer',
          }}
          onClick={() => setReportType('staff')}
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
            fontSize: '0.8rem',
            background: reportType === 'branch' ? 'var(--sup-card-bg)' : 'transparent',
            color: reportType === 'branch' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            cursor: 'pointer',
          }}
          onClick={() => setReportType('branch')}
        >
          Branch-wise
        </button>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--sup-danger-light)', color: 'var(--sup-danger)', borderRadius: 10, fontSize: '0.85rem', marginBottom: 14 }}>
          <Icon name="alertcircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
          Compiling reports…
        </div>
      ) : reportType === 'collection' ? (
        <div>
          <div className="sup-card" style={{ borderLeft: '4px solid var(--sup-primary)' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: 8 }}>Portfolio Summary</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--sup-border)', fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--sup-text-muted)' }}>Total Supervised Branches:</span>
              <strong>{metrics.totalBranchCount}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--sup-border)', fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--sup-text-muted)' }}>Active Field Officers:</span>
              <strong>{metrics.totalStaffCount}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--sup-border)', fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--sup-text-muted)' }}>Today Due Total:</span>
              <strong style={{ color: 'var(--sup-danger)' }}>₹{(metrics.totalDueToday || 0).toLocaleString('en-IN')}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--sup-border)', fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--sup-text-muted)' }}>Today Collected Total:</span>
              <strong style={{ color: 'var(--sup-success)' }}>₹{(metrics.totalCollectedToday || 0).toLocaleString('en-IN')}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--sup-text-muted)' }}>NPA Overdue Portfolio:</span>
              <strong style={{ color: 'var(--sup-warning)' }}>₹{(metrics.npaTotalAmount || 0).toLocaleString('en-IN')}</strong>
            </div>
          </div>
        </div>
      ) : reportType === 'staff' ? (
        staffWise.map((s) => (
          <div key={s.staffCode} className="sup-card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: '0.92rem' }}>{s.staffName}</strong>
                <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>
                  {s.staffCode} • {s.branchName}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--sup-success)' }}>
                  ₹{(s.collectedAmount || 0).toLocaleString('en-IN')}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--sup-danger)' }}>
                  Due: ₹{(s.dueAmount || 0).toLocaleString('en-IN')}
                </div>
              </div>
            </div>
          </div>
        ))
      ) : (
        branchWise.map((b) => (
          <div key={b.branchId} className="sup-card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: '0.92rem' }}>{b.branchName}</strong>
                <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>Branch Code: {b.branchCode}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--sup-success)' }}>
                  ₹{(b.collectedAmount || 0).toLocaleString('en-IN')}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--sup-danger)' }}>
                  Due: ₹{(b.dueAmount || 0).toLocaleString('en-IN')}
                </div>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

