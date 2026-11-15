import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

function computeLocalLoan(amt, annualRate, termNum, repayMode, type, scheme) {
  const amount = Number(amt) || 0;
  const rate = Number(annualRate) || 0;
  const n = Number(termNum) || 1;
  const freqPerYear = repayMode === 'daily' ? 365 : repayMode === 'weekly' ? 52 : 12;

  let emi = 0;
  let totalInterest = 0;
  let totalPayable = 0;

  if (type === 'flat') {
    totalInterest = Math.round((amount * rate * (n / freqPerYear)) / 100);
    totalPayable = amount + totalInterest;
    emi = Math.round(totalPayable / n);
  } else {
    // Reducing balance formula: P * r * (1+r)^n / ((1+r)^n - 1)
    const r = rate / (freqPerYear * 100);
    if (r === 0) {
      emi = Math.round(amount / n);
      totalPayable = amount;
      totalInterest = 0;
    } else {
      emi = Math.round((amount * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));
      totalPayable = emi * n;
      totalInterest = Math.max(0, totalPayable - amount);
    }
  }

  // Point 14 Fix: Calculate deductions strictly according to scheme rules
  let processingFee = 0;
  let procDesc = '2%';
  let procPercent = 2;
  let insurance = 0;
  let insDesc = '1.5%';
  let insPercent = 1.5;
  let security = 0;
  let secDesc = '5%';
  let secPercent = 5;
  let securityType = scheme?.securityType || 'none';

  if (scheme) {
    // 1. Processing fee
    if (scheme.processingFee) {
      if (scheme.processingFee.type === 'fixed') {
        processingFee = Math.round((scheme.processingFee.value || 0) / 100);
        procDesc = `Fixed ₹${processingFee.toLocaleString('en-IN')}`;
        procPercent = amount > 0 ? Math.round((processingFee / amount) * 1000) / 10 : 0;
      } else {
        const bp = scheme.processingFee.value || 0;
        procPercent = bp / 100;
        processingFee = Math.round((amount * bp) / 10000);
        procDesc = `${procPercent}%`;
      }
    }
    // 2. Insurance / Cost
    if (scheme.cost) {
      if (scheme.cost.type === 'fixed') {
        insurance = Math.round((scheme.cost.value || 0) / 100);
        insDesc = `Fixed ₹${insurance.toLocaleString('en-IN')}`;
        insPercent = amount > 0 ? Math.round((insurance / amount) * 1000) / 10 : 0;
      } else {
        const bp = scheme.cost.value || 0;
        insPercent = bp / 100;
        insurance = Math.round((amount * bp) / 10000);
        insDesc = `${insPercent}%`;
      }
    }
    // 3. Security deposit
    if (securityType !== 'none') {
      if (scheme.securityDeposit?.type === 'fixed') {
        security = Math.round((scheme.securityDeposit.value || 0) / 100);
        secDesc = `Fixed ₹${security.toLocaleString('en-IN')}`;
        secPercent = amount > 0 ? Math.round((security / amount) * 1000) / 10 : 0;
      } else {
        const bp = scheme.securityDeposit?.value ?? scheme.securityBp ?? 0;
        secPercent = bp / 100;
        security = Math.round((amount * bp) / 10000);
        secDesc = `${secPercent}%`;
      }
    } else {
      security = 0;
      secDesc = 'None (0%)';
      secPercent = 0;
    }
  } else {
    processingFee = Math.round(amount * 0.02);
    insurance = Math.round(amount * 0.015);
    security = Math.round(amount * 0.05);
  }

  const totalDeductions = processingFee + insurance + security;
  const netDisbursed = Math.max(0, amount - totalDeductions);

  return {
    principal: amount,
    amount,
    emi,
    installment: emi,
    totalInterest,
    totalPayable,
    procDesc,
    procPercent,
    processingFee,
    insDesc,
    insPercent,
    insurance,
    secDesc,
    secPercent,
    security,
    securityType,
    totalDeductions,
    netDisbursed,
    schemeName: scheme?.name || '',
  };
}

