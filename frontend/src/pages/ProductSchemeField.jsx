import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import FormField from '../components/ui/FormField.jsx';
import useDebounce from '../hooks/useDebounce.js';

const inr = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

// The product on top of a loan is financed under a product loan scheme (any active one). It is repaid with the installments of the loan, so the
// loan's mode and number of installments are used; the scheme gives the calculation, the amount range and the rate range (the loan's rate is kept inside it).
export function ProductSchemeField({ id, code, schemes, mode, term, rate, value, schemeId, onChange, error }) {
  const scheme = schemes.find((s) => s.id === schemeId);
  const useRate = scheme ? Math.min(Math.max(Number(rate) || 0, scheme.roiMin), scheme.roiMax) : 0;
  const [emi, setEmi] = useState(null);
  const [emiError, setEmiError] = useState('');
  const key = JSON.stringify([schemeId, mode, term, useRate, value]);
  const debounced = useDebounce(key, 400);
  useEffect(() => {
    const [sid, m, t, r, v] = JSON.parse(debounced);
    if (!sid || !m || !t || !(v > 0)) { setEmi(null); setEmiError(''); return; }
    api.loanRequisitions.productPreview({ schemeId: sid, value: v, mode: m, term: Number(t), rate: r })
      .then((res) => { setEmi(res); setEmiError(''); })
      .catch((err) => { setEmi(null); setEmiError(err.errors?.additional || err.message); });
  }, [debounced]);
  return (
    <div style={{ marginTop: 8 }}>
      <FormField id={id} label={`Product loan scheme${code ? ` of ${code}` : ''}`} required error={error}
        hint={schemes.length ? `Repaid with the loan's installments (${term || '—'}); rate ${scheme ? `${useRate}% within the scheme` : 'of the loan, within the scheme'}` : 'There is no active product loan scheme. Add one under Loan Scheme (type: Product loan).'}>
        <select id={id} value={schemeId} onChange={(ev) => onChange(ev.target.value)}>
          <option value="">Select product loan scheme</option>
          {schemes.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
        </select>
      </FormField>
      {emiError && <div className="field-error" role="alert">{emiError}</div>}
      {emi && <div className="notice ok" style={{ marginTop: 6 }}>Product loan: <strong>EMI {inr(emi.installmentAmount)}</strong> × {emi.installments} = {inr(emi.totalPayable)} ({emi.schemeName}, {emi.rate}%). Added to each installment of the loan.</div>}
    </div>
  );
}
