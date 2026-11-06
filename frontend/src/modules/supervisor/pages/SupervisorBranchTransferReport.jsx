import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorBranchTransferReport() {
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadTransfers();
  }, []);

  async function loadTransfers() {
    setLoading(true);
    setError('');
    try {
      const res = await api.supervisorApp.branchTransferReport();
      setTransfers(res.transfers || []);
    } catch (err) {
      setError(err.message || 'Failed to load branch transfer report');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Branch Transfer Requests</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>
          Supervised Staff Relocation & Transfer Report
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
          Loading transfer requests…
        </div>
      ) : transfers.length === 0 ? (
        <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
          No branch transfer requests found for your supervised branches
        </div>
      ) : (
        transfers.map((t) => {
          const emp = t.employee || {};
          return (
            <div key={t._id} className="sup-card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <strong style={{ fontSize: '0.95rem' }}>{emp.name || 'Staff Member'}</strong>
                  <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>
                    {emp.employeeCode || '—'} • {emp.designation?.name || 'Staff'}
                  </div>
                </div>
                <span
                  style={{
                    background: t.status === 'approved' ? 'var(--sup-success-light)' : t.status === 'rejected' ? 'var(--sup-danger-light)' : 'var(--sup-warning-light)',
                    color: t.status === 'approved' ? 'var(--sup-success)' : t.status === 'rejected' ? 'var(--sup-danger)' : 'var(--sup-warning)',
                    padding: '2px 8px',
                    borderRadius: 10,
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                >
                  {t.status || 'Pending'}
                </span>
              </div>

              <div style={{ marginTop: 10, fontSize: '0.82rem', padding: '10px', background: 'var(--sup-bg)', borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)', display: 'block' }}>From Branch</span>
                    <strong>{t.fromBranch?.name || 'Current Branch'}</strong>
                  </div>
                  <Icon name="arrowright" size={16} color="var(--sup-primary)" />
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)', display: 'block' }}>To Branch</span>
                    <strong>{t.toBranch?.name || 'Target Branch'}</strong>
                  </div>
                </div>

                {t.effectiveDate && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                    <span style={{ color: 'var(--sup-text-muted)' }}>Effective Date:</span>
                    <strong>{new Date(t.effectiveDate).toLocaleDateString()}</strong>
                  </div>
                )}

                {t.reason && (
                  <div style={{ marginTop: 4 }}>
                    <span style={{ color: 'var(--sup-text-muted)' }}>Reason: </span>
                    <span>{t.reason}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

