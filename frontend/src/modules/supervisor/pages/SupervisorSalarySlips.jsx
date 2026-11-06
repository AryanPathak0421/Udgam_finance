import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';
import { downloadSalarySlipPdf } from '../../../utils/salarySlipPdf.js';

export default function SupervisorSalarySlips() {
  const [slips, setSlips] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [activeSlip, setActiveSlip] = useState(null);
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
      const list = res.slips || res.items || [];
      setSlips(list);
      if (list.length > 0) {
        setSelectedMonth(list[0].month);
        setActiveSlip(list[0]);
      }
    } catch (err) {
      setError(err.message || 'Failed to load salary slips');
    } finally {
      setLoading(false);
    }
  }

  const handleMonthChange = (month) => {
    setSelectedMonth(month);
    const found = slips.find((s) => s.month === month);
    if (found) setActiveSlip(found);
  };

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Supervisor Salary Slips</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>
          Monthly Remuneration, Basic Pay, Fuel, and Absent Deductions
        </div>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--sup-danger-light)', color: 'var(--sup-danger)', borderRadius: 10, fontSize: '0.85rem', marginBottom: 14 }}>
          <Icon name="alertcircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Month Selector Tabs */}
      {slips.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--sup-text-muted)', marginBottom: 6 }}>
            Select Month:
          </div>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
            {slips.map((s) => {
              const isSelected = selectedMonth === s.month;
              return (
                <button
                  key={s.id || s.month}
                  onClick={() => handleMonthChange(s.month)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 20,
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    border: isSelected ? '1px solid var(--sup-primary)' : '1px solid var(--sup-border)',
                    background: isSelected ? 'var(--sup-primary)' : '#fff',
                    color: isSelected ? '#fff' : 'var(--sup-text)',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                  }}
                >
                  📅 {s.month}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
          Loading salary statements…
        </div>
      ) : slips.length === 0 ? (
        <div className="sup-card" style={{ textAlign: 'center', padding: '36px', color: 'var(--sup-text-muted)' }}>
          <Icon name="document" size={36} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
          <div style={{ fontWeight: 700 }}>No salary slips generated yet</div>
          <div style={{ fontSize: '0.8rem', marginTop: 4 }}>Supervisor salary slips will appear here once processed by HR.</div>
        </div>
      ) : activeSlip ? (
        <div className="sup-card" style={{ border: '2px solid var(--sup-primary)', padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--sup-border)', paddingBottom: 10, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)', textTransform: 'uppercase' }}>SUPERVISOR PAYROLL STATEMENT</div>
              <h3 style={{ fontSize: '1.3rem', fontWeight: 900, margin: '2px 0 0 0', color: 'var(--sup-primary)' }}>
                {activeSlip.month}
              </h3>
              <div style={{ fontSize: '0.78rem', color: 'var(--sup-text-muted)', marginTop: 2 }}>
                {activeSlip.name} • {activeSlip.designation || 'Supervisor'} • {activeSlip.branch || 'Head Office'}
              </div>
            </div>

            <div style={{ textAlign: 'right' }}>
              <span className={`sup-badge sup-badge-${activeSlip.status === 'Paid' || activeSlip.status === 'paid' ? 'success' : 'warning'}`} style={{ textTransform: 'uppercase', fontSize: '0.72rem' }}>
                {activeSlip.status || 'Paid'}
              </span>
              <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)', marginTop: 4 }}>
                {activeSlip.payableDays} Payable Days
              </div>
            </div>
          </div>

          {/* Attendance Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, textAlign: 'center', background: '#f8fafc', padding: 8, borderRadius: 8, marginBottom: 14, fontSize: '0.75rem' }}>
            <div>
              <div style={{ color: 'var(--sup-text-muted)' }}>Days</div>
              <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{activeSlip.daysInMonth || 30}</div>
            </div>
            <div>
              <div style={{ color: '#059669' }}>Present</div>
              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#059669' }}>{activeSlip.presentDays || 0}</div>
            </div>
            <div>
              <div style={{ color: '#dc2626' }}>Absent</div>
              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#dc2626' }}>{activeSlip.absentDays || 0}</div>
            </div>
            <div>
              <div style={{ color: 'var(--sup-primary)' }}>Payable</div>
              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--sup-primary)' }}>{activeSlip.payableDays || 0}</div>
            </div>
          </div>

          {/* Net Take Home Pay */}
          <div style={{ background: 'linear-gradient(135deg, #059669, #10b981)', color: '#fff', padding: '16px', borderRadius: 10, textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: '0.75rem', opacity: 0.9, textTransform: 'uppercase' }}>Net Take-Home Salary</div>
            <div style={{ fontSize: '2.2rem', fontWeight: 900, marginTop: 2 }}>
              ₹{Number(activeSlip.netSalary || 0).toLocaleString('en-IN')}
            </div>
            {activeSlip.paymentDate && (
              <div style={{ fontSize: '0.72rem', opacity: 0.85, marginTop: 4 }}>
                Paid on: {new Date(activeSlip.paymentDate).toLocaleDateString()}
              </div>
            )}
          </div>

          {/* Breakdown: Earnings vs Deductions */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: '0.82rem' }}>
            {/* Earnings */}
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: 10, borderRadius: 8 }}>
              <div style={{ fontWeight: 700, color: '#15803d', marginBottom: 8 }}>Earnings (+)</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                <span style={{ color: 'var(--sup-text-muted)' }}>Basic Salary:</span>
                <strong>₹{Number(activeSlip.basicSalary || 0).toLocaleString('en-IN')}</strong>
              </div>
              {activeSlip.fuelAllowance > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: 'var(--sup-text-muted)' }}>Fuel Allowance:</span>
                  <strong>₹{Number(activeSlip.fuelAllowance || 0).toLocaleString('en-IN')}</strong>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                <span style={{ color: 'var(--sup-text-muted)' }}>Allowances:</span>
                <strong>₹{Number(activeSlip.allowances || 0).toLocaleString('en-IN')}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #86efac', paddingTop: 6, marginTop: 4, fontWeight: 800, color: '#15803d' }}>
                <span>Gross:</span>
                <span>₹{Number(activeSlip.grossSalary || (activeSlip.basicSalary + (activeSlip.allowances || 0))).toLocaleString('en-IN')}</span>
              </div>
            </div>

            {/* Deductions */}
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: 10, borderRadius: 8 }}>
              <div style={{ fontWeight: 700, color: '#b91c1c', marginBottom: 8 }}>Deductions (-)</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                <span style={{ color: 'var(--sup-text-muted)' }}>Absent (Basic+Fuel):</span>
                <strong style={{ color: '#dc2626' }}>-₹{Number(activeSlip.absentDeduction || 0).toLocaleString('en-IN')}</strong>
              </div>
              {activeSlip.pfDeduction > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: 'var(--sup-text-muted)' }}>PF:</span>
                  <strong>-₹{Number(activeSlip.pfDeduction).toLocaleString('en-IN')}</strong>
                </div>
              )}
              {activeSlip.esiDeduction > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: 'var(--sup-text-muted)' }}>ESI:</span>
                  <strong>-₹{Number(activeSlip.esiDeduction).toLocaleString('en-IN')}</strong>
                </div>
              )}
              {activeSlip.advanceDeduction > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: 'var(--sup-text-muted)' }}>Advance:</span>
                  <strong>-₹{Number(activeSlip.advanceDeduction).toLocaleString('en-IN')}</strong>
                </div>
              )}
              {activeSlip.securityDeduction > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: 'var(--sup-text-muted)' }}>Security Cut:</span>
                  <strong>-₹{Number(activeSlip.securityDeduction).toLocaleString('en-IN')}</strong>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #fca5a5', paddingTop: 6, marginTop: 4, fontWeight: 800, color: '#b91c1c' }}>
                <span>Total Deductions:</span>
                <span>-₹{Number(activeSlip.deductions || activeSlip.absentDeduction || 0).toLocaleString('en-IN')}</span>
              </div>
            </div>
          </div>

          {/* Download Slip Button */}
          <div style={{ marginTop: 16 }}>
            <button
              type="button"
              className="sup-btn sup-btn-primary"
              style={{
                width: '100%',
                padding: '11px 0',
                fontSize: '0.92rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
              onClick={() => downloadSalarySlipPdf(activeSlip)}
            >
              <Icon name="download" size={18} /> Download Supervisor Salary Slip (PDF)
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
