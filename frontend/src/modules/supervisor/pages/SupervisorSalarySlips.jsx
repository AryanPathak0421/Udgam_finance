import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorSalarySlips() {
  const [slips, setSlips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadSlips();
  }, []);

  async function loadSlips() {
    setLoading(true);
    setError('');
    try {
      const res = await api.supervisorApp.salarySlips();
      setSlips(res.slips || []);
    } catch (err) {
      setError(err.message || 'Failed to load salary slips');
    } finally {
      setLoading(false);
    }
  }

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Supervisor Salary Slips</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>Monthly Remuneration & Payroll Statements</div>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--sup-danger-light)', color: 'var(--sup-danger)', borderRadius: 10, fontSize: '0.85rem', marginBottom: 14 }}>
          <Icon name="alertcircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
          Loading salary statements…
        </div>
      ) : slips.length === 0 ? (
        <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
          No salary statements issued yet
        </div>
      ) : (
        slips.map((slip) => (
          <div key={slip.id} className="sup-card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--sup-border)' }}>
              <div>
                <strong style={{ fontSize: '1rem' }}>
                  {typeof slip.month === 'number' ? MONTH_NAMES[slip.month - 1] : slip.month} {slip.year}
                </strong>
                <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>
                  Disbursed: {slip.paymentDate ? new Date(slip.paymentDate).toLocaleDateString() : 'Settled'}
                </div>
              </div>
              <span
                style={{
                  background: 'var(--sup-success-light)',
                  color: 'var(--sup-success)',
                  padding: '3px 8px',
                  borderRadius: 10,
                  fontSize: '0.75rem',
                  fontWeight: 700,
                }}
              >
                {slip.status}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: '0.82rem' }}>
              <div>
                <span style={{ color: 'var(--sup-text-muted)' }}>Basic Salary:</span>
                <div style={{ fontWeight: 600 }}>₹{slip.basicSalary?.toLocaleString('en-IN')}</div>
              </div>
              <div>
                <span style={{ color: 'var(--sup-text-muted)' }}>Allowances:</span>
                <div style={{ fontWeight: 600, color: 'var(--sup-success)' }}>+₹{slip.allowances?.toLocaleString('en-IN')}</div>
              </div>
              <div>
                <span style={{ color: 'var(--sup-text-muted)' }}>Deductions:</span>
                <div style={{ fontWeight: 600, color: 'var(--sup-danger)' }}>-₹{slip.deductions?.toLocaleString('en-IN')}</div>
              </div>
              <div>
                <span style={{ color: 'var(--sup-text-muted)' }}>Net Paid:</span>
                <div style={{ fontWeight: 800, color: 'var(--sup-primary)', fontSize: '0.98rem' }}>
                  ₹{slip.netSalary?.toLocaleString('en-IN')}
                </div>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

