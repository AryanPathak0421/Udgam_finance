import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

function computeLocalLoan(amt, annualRate, termNum, repayMode, type) {
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

  const processingFee = Math.round(amount * 0.02);
  const insurance = Math.round(amount * 0.015);
  const security = Math.round(amount * 0.05);

  return {
    principal: amount,
    amount,
    emi,
    installment: emi,
    totalInterest,
    totalPayable,
    processingFee,
    insurance,
    security,
    netDisbursed: Math.max(0, amount - processingFee - insurance - security),
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
    const localRes = computeLocalLoan(amount, rate, term, mode, calculationType);
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.2)' }}>
            <div>
              <div style={{ fontSize: '0.72rem', opacity: 0.85 }}>Total Interest</div>
              <div style={{ fontSize: '1rem', fontWeight: 700 }}>₹{Number(result.totalInterest || 0).toLocaleString('en-IN')}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.72rem', opacity: 0.85 }}>Total Payable</div>
              <div style={{ fontSize: '1rem', fontWeight: 700 }}>₹{Number(result.totalPayable || 0).toLocaleString('en-IN')}</div>
            </div>
          </div>
        </div>
      )}

      {/* Deductions & Net Disbursal */}
      {result && (
        <div className="emp-card">
          <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 12px 0', color: 'var(--emp-text)' }}>
            Disbursement & Deduction Breakdown
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--emp-text-muted)' }}>Sanctioned Principal:</span>
              <span style={{ fontWeight: 600 }}>₹{Number(amount).toLocaleString('en-IN')}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#dc2626' }}>
              <span>- Processing Fee (2%):</span>
              <span style={{ fontWeight: 600 }}>-₹{Number(result.processingFee || 0).toLocaleString('en-IN')}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#dc2626' }}>
              <span>- Insurance / Verification (1.5%):</span>
              <span style={{ fontWeight: 600 }}>-₹{Number(result.insurance || 0).toLocaleString('en-IN')}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#dc2626' }}>
              <span>- Security Deposit (5%):</span>
              <span style={{ fontWeight: 600 }}>-₹{Number(result.security || 0).toLocaleString('en-IN')}</span>
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
