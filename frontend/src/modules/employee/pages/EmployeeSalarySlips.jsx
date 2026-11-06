import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

export default function EmployeeSalarySlips() {
  const { t } = useEmployeeApp();
  const [slips, setSlips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [activeSlip, setActiveSlip] = useState(null);

  useEffect(() => {
    api.employeeApp.salarySlips()
      .then((res) => {
        const items = res.items || [];
        setSlips(items);
        if (items.length > 0) {
          setSelectedMonth(items[0].month);
          setActiveSlip(items[0]);
        }
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  const handleMonthChange = (month) => {
    setSelectedMonth(month);
    const found = slips.find((s) => s.month === month);
    if (found) setActiveSlip(found);
  };

  return (
    <div className="emp-page-container">
      {/* Header Card */}
      <div className="emp-card">
        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 6px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="cash" size={20} style={{ color: 'var(--emp-primary)' }} /> Month-Wise Salary Slips
        </h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', margin: '0 0 12px 0' }}>
          Select any month to inspect official salary slip, earnings, absent deductions, and net payout.
        </p>

        {/* Month Dropdown / Tabs */}
        {slips.length > 0 && (
          <div>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
              Select Pay Month:
            </label>
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
                      border: isSelected ? '1px solid var(--emp-primary)' : '1px solid var(--emp-border)',
                      background: isSelected ? 'var(--emp-primary)' : '#f8fafc',
                      color: isSelected ? '#fff' : 'var(--emp-text)',
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
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px', color: 'var(--emp-text-muted)' }}>
          Loading salary slips...
        </div>
      ) : slips.length === 0 ? (
        <div className="emp-card" style={{ textAlign: 'center', padding: '36px', color: 'var(--emp-text-muted)' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: '50%', background: 'rgba(16, 120, 112, 0.08)', color: 'var(--emp-primary)', margin: '0 auto 12px' }}>
            <Icon name="file" size={28} />
          </div>
          <div style={{ fontWeight: 600 }}>No salary slips generated yet</div>
          <div style={{ fontSize: '0.8rem', marginTop: 4 }}>Salary slips will show here once processed by HR.</div>
        </div>
      ) : activeSlip ? (
        <>
          {/* Active Slip Card */}
          <div className="emp-card" style={{ border: '2px solid var(--emp-primary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--emp-border)', paddingBottom: 10, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)', textTransform: 'uppercase' }}>OFFICIAL SALARY STATEMENT</div>
                <h3 style={{ fontSize: '1.3rem', fontWeight: 900, margin: '2px 0 0 0', color: 'var(--emp-primary)' }}>
                  {activeSlip.month}
                </h3>
                <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                  {activeSlip.name} • {activeSlip.designation || 'Staff'} • {activeSlip.branch || 'Udgam'}
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <span className={`emp-badge emp-badge-${activeSlip.status === 'paid' ? 'success' : 'info'}`} style={{ textTransform: 'uppercase', fontSize: '0.72rem' }}>
                  {activeSlip.status || 'Generated'}
                </span>
                <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)', marginTop: 4 }}>
                  {activeSlip.payableDays} Payable Days
                </div>
              </div>
            </div>

            {/* Attendance & Days Metric */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, textAlign: 'center', background: '#f8fafc', padding: 8, borderRadius: 8, marginBottom: 14, fontSize: '0.75rem' }}>
              <div>
                <div style={{ color: 'var(--emp-text-muted)' }}>Month Days</div>
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
                <div style={{ color: 'var(--emp-primary)' }}>Payable</div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--emp-primary)' }}>{activeSlip.payableDays || 0}</div>
              </div>
            </div>

            {/* Net Pay Banner */}
            <div style={{ background: 'linear-gradient(135deg, #059669, #10b981)', color: '#fff', padding: '16px', borderRadius: 10, textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: '0.75rem', opacity: 0.9, textTransform: 'uppercase' }}>Net Take-Home Salary</div>
              <div style={{ fontSize: '2.2rem', fontWeight: 900, marginTop: 2 }}>
                ₹{Number(activeSlip.netSalary || 0).toLocaleString('en-IN')}
              </div>
              {activeSlip.paidOn && (
                <div style={{ fontSize: '0.72rem', opacity: 0.85, marginTop: 4 }}>
                  Paid on: {new Date(activeSlip.paidOn).toLocaleDateString()}
                </div>
              )}
            </div>

            {/* Earnings & Deductions Breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: '0.82rem' }}>
              {/* Earnings */}
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: 10, borderRadius: 8 }}>
                <div style={{ fontWeight: 700, color: '#15803d', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Earnings (+)</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: 'var(--emp-text-muted)' }}>Basic Salary:</span>
                  <strong>₹{Number(activeSlip.basicSalary || 0).toLocaleString('en-IN')}</strong>
                </div>
                {activeSlip.fuelAllowance > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                    <span style={{ color: 'var(--emp-text-muted)' }}>Fuel Allowance:</span>
                    <strong>₹{Number(activeSlip.fuelAllowance || 0).toLocaleString('en-IN')}</strong>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: 'var(--emp-text-muted)' }}>Other Allowances:</span>
                  <strong>₹{Number(activeSlip.allowances || 0).toLocaleString('en-IN')}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #86efac', paddingTop: 6, marginTop: 4, fontWeight: 800, color: '#15803d' }}>
                  <span>Gross Earnings:</span>
                  <span>₹{Number(activeSlip.grossSalary || (activeSlip.basicSalary + activeSlip.allowances)).toLocaleString('en-IN')}</span>
                </div>
              </div>

              {/* Deductions */}
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: 10, borderRadius: 8 }}>
                <div style={{ fontWeight: 700, color: '#b91c1c', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Deductions (-)</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: 'var(--emp-text-muted)' }}>Absent Deduction (Basic+Fuel):</span>
                  <strong style={{ color: '#dc2626' }}>-₹{Number(activeSlip.absentDeduction || 0).toLocaleString('en-IN')}</strong>
                </div>
                {activeSlip.pfDeduction > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                    <span style={{ color: 'var(--emp-text-muted)' }}>PF:</span>
                    <strong>-₹{Number(activeSlip.pfDeduction).toLocaleString('en-IN')}</strong>
                  </div>
                )}
                {activeSlip.esiDeduction > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                    <span style={{ color: 'var(--emp-text-muted)' }}>ESI:</span>
                    <strong>-₹{Number(activeSlip.esiDeduction).toLocaleString('en-IN')}</strong>
                  </div>
                )}
                {activeSlip.advanceDeduction > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                    <span style={{ color: 'var(--emp-text-muted)' }}>Advance Deduction:</span>
                    <strong>-₹{Number(activeSlip.advanceDeduction).toLocaleString('en-IN')}</strong>
                  </div>
                )}
                {activeSlip.securityDeduction > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                    <span style={{ color: 'var(--emp-text-muted)' }}>Security Cut:</span>
                    <strong>-₹{Number(activeSlip.securityDeduction).toLocaleString('en-IN')}</strong>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #fca5a5', paddingTop: 6, marginTop: 4, fontWeight: 800, color: '#b91c1c' }}>
                  <span>Total Deductions:</span>
                  <span>-₹{Number(activeSlip.deductions || activeSlip.absentDeduction || 0).toLocaleString('en-IN')}</span>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
