import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import FormField from '../../components/ui/FormField.jsx';
import { ErrorState, PageHeader, Spinner } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { formatDate, formatINR, todayIso } from '../../utils/format.js';

const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
const UNIT_PLURAL = { day: 'days', week: 'weeks', fortnight: 'fortnights', month: 'months', quarter: 'quarters', 'half-year': 'half-years', year: 'years' };
const SECURITY_LABEL = { none: 'None', group_guarantee: 'Group guarantee', guarantor: 'Personal guarantor', fixed_deposit: 'Fixed deposit lien', gold: 'Gold', property: 'Property', vehicle: 'Vehicle' };

function toCsv(result) {
  const head = ['No', 'Due date', 'Principal', 'Interest', 'Installment', 'Balance'];
  const rows = result.schedule.map((r) => [r.no, r.dueDate, r.principal.toFixed(2), r.interest.toFixed(2), r.installment.toFixed(2), r.balance.toFixed(2)]);
  return [head, ...rows].map((r) => r.join(',')).join('\n');
}

export default function LoanCalculator() {
  const toast = useToast();
  const [options, setOptions] = useState(null);
  const [schemes, setSchemes] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState({
    schemeId: '',
    calculationType: 'flat',
    emiType: 'equal',
    mode: 'monthly',
    amount: '',
    rate: '',
    term: '',
    startDate: todayIso(),
  });
  const [errors, setErrors] = useState({});
  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    Promise.all([api.loanCalculator.options(), api.loanSchemes.options()])
      .then(([o, s]) => {
        setOptions(o);
        setSchemes(s.items);
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  const scheme = schemes.find((s) => s.id === form.schemeId) || null;
  const allowedModes = useMemo(
    () => (options ? options.modes.filter((m) => !scheme || scheme.modes.includes(m.value)) : []),
    [options, scheme]
  );
  const mode = allowedModes.find((m) => m.value === form.mode) || allowedModes[0];
  const unit = mode ? UNIT_PLURAL[mode.unit] : 'installments';
  const calcType = scheme ? scheme.calculationType : form.calculationType;
  const emiType = calcType === 'flat' ? 'equal' : scheme ? scheme.emiType : form.emiType;

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  // Choosing a scheme applies its rules: calculation, EMI type, and only its loan modes.
  function chooseScheme(e) {
    const id = e.target.value;
    const s = schemes.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      schemeId: id,
      calculationType: s ? s.calculationType : f.calculationType,
      emiType: s ? s.emiType : f.emiType,
      mode: s && !s.modes.includes(f.mode) ? s.modes[0] : f.mode,
    }));
    setErrors({});
    setResult(null);
  }

  async function onSubmit(e) {
    e.preventDefault();
    const found = {};
    const amount = form.amount.trim();
    const rate = form.rate.trim();
    const term = form.term.trim();
    if (!MONEY_RE.test(amount) || Number(amount) < 1) found.amount = 'Enter a loan amount (up to 2 decimals)';
    if (!MONEY_RE.test(rate) || Number(rate) > 100) found.rate = 'Enter an annual rate from 0 to 100';
    if (!/^\d+$/.test(term) || Number(term) < 1) found.term = `Enter the number of ${unit}`;
    else if (!found.amount && Number(amount) < Number(term)) found.amount = `Amount must be at least ₹${term} (₹1 per installment)`;
    if (!form.startDate) found.startDate = 'Select the disbursement date';
    setErrors(found);
    if (Object.keys(found).length) return;

    setCalculating(true);
    try {
      setResult(
        await api.loanCalculator.calculate({
          ...form,
          calculationType: calcType,
          emiType,
          mode: mode.value,
          amount,
          rate,
          term: Number(term),
        })
      );
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setCalculating(false);
    }
  }

  function download() {
    const blob = new Blob([toCsv(result)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `loan-schedule-${result.input.mode}-${result.input.calculationType}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loadError) return <ErrorState message={loadError} />;
  if (!options) return <Spinner label="Loading calculator…" />;

  const s = result?.summary;
  const declining = result?.input.emiType === 'equal_principal';
  const totals = result && {
    principal: result.schedule.reduce((a, r) => a + r.principal, 0),
    interest: result.schedule.reduce((a, r) => a + r.interest, 0),
    installment: result.schedule.reduce((a, r) => a + r.installment, 0),
  };

  return (
    <>
      <PageHeader
        title="Loan Calculator"
        description="Work out the installment, total interest and repayment schedule, optionally under a loan scheme's rules."
      />

      <form className="panel" onSubmit={onSubmit} noValidate>
        <div className="form-grid calc-grid">
          <FormField
            id="schemeId"
            label="Loan scheme (optional)"
            error={errors.schemeId}
            className="span-3"
            hint={
              scheme
                ? `${scheme.name}: ₹${scheme.amountMin} – ₹${scheme.amountMax} · ${scheme.termMin}–${scheme.termMax} ${scheme.termUnit} · ROI ${scheme.roiMin}–${scheme.roiMax}% · age ${scheme.ageMin}–${scheme.ageMax}`
                : 'Pick a scheme to apply its calculation type, loan modes and limits.'
            }
          >
            <select id="schemeId" value={form.schemeId} onChange={chooseScheme}>
              <option value="">No scheme — free calculation</option>
              {schemes.map((x) => (
                <option key={x.id} value={x.id}>{x.code} — {x.name}</option>
              ))}
            </select>
          </FormField>

          <FormField id="calculationType" label="Calculation type" required error={errors.calculationType} hint={scheme ? 'Set by the scheme' : undefined}>
            <select id="calculationType" value={calcType} onChange={set('calculationType')} disabled={Boolean(scheme)}>
              {options.calculationTypes.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </FormField>
          <FormField id="emiType" label="EMI type" error={errors.emiType} hint={calcType === 'flat' ? 'Flat loans have equal installments' : scheme ? 'Set by the scheme' : undefined}>
            <select id="emiType" value={emiType} onChange={set('emiType')} disabled={calcType === 'flat' || Boolean(scheme)}>
              {options.emiTypes.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </FormField>
          <FormField id="mode" label="Loan mode" required error={errors.mode}>
            <select id="mode" value={mode?.value || ''} onChange={set('mode')}>
              {allowedModes.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </FormField>
          <FormField id="amount" label="Loan amount (₹)" required error={errors.amount}>
            <input id="amount" inputMode="decimal" value={form.amount} onChange={set('amount')} placeholder="e.g. 50000" autoFocus />
          </FormField>
          <FormField id="rate" label="Interest rate (% per year)" required error={errors.rate}>
            <input id="rate" inputMode="decimal" value={form.rate} onChange={set('rate')} placeholder="e.g. 24" />
          </FormField>
          <FormField
            id="term"
            label={`Term (number of ${unit})`}
            required
            error={errors.term}
            hint={`One installment every ${mode?.unit || 'period'}. Max ${options.limits.maxInstallments} installments / ${options.limits.maxYears} years.`}
          >
            <input id="term" inputMode="numeric" value={form.term} onChange={set('term')} placeholder={mode?.value === 'daily' ? 'e.g. 100' : 'e.g. 12'} />
          </FormField>
          <FormField id="startDate" label="Disbursement date" required error={errors.startDate} hint="First installment falls one period after this date">
            <input id="startDate" type="date" value={form.startDate} onChange={set('startDate')} />
          </FormField>
        </div>
        <div className="form-actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setForm((f) => ({ ...f, amount: '', rate: '', term: '' }));
              setResult(null);
              setErrors({});
            }}
          >
            Reset
          </button>
          <button className="btn primary" type="submit" disabled={calculating}>
            {calculating ? 'Calculating…' : 'Calculate'}
          </button>
        </div>
      </form>

      {result && (
        <>
          <section className="stat-grid" style={{ marginTop: 16 }}>
            <div className="stat-card">
              <div>
                <div className="stat-label">{declining ? 'First installment' : `${result.input.modeLabel} installment`}</div>
                <div className="stat-value">{formatINR(s.installmentAmount)}</div>
                {s.lastInstallmentAmount !== s.installmentAmount && (
                  <div className="muted small">Last: {formatINR(s.lastInstallmentAmount)}</div>
                )}
              </div>
            </div>
            <div className="stat-card">
              <div>
                <div className="stat-label">Number of installments</div>
                <div className="stat-value">{s.installments}</div>
              </div>
            </div>
            <div className="stat-card">
              <div>
                <div className="stat-label">Total interest</div>
                <div className="stat-value">{formatINR(s.totalInterest)}</div>
              </div>
            </div>
            <div className="stat-card">
              <div>
                <div className="stat-label">Total payable</div>
                <div className="stat-value">{formatINR(s.totalPayable)}</div>
              </div>
            </div>
          </section>

          {result.charges && (
            <div className="panel" style={{ marginTop: 16 }}>
              <h3 style={{ margin: '0 0 10px' }}>
                Scheme charges — {result.input.scheme.code} · {result.input.scheme.name}
              </h3>
              <div className="charge-row">
                <div><span className="muted small">Processing fee</span><strong>{formatINR(result.charges.processingFee)}</strong></div>
                <div><span className="muted small">Cost</span><strong>{formatINR(result.charges.cost)}</strong></div>
                <div>
                  <span className="muted small">Security ({SECURITY_LABEL[result.charges.securityType]})</span>
                  <strong>{formatINR(result.charges.securityAmount)}</strong>
                </div>
              </div>
            </div>
          )}

          <div className="panel" style={{ marginTop: 16 }}>
            <div className="calc-head">
              <div>
                <h3 style={{ margin: 0 }}>Repayment schedule</h3>
                <div className="muted small">
                  {result.input.calculationType === 'flat' ? 'Flat' : declining ? 'Reducing balance, equal principal' : 'Reducing balance, EMI'} ·{' '}
                  {formatINR(result.input.amount)} @ {result.input.rate}% p.a. · {formatDate(s.firstDueDate)} to {formatDate(s.lastDueDate)}
                </div>
              </div>
              <button className="btn" onClick={download}>Download CSV</button>
            </div>

            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Due date</th>
                    <th className="num">Principal</th>
                    <th className="num">Interest</th>
                    <th className="num">Installment</th>
                    <th className="num">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {result.schedule.map((r) => (
                    <tr key={r.no}>
                      <td data-label="#">{r.no}</td>
                      <td data-label="Due date">{formatDate(r.dueDate)}</td>
                      <td data-label="Principal" className="num">{formatINR(r.principal)}</td>
                      <td data-label="Interest" className="num">{formatINR(r.interest)}</td>
                      <td data-label="Installment" className="num"><strong>{formatINR(r.installment)}</strong></td>
                      <td data-label="Balance" className="num">{formatINR(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}><strong>Total</strong></td>
                    <td className="num"><strong>{formatINR(totals.principal)}</strong></td>
                    <td className="num"><strong>{formatINR(totals.interest)}</strong></td>
                    <td className="num"><strong>{formatINR(totals.installment)}</strong></td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
