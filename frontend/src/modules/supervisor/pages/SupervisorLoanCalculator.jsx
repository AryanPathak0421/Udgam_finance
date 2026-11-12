import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorLoanCalculator() {
  const [schemes, setSchemes] = useState([]);
  const [selectedSchemeId, setSelectedSchemeId] = useState('');
  const [amount, setAmount] = useState(30000);
  const [rate, setRate] = useState(18); // annual %
  const [tenureWeeks, setTenureWeeks] = useState(50);
  const [frequency, setFrequency] = useState('weekly'); // 'weekly' | 'monthly'
  const [calcType, setCalcType] = useState('flat');
  const [securityRate, setSecurityRate] = useState(5); // %
  const [processingRate, setProcessingRate] = useState(2); // %
  const [insuranceRate, setInsuranceRate] = useState(1.5); // %

  useEffect(() => {
    if (api.loanSchemes?.options) {
      api.loanSchemes
        .options()
        .then((res) => {
          const list = res.items || [];
          setSchemes(list);
          if (list.length > 0) {
            handleSchemeSelect(list[0]);
          }
        })
        .catch(() => {});
    }
  }, []);

  const handleSchemeSelect = (scheme) => {
    if (!scheme) return;
    setSelectedSchemeId(scheme.id || scheme._id);
    if (scheme.interestRate !== undefined) setRate(Number(scheme.interestRate));
    if (scheme.term) setTenureWeeks(Number(scheme.term));
    if (scheme.repaymentMode) setFrequency(scheme.repaymentMode.toLowerCase());
    if (scheme.interestType) setCalcType(scheme.interestType.toLowerCase());
    if (scheme.minAmount && amount < scheme.minAmount) setAmount(scheme.minAmount);
    else if (scheme.maxAmount && amount > scheme.maxAmount) setAmount(scheme.maxAmount);

    const sec = scheme.securityDepositBp != null ? (scheme.securityDepositBp / 100) : (scheme.securityDepositPercent != null ? Number(scheme.securityDepositPercent) : 5);
    setSecurityRate(sec);
    const proc = scheme.processingFeeBp != null ? (scheme.processingFeeBp / 100) : (scheme.processingFeePercent != null ? Number(scheme.processingFeePercent) : 2);
    setProcessingRate(proc);
    if (scheme.insurancePercent != null) setInsuranceRate(Number(scheme.insurancePercent));
  };

  const onSchemeChange = (e) => {
    const sId = e.target.value;
    setSelectedSchemeId(sId);
    const found = schemes.find((s) => (s.id || s._id) === sId);
    if (found) handleSchemeSelect(found);
  };

  // Calculation
  const totalPeriods = frequency === 'weekly' ? tenureWeeks : Math.max(1, Math.round(tenureWeeks / 4));
  let emi = 0;
  let totalInterest = 0;
  let totalPayable = 0;

  if (calcType === 'flat') {
    const annualRate = rate / 100;
    totalInterest = Math.round(amount * annualRate * (tenureWeeks / 52));
    totalPayable = amount + totalInterest;
    emi = totalPeriods > 0 ? Math.ceil(totalPayable / totalPeriods) : 0;
  } else {
    const freqPerYear = frequency === 'weekly' ? 52 : 12;
    const r = rate / (freqPerYear * 100);
    if (r === 0) {
      emi = Math.round(amount / totalPeriods);
      totalPayable = amount;
    } else {
      emi = Math.round((amount * r * Math.pow(1 + r, totalPeriods)) / (Math.pow(1 + r, totalPeriods) - 1));
      totalPayable = emi * totalPeriods;
      totalInterest = Math.max(0, totalPayable - amount);
    }
  }

  const processingFee = Math.round((amount * processingRate) / 100);
  const insurance = Math.round((amount * insuranceRate) / 100);
  const security = Math.round((amount * securityRate) / 100);
  const totalDeductions = processingFee + insurance + security;
  const netDisbursed = Math.max(0, amount - totalDeductions);

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Loan EMI Calculator</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>Microfinance Repayment Schedule Estimator</div>
      </div>

      <div className="sup-card" style={{ borderTop: '4px solid var(--sup-primary)' }}>
        {/* Scheme Selector */}
        <div className="sup-input-group">
          <label className="sup-label">Select Loan Scheme</label>
          <select
            className="sup-input"
            value={selectedSchemeId}
            onChange={onSchemeChange}
            style={{ fontWeight: 600, background: '#f8fafc' }}
          >
            <option value="">-- Choose Loan Scheme --</option>
            {schemes.map((s) => (
              <option key={s.id || s._id} value={s.id || s._id}>
                {s.name} ({s.code || s.repaymentMode} • {s.interestRate}% {s.interestType})
              </option>
            ))}
          </select>
        </div>

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
            <label className="sup-label">Tenure ({frequency === 'weekly' ? 'Weeks' : 'Months'})</label>
            <strong style={{ color: 'var(--sup-primary)' }}>
              {frequency === 'weekly' ? `${tenureWeeks} Weeks` : `${totalPeriods} Months`}
            </strong>
          </div>
          <input
            type="range"
            min="12"
            max="104"
            step="1"
            value={tenureWeeks}
            onChange={(e) => setTenureWeeks(Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--sup-primary)' }}
          />
        </div>

        <div className="sup-input-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <label className="sup-label">Security Deposit Amount (₹)</label>
            <strong style={{ color: 'var(--sup-danger)', fontSize: '0.95rem' }}>
              ₹{security.toLocaleString('en-IN')} <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--sup-text-muted)' }}>({securityRate}%)</span>
            </strong>
          </div>
          <input
            type="range"
            min="0"
            max="15"
            step="0.5"
            value={securityRate}
            onChange={(e) => setSecurityRate(Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--sup-danger)' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
          <div className="sup-input-group">
            <label className="sup-label">Frequency</label>
            <select
              className="sup-input"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
            >
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div className="sup-input-group">
            <label className="sup-label">Interest Method</label>
            <select
              className="sup-input"
              value={calcType}
              onChange={(e) => setCalcType(e.target.value)}
            >
              <option value="flat">Flat Interest</option>
              <option value="reducing">Reducing Balance</option>
            </select>
          </div>
        </div>
      </div>

      {/* Result Card */}
      <div
        className="sup-card"
        style={{
          background: 'linear-gradient(135deg, var(--sup-primary), var(--sup-primary-dark))',
          color: '#fff',
          textAlign: 'center',
          padding: '20px 14px',
        }}
      >
        <div style={{ fontSize: '0.8rem', opacity: 0.9, textTransform: 'uppercase' }}>
          Estimated {frequency === 'weekly' ? 'Weekly' : 'Monthly'} EMI
        </div>
        <div style={{ fontSize: '2.4rem', fontWeight: 900, marginTop: 4 }}>
          ₹{emi.toLocaleString('en-IN')}
        </div>
        <div style={{ fontSize: '0.85rem', opacity: 0.85, marginTop: 4 }}>
          Payable over {totalPeriods} {frequency} installments
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 12,
            marginTop: 16,
            paddingTop: 14,
            borderTop: '1px solid rgba(255,255,255,0.2)',
          }}
        >
          <div>
            <div style={{ fontSize: '0.72rem', opacity: 0.85 }}>Total Interest</div>
            <div style={{ fontSize: '1rem', fontWeight: 700 }}>₹{totalInterest.toLocaleString('en-IN')}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', opacity: 0.85 }}>Total Repayable</div>
            <div style={{ fontSize: '1rem', fontWeight: 700 }}>₹{totalPayable.toLocaleString('en-IN')}</div>
          </div>
        </div>
      </div>

      {/* Disbursal Breakdown */}
      <div className="sup-card">
        <h4 style={{ margin: '0 0 10px 0', fontSize: '0.95rem', fontWeight: 700 }}>Disbursement Deductions</h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.82rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--sup-text-muted)' }}>Sanctioned Principal:</span>
            <strong>₹{amount.toLocaleString('en-IN')}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--sup-danger)' }}>
            <span>- Processing Fee ({processingRate}%):</span>
            <strong>-₹{processingFee.toLocaleString('en-IN')}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--sup-danger)' }}>
            <span>- Insurance / Verification ({insuranceRate}%):</span>
            <strong>-₹{insurance.toLocaleString('en-IN')}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--sup-danger)' }}>
            <span>- Security Deposit ({securityRate}%):</span>
            <strong style={{ fontSize: '0.88rem' }}>-₹{security.toLocaleString('en-IN')}</strong>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              borderTop: '1px solid var(--sup-border)',
              paddingTop: 8,
              marginTop: 4,
              fontWeight: 800,
              fontSize: '0.95rem',
              color: 'var(--sup-primary)',
            }}
          >
            <span>Net In-Hand Disbursed:</span>
            <span>₹{netDisbursed.toLocaleString('en-IN')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
