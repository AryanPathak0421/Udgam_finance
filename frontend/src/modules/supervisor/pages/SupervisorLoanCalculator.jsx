import React, { useState } from 'react';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorLoanCalculator() {
  const [amount, setAmount] = useState(30000);
  const [rate, setRate] = useState(18); // annual %
  const [tenureWeeks, setTenureWeeks] = useState(50);
  const [frequency, setFrequency] = useState('weekly'); // 'weekly' | 'monthly'

  // Flat or reducing EMI calculation
  const totalPeriods = frequency === 'weekly' ? tenureWeeks : Math.round(tenureWeeks / 4);
  const annualRate = rate / 100;
  const totalInterest = Math.round(amount * annualRate * (tenureWeeks / 52));
  const totalPayable = amount + totalInterest;
  const emi = totalPeriods > 0 ? Math.ceil(totalPayable / totalPeriods) : 0;

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Loan EMI Calculator</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>Microfinance Repayment Schedule Estimator</div>
      </div>

      <div className="sup-card" style={{ borderTop: '4px solid var(--sup-primary)' }}>
        <div className="sup-input-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <label className="sup-label">Loan Amount (₹)</label>
            <strong style={{ color: 'var(--sup-primary)' }}>₹{Number(amount).toLocaleString('en-IN')}</strong>
          </div>
          <input
            type="range"
            min="5000"
            max="150000"
            step="1000"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--sup-primary)' }}
          />
        </div>

        <div className="sup-input-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <label className="sup-label">Annual Interest Rate (%)</label>
            <strong style={{ color: 'var(--sup-primary)' }}>{rate}% p.a.</strong>
          </div>
          <input
            type="range"
            min="8"
            max="30"
            step="0.5"
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--sup-primary)' }}
          />
        </div>

        <div className="sup-input-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <label className="sup-label">Tenure (Weeks)</label>
            <strong style={{ color: 'var(--sup-primary)' }}>{tenureWeeks} Weeks</strong>
          </div>
          <input
            type="range"
            min="12"
            max="104"
            step="2"
            value={tenureWeeks}
            onChange={(e) => setTenureWeeks(Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--sup-primary)' }}
          />
        </div>

        <div className="sup-input-group">
          <label className="sup-label">Repayment Frequency</label>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className={`sup-btn sm ${frequency === 'weekly' ? '' : 'secondary'}`}
              onClick={() => setFrequency('weekly')}
            >
              Weekly
            </button>
            <button
              type="button"
              className={`sup-btn sm ${frequency === 'monthly' ? '' : 'secondary'}`}
              onClick={() => setFrequency('monthly')}
            >
              Monthly
            </button>
          </div>
        </div>
      </div>

      {/* Result Card */}
      <div className="sup-card" style={{ background: 'linear-gradient(135deg, #042f2e 0%, #0f766e 100%)', color: '#fff' }}>
        <div style={{ fontSize: '0.82rem', opacity: 0.85, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>
          ESTIMATED {frequency.toUpperCase()} INSTALLMENT
        </div>
        <div style={{ fontSize: '2rem', fontWeight: 900, marginTop: 4 }}>
          ₹{emi.toLocaleString('en-IN')}
          <span style={{ fontSize: '0.85rem', fontWeight: 500, opacity: 0.8 }}> / {frequency === 'weekly' ? 'week' : 'month'}</span>
        </div>

        <div style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: 12, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <div>
            <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>Principal Amount</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>₹{amount.toLocaleString('en-IN')}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>Total Interest</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>₹{totalInterest.toLocaleString('en-IN')}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>Total Payable</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>₹{totalPayable.toLocaleString('en-IN')}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>No. of Installments</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{totalPeriods}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