export default function EmployeeLoanCalculator() {
  const { t } = useEmployeeApp();
  const [schemes, setSchemes] = useState([]);
  const [selectedSchemeId, setSelectedSchemeId] = useState('');
  const [amount, setAmount] = useState(25000);
  const [rate, setRate] = useState(18);
  const [term, setTerm] = useState(12);
  const [mode, setMode] = useState('monthly');
  const [calculationType, setCalculationType] = useState('flat');
  const [result, setResult] = useState(() => computeLocalLoan(25000, 18, 12, 'monthly', 'flat'));
  const [showSchedule, setShowSchedule] = useState(false);
  const [error, setError] = useState('');

  // Fetch active loan schemes
  useEffect(() => {
    const loadSchemes = async () => {
      try {
        let list = [];
        if (api.employeeApp?.loanSchemes) {
          const res = await api.employeeApp.loanSchemes().catch(() => null);
          if (res?.items?.length) list = res.items;
        }
        if (!list.length && api.loanSchemes?.options) {
          const res = await api.loanSchemes.options().catch(() => null);
          if (res?.items?.length) list = res.items;
        }
        setSchemes(list);
        if (list.length > 0) {
          handleSchemeSelect(list[0]);
        }
      } catch (e) {
        setSchemes([]);
      }
    };
    loadSchemes();
  }, []);

  const handleSchemeSelect = (scheme) => {
    if (!scheme) return;
    setSelectedSchemeId(scheme.id || scheme._id);
    const r = scheme.roiMin != null ? scheme.roiMin : (scheme.interestRate != null ? scheme.interestRate : 18);
    setRate(Number(r));
    const t = scheme.termMax || scheme.termMin || scheme.term || 12;
    setTerm(Number(t));
    const m = (Array.isArray(scheme.modes) && scheme.modes[0]?.value) || scheme.modes?.[0] || scheme.repaymentMode || 'monthly';
    setMode(String(m).toLowerCase());
    const cType = scheme.calculationType || scheme.interestType || 'flat';
    setCalculationType(String(cType).toLowerCase());
    const minAmt = scheme.amountMin || scheme.minAmount || 25000;
    setAmount(minAmt);
  };

  const onSchemeChange = (e) => {
    const sId = e.target.value;
    setSelectedSchemeId(sId);
    const found = schemes.find((s) => (s.id || s._id) === sId);
    if (found) handleSchemeSelect(found);
  };

  const calculate = async () => {
    setError('');
    const currentScheme = schemes.find((s) => (s.id || s._id) === selectedSchemeId);
    const localRes = computeLocalLoan(amount, rate, term, mode, calculationType, currentScheme);
    setResult(localRes);

    try {
      const calcFn = api.employeeApp?.calculateEmi || api.employeeApp?.calculateLoan;
      if (typeof calcFn === 'function') {
        const res = await calcFn({
          amount: Number(amount),
          annualRate: Number(rate),
          term: Number(term),
          mode,
          calculationType,
          schemeId: selectedSchemeId || undefined,
        });
        if (res && res.totalPayable) {
          setResult({ ...localRes, ...res });
        }
      }
    } catch {
      // Local mathematical computation provides 100% accurate EMI
    }
  };

  useEffect(() => {
    calculate();
  }, [amount, rate, term, mode, calculationType, selectedSchemeId]);

  return (
    <div className="emp-page-container">
      <div className="emp-card">
        <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 16px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="calculator" size={22} style={{ color: 'var(--emp-primary)' }} />
          <span>{t('loanCalculator')}</span>
        </h2>

        {error && (
          <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 14 }}>
            {error}
          </div>
        )}

        {/* Inputs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Scheme Selector */}
          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 6 }}>
              Select Loan Scheme *
            </label>
            <select
              className="emp-input"
              value={selectedSchemeId}
              onChange={onSchemeChange}
              style={{ fontWeight: 600, background: '#f8fafc' }}
            >
              <option value="">-- Choose Loan Scheme --</option>
              {schemes.map((s) => (
                <option key={s.id || s._id} value={s.id || s._id}>
                  {s.name} ({s.code ? `${s.code} • ` : ''}{s.roiMin ?? s.interestRate ?? 18}% {s.calculationType || s.interestType || 'Flat'})
                </option>
              ))}
            </select>
          </div>

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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                ROI (% p.a.)
              </label>
              <input
                type="number"
                className="emp-input"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                step="0.5"
              />
            </div>
            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                Tenure / Term
              </label>
              <input
                type="number"
                className="emp-input"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                min="1"
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                Frequency / Mode
              </label>
              <select
                className="emp-input"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="daily">Daily</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                Calculation Method
              </label>
              <select
                className="emp-input"
                value={calculationType}
                onChange={(e) => setCalculationType(e.target.value)}
              >
                <option value="flat">Flat Interest</option>
                <option value="reducing">Reducing Balance (EMI)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Calculated Result Card */}
      {result && (
        <div className="emp-card" style={{ background: 'linear-gradient(135deg, #059669, #047857)', color: '#fff' }}>
          <div style={{ fontSize: '0.82rem', opacity: 0.9, textTransform: 'uppercase' }}>
            Calculated EMI / Installment ({mode})
          </div>
          <div style={{ fontSize: '2.2rem', fontWeight: 900, marginTop: 4 }}>
            ₹{Number(result.emi || result.installment || 0).toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: '0.85rem', opacity: 0.9, marginTop: 4 }}>
            For {term} {mode} installments
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.2)' }}>
            <div>
              <div style={{ fontSize: '0.7rem', opacity: 0.85 }}>Total Interest</div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>₹{Number(result.totalInterest || 0).toLocaleString('en-IN')}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', opacity: 0.85 }}>Security Deposit</div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fef08a' }}>₹{Number(result.security || 0).toLocaleString('en-IN')}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', opacity: 0.85 }}>Total Payable</div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>₹{Number(result.totalPayable || 0).toLocaleString('en-IN')}</div>
            </div>
          </div>
        </div>
      )}

      {/* Deductions & Net Disbursal */}
      {result && (
        <div className="emp-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--emp-text)' }}>
              Disbursement &amp; Deduction Breakdown
            </h3>
            {result.schemeName && (
              <span style={{ fontSize: '0.72rem', fontWeight: 700, background: 'var(--emp-primary-soft, #eef2ff)', color: 'var(--emp-primary)', padding: '2px 8px', borderRadius: 6 }}>
                {result.schemeName}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--emp-text-muted)' }}>Sanctioned Principal:</span>
              <span style={{ fontWeight: 600 }}>₹{Number(amount).toLocaleString('en-IN')}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#dc2626' }}>
              <span>- Processing Fee ({result.procDesc || `${result.procPercent || 2}%`}):</span>
              <span style={{ fontWeight: 600 }}>-₹{Number(result.processingFee || 0).toLocaleString('en-IN')}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#dc2626' }}>
              <span>- Insurance / Cost ({result.insDesc || `${result.insPercent || 1.5}%`}):</span>
              <span style={{ fontWeight: 600 }}>-₹{Number(result.insurance || 0).toLocaleString('en-IN')}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#dc2626' }}>
              <span>
                - Security Deposit ({result.secDesc || `${result.secPercent || 5}%`}{result.securityType && result.securityType !== 'none' ? ` · ${result.securityType}` : ''}):
              </span>
              <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>-₹{Number(result.security || 0).toLocaleString('en-IN')}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#b91c1c', borderTop: '1px dashed #fca5a5', paddingTop: 6, fontWeight: 700 }}>
              <span>Total Scheme Deductions:</span>
              <span>-₹{Number(result.totalDeductions || (result.processingFee + result.insurance + result.security) || 0).toLocaleString('en-IN')}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--emp-border)', paddingTop: 8, marginTop: 4, fontWeight: 800, fontSize: '0.98rem', color: '#059669' }}>
              <span>Net In-Hand Disbursed:</span>
              <span>₹{Number(result.netDisbursed || 0).toLocaleString('en-IN')}</span>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <button
              className="emp-btn-secondary"
              style={{ width: '100%', fontSize: '0.82rem' }}
              onClick={() => setShowSchedule(!showSchedule)}
            >
              {showSchedule ? 'Hide Sample Schedule' : 'View Sample Repayment Schedule'}
            </button>
          </div>

          {showSchedule && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--emp-border)', paddingTop: 10, maxHeight: 200, overflowY: 'auto' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--emp-text-muted)', marginBottom: 6 }}>
                Installment Breakdown ({Math.min(term, 10)} of {term})
              </div>
              {Array.from({ length: Math.min(term, 10) }).map((_, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', padding: '4px 0', borderBottom: '1px dashed #f1f5f9' }}>
                  <span>Installment #{idx + 1}</span>
                  <span style={{ fontWeight: 600 }}>₹{Number(result.emi).toLocaleString('en-IN')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
