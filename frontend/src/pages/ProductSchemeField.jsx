import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import FormField from '../components/ui/FormField.jsx';
import useDebounce from '../hooks/useDebounce.js';

const inr = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

// The product on top of a loan is financed under a product loan scheme. It is repaid with the installments of the loan, so the loan's
// mode and number of installments are used; the rate is the loan's, kept inside the scheme's range.
export function ProductSchemeField({ id, code, schemes, mode, term, rate, value, schemeId, onChange, error }) {
  const options = schemes.filter((s) => s.modes.some((m) => m.value === mode));
  const scheme = options.find((s) => s.id === schemeId);
  const useRate = scheme ? Math.min(Math.max(Number(rate) || 0, scheme.roiMin), scheme.roiMax) : 0;
  const [emi, setEmi] = useState(null);
  const [emiError, setEmiError] = useState('');
  const key = JSON.stringify([schemeId, mode, term, useRate, value]);
  const debounced = useDebounce(key, 400);
  useEffect(() => {
    const [sid, m, t, r, v] = JSON.parse(debounced);
    if (!sid || !m || !t || !(v > 0)) { setEmi(null); setEmiError(''); return; }
    api.loanRequisitions.preview({ schemeId: sid, amount: String(v), mode: m, term: Number(t), rate: String(r) })
      .then((res) => { setEmi(res); setEmiError(''); })
      .catch((err) => { setEmi(null); setEmiError(err.errors?.amount || err.errors?.term || err.errors?.rate || err.errors?.mode || err.message); });
  }, [debounced]);
  return (
    <div style={{ marginTop: 8 }}>
      <FormField id={id} label={`Product loan scheme${code ? ` of ${code}` : ''}`} required error={error}
        hint={options.length ? `Repaid with the loan's installments (${term || '—'}); rate ${scheme ? `${useRate}% within the scheme` : 'of the loan, within the scheme'}` : 'No product loan scheme allows this repayment mode'}>
        <select id={id} value={schemeId} onChange={(ev) => onChange(ev.target.value)}>
          <option value="">Select product loan scheme</option>
          {options.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
        </select>
      </FormField>
      {emiError && <div className="field-error" role="alert">{emiError}</div>}
      {emi && <div className="notice ok" style={{ marginTop: 6 }}>Product loan: <strong>EMI {inr(emi.summary.installmentAmount)}</strong> × {emi.summary.installments} = {inr(emi.summary.totalPayable)} ({scheme?.name}, {useRate}%). Added to each installment of the loan.</div>}
    </div>
  );
}
