import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';

export default function EmployeeLoanCalculator() {
  const { t } = useEmployeeApp();
  const [amount, setAmount] = useState(25000);
  const [rate, setRate] = useState(18);
  const [term, setTerm] = useState(12);
  const [mode, setMode] = useState('monthly');
  const [calculationType, setCalculationType] = useState('flat');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [error, setError] = useState('');

  const calculate = async () => {
    setLoading(true);
    setError('');
    try {
      // Use employeeApp endpoint or loanCalculator
      const res = await api.employeeApp.calculateEmi({
        amount: Number(amount),
        annualRate: Number(rate),
        term: Number(term),
        mode,
        calculationType
      });
      setResult(res);
    } catch (err) {
      setError(err.message || 'Calculation error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    calculate();
  }, [amount, rate, term, mode, calculationType]);

  return (
    <div className="emp-page-container">
      <div className="emp-card">
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 16px 0', color: 'var(--emp-text)' }}>
          🧮 {t('loanCalculator')}
        </h2>

        {error && (
          <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 14 }}>
            {error}
          </div>
        )}

        {/* Inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)' }}>Loan Amount (₹)</label>
              <span style={{ fontWeight: 700, color: 'var(--emp-primary)' }}>₹{Number(amount).toLocaleString('en-IN')}</span>
            </div>
            <input
              type="number"
              className="emp-input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="1000"
              step="500"
            />
            <input
              type="range"
              min="5000"
              max="200000"
              step="1000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={{ width: '100%', marginTop: 6 }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                Rate of Interest (% p.a.)
              </label>
              <input
                type="number"
                className="emp-input"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                min="0"
                max="50"
                step="0.5"
              />
            </div>
            <div>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                Term ({mode === 'daily' ? 'Days' : mode === 'weekly' ? 'Weeks' : 'Months'})
              </label>
              <input
                type="number"
                className="emp-input"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                min="1"
                max="120"
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                Repayment Mode
              </label>
              <select className="emp-input" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                Interest Method
              </label>
              <select className="emp-input" value={calculationType} onChange={(e) => setCalculationType(e.target.value)}>
                <option value="flat">Flat Rate</option>
                <option value="reducing">Reducing Balance</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Result Cards */}
      {result && (
        <>
          <div className="emp-card" style={{ background: 'linear-gradient(135deg, #1e3a8a, #2563eb)', color: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '0.8rem', opacity: 0.9, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Installment / EMI
                </div>
                <div style={{ fontSize: '1.8rem', fontWeight: 800, marginTop: 4 }}>
                  ₹{Number(result.emi).toLocaleString('en-IN')}
                  <span style={{ fontSize: '0.85rem', fontWeight: 500, opacity: 0.85 }}> / {mode}</span>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.8rem', opacity: 0.9 }}>Total Repayable</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>
                  ₹{Number(result.totalPayable).toLocaleString('en-IN')}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.2)' }}>
              <div>
                <div style={{ fontSize: '0.72rem', opacity: 0.85 }}>Principal</div>
                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>₹{Number(result.principal).toLocaleString('en-IN')}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', opacity: 0.85 }}>Total Interest</div>
                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>₹{Number(result.totalInterest).toLocaleString('en-IN')}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', opacity: 0.85 }}>Net Disbursed</div>
                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>₹{Number(result.netDisbursed || result.principal).toLocaleString('en-IN')}</div>
              </div>
            </div>
          </div>

          {/* Schedule view toggle */}
          {result.schedule && result.schedule.length > 0 && (
            <div className="emp-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: 'var(--emp-text)' }}>
                  Repayment Schedule ({result.schedule.length} Installments)
                </h3>
                <button
                  type="button"
                  className="emp-btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                  onClick={() => setShowSchedule(!showSchedule)}
                >
                  {showSchedule ? 'Hide Schedule' : 'Show Schedule'}
                </button>
              </div>

              {showSchedule && (
                <div style={{ overflowX: 'auto', marginTop: 12 }}>
                  <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: 'var(--emp-card-bg)', borderBottom: '1px solid var(--emp-border)', color: 'var(--emp-text-muted)' }}>
                        <th style={{ padding: '8px 6px' }}>#</th>
                        <th style={{ padding: '8px 6px' }}>Due Date</th>
                        <th style={{ padding: '8px 6px' }}>EMI</th>
                        <th style={{ padding: '8px 6px' }}>Prin.</th>
                        <th style={{ padding: '8px 6px' }}>Int.</th>
                        <th style={{ padding: '8px 6px' }}>Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.schedule.map((row) => (
                        <tr key={row.installmentNo} style={{ borderBottom: '1px solid var(--emp-border)' }}>
                          <td style={{ padding: '8px 6px', fontWeight: 600 }}>{row.installmentNo}</td>
                          <td style={{ padding: '8px 6px' }}>{row.dueDate}</td>
                          <td style={{ padding: '8px 6px', fontWeight: 600, color: 'var(--emp-primary)' }}>₹{row.emi}</td>
                          <td style={{ padding: '8px 6px' }}>₹{row.principal}</td>
                          <td style={{ padding: '8px 6px' }}>₹{row.interest}</td>
                          <td style={{ padding: '8px 6px' }}>₹{row.balance}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

