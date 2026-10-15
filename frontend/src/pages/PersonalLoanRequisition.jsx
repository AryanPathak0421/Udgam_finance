import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import { DetailList, PageHeader } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { EmployeeSelect } from './NewBorrower.jsx';

const ADMINS = ['super_admin', 'admin'];
const todayISO = () => new Date().toISOString().slice(0, 10);
const inr = (n) => (n === null || n === undefined ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const UNIT_LABEL = { days: 'days', weeks: 'weeks', months: 'months' };

function BorrowerPicker({ branch, value, onPick, error }) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const q = useDebounce(search);

  useEffect(() => {
    if (!branch) return undefined;
    let live = true;
    api.loanRequisitions.borrowers({ branch, q }).then((r) => live && setItems(r.items)).catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [branch, q]);

  return (
    <FormField id="borrower" label="Select borrower" required error={error} hint={!branch ? 'Select the branch first' : undefined}>
      {value ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input id="borrower" value={`${value.code} — ${value.name}`} disabled />
          <button type="button" className="btn sm" onClick={() => { onPick(null); setSearch(''); setOpen(true); }}>Change</button>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <input id="borrower" type="search" placeholder="Search by member code, name or mobile" value={search} disabled={!branch}
            onFocus={() => setOpen(true)} onChange={(e) => { setSearch(e.target.value); setOpen(true); }} autoComplete="off" />
          {open && branch && (
            <div className="panel" style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, maxHeight: 240, overflow: 'auto', marginTop: 4 }}>
              {items.length === 0 ? (
                <div className="muted" style={{ padding: 10 }}>No borrowers found</div>
              ) : (
                items.map((m) => (
                  <button key={m.id} type="button" className="btn" style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, borderRadius: 0 }}
                    onClick={() => { onPick(m); setOpen(false); }}>
                    <strong>{m.code}</strong> — {m.name} <span className="muted">· {m.mobile}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </FormField>
  );
}

export default function PersonalLoanRequisition() {
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = ADMINS.includes(user?.role);

  const [branches, setBranches] = useState([]);
  const [schemes, setSchemes] = useState([]);
  const [form, setForm] = useState({ branch: '', loanDate: todayISO(), employeeCode: '', schemeId: '', amount: '', mode: '', term: '', rate: '' });
  const [picked, setPicked] = useState(null);
  const [detail, setDetail] = useState(null); // auto-fetched borrower details
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [errors, setErrors] = useState({});
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    api.groups.branchOptions().then((r) => {
      setBranches(r.items);
      if (r.items.length === 1) setForm((f) => ({ ...f, branch: r.items[0].id }));
    }).catch(() => {});
    api.loanRequisitions.schemes().then((r) => setSchemes(r.items)).catch(() => {});
  }, []);

  const scheme = schemes.find((s) => s.id === form.schemeId) || null;

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  // A new branch means a different set of borrowers and employees.
  useEffect(() => {
    setPicked(null);
    setDetail(null);
    setForm((f) => ({ ...f, employeeCode: '' }));
  }, [form.branch]);

  async function pick(m) {
    setPicked(m);
    setDetail(null);
    setErrors((er) => ({ ...er, member: undefined }));
    if (!m) return;
    try {
      setDetail(await api.loanRequisitions.borrower(m.id));
    } catch (err) {
      toast.error(err.message);
      setPicked(null);
    }
  }

  function chooseScheme(e) {
    const s = schemes.find((x) => x.id === e.target.value);
    setForm((f) => ({
      ...f,
      schemeId: e.target.value,
      amount: '',
      mode: s && s.modes.length === 1 ? s.modes[0].value : '',
      term: '',
      rate: s ? String(s.roiMin) : '',
    }));
    setErrors((er) => ({ ...er, schemeId: undefined }));
    setPreview(null);
  }

  // Live EMI.
  const debounced = useDebounce(JSON.stringify({ s: form.schemeId, a: form.amount, m: form.mode, t: form.term, r: form.rate }), 400);
  useEffect(() => {
    const { s, a, m, t, r } = JSON.parse(debounced);
    if (!s || !a || !m || !t || r === '') {
      setPreview(null);
      setPreviewError('');
      return;
    }
    const id = ++seq.current;
    api.loanRequisitions
      .preview({ schemeId: s, amount: a, mode: m, term: Number(t), rate: r })
      .then((res) => {
        if (id === seq.current) {
          setPreview(res);
          setPreviewError('');
        }
      })
      .catch((err) => {
        if (id === seq.current) {
          setPreview(null);
          setPreviewError(err.errors?.amount || err.errors?.term || err.errors?.rate || err.errors?.mode || err.message);
        }
      });
  }, [debounced]);

  function review(e) {
    e.preventDefault();
    const found = {};
    if (!form.branch) found.branch = 'Select a branch';
    if (!picked) found.member = 'Select the borrower';
    else if (detail?.issues?.length) found.member = detail.issues[0];
    if (!form.employeeCode) found.employeeCode = 'Select the employee';
    if (!form.schemeId) found.schemeId = 'Select a loan scheme';
    if (!form.amount) found.amount = 'Enter the request amount';
    if (!form.mode) found.mode = 'Select the repayment mode';
    if (!form.term) found.term = 'Enter the number of installments';
    if (form.rate === '') found.rate = 'Enter the interest rate';
    if (!found.amount && !found.term && !found.rate && !found.mode && previewError) found.amount = previewError;
    setErrors(found);
    if (Object.keys(found).length) return toast.error('Please correct the highlighted fields');
    setConfirm(true);
  }

  async function submit() {
    setSaving(true);
    try {
      const r = await api.loanRequisitions.create({
        branch: form.branch,
        loanDate: form.loanDate,
        member: picked.id,
        employeeCode: form.employeeCode,
        schemeId: form.schemeId,
        amount: form.amount,
        mode: form.mode,
        term: Number(form.term),
        rate: form.rate,
      });
      toast.success(`Requisition submitted — ${r.requisition.formId}`);
      navigate('/loan-requisition/list');
    } catch (err) {
      setErrors(err.errors || {});
      setConfirm(false);
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  const b = detail?.borrower;
  const sum = preview?.summary;
  const termLabel = scheme ? UNIT_LABEL[scheme.termUnit] : '';
  const modeUnit = scheme?.modes.find((m) => m.value === form.mode)?.unit;

  return (
    <>
      <PageHeader title="Personal Loan Requisition" description="Choose the borrower and the loan scheme, check the EMI, then confirm and submit." />

      <form onSubmit={review} noValidate>
        <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
          <h3 className="section-title">Requisition</h3>
          <div className="form-grid">
            <FormField id="formid" label="Form ID" hint="Generated automatically on submit">
              <input id="formid" value="Auto" disabled />
            </FormField>
            <FormField id="branch" label="Branch" required error={errors.branch}>
              <select id="branch" value={form.branch} onChange={set('branch')}>
                <option value="">Select branch</option>
                {branches.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}
              </select>
            </FormField>
            <FormField id="loanDate" label="Loan date" error={errors.loanDate} hint={isAdmin ? undefined : 'Today, or up to 30 days back'}>
              <input id="loanDate" type="date" max={todayISO()} value={form.loanDate} onChange={set('loanDate')} />
            </FormField>
            <EmployeeSelect
              branch={form.branch}
              value={form.employeeCode}
              error={errors.employeeCode}
              onChange={(code) => { setForm((f) => ({ ...f, employeeCode: code })); setErrors((er) => ({ ...er, employeeCode: undefined })); }}
            />
            <div className="span-2">
              <BorrowerPicker branch={form.branch} value={picked} onPick={pick} error={errors.member} />
            </div>
          </div>
        </div>

        {picked && (
          <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
            <h3 className="section-title">Borrower details (filled automatically)</h3>
            {!b ? (
              <span className="muted">Loading…</span>
            ) : (
              <>
                {detail.issues.length > 0 && (
                  <div className="notice warn">{detail.issues.map((i) => <div key={i}>{i}</div>)}</div>
                )}
                <DetailList
                  items={[
                    ['Borrower code', b.code], ['Borrower name', b.name], ['Date of birth', b.dob], ['Age', `${b.age} years`],
                    ['Gender', cap(b.gender)], ['Phone', b.mobile], ['Guarantor name', b.guarantorName],
                    ['Previous loan amount', inr(b.previousLoanAmount)], ['Address', b.address],
                    ['Pincode', b.pincode], ['District / State', `${b.district}, ${b.state}`],
                  ]}
                />
              </>
            )}
          </div>
        )}

        <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
          <h3 className="section-title">Scheme detail</h3>
          <div className="form-grid">
            <FormField id="schemeId" label="Loan scheme" required error={errors.schemeId} className="span-2">
              <select id="schemeId" value={form.schemeId} onChange={chooseScheme}>
                <option value="">{schemes.length ? 'Select scheme' : 'No personal loan scheme available'}</option>
                {schemes.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select>
            </FormField>
          </div>

          {scheme && (
            <>
              <div style={{ margin: '12px 0' }}>
                <DetailList
                  items={[
                    ['Amount', `${inr(scheme.amountMin)} – ${inr(scheme.amountMax)}`],
                    ['Term', `${scheme.termMin} – ${scheme.termMax} ${termLabel}`],
                    ['Interest', `${scheme.roiMin}% – ${scheme.roiMax}% p.a. (${scheme.calculationType})`],
                    ['Age', `${scheme.ageMin} – ${scheme.ageMax} years`],
                    ['Repayment', scheme.modes.map((m) => m.label).join(', ')],
                    ['Security', scheme.securityType === 'none' ? 'None' : `${scheme.securityType.replace('_', ' ')} (${scheme.securityPercent}%)`],
                  ]}
                />
              </div>
              <div className="form-grid">
                <FormField id="amount" label="Request amount (₹)" required error={errors.amount}>
                  <input id="amount" inputMode="decimal" value={form.amount} onChange={(e) => { setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })); setErrors((er) => ({ ...er, amount: undefined })); }} />
                </FormField>
                <FormField id="mode" label="Repayment mode" required error={errors.mode}>
                  <select id="mode" value={form.mode} onChange={set('mode')}>
                    <option value="">Select mode</option>
                    {scheme.modes.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </FormField>
                <FormField id="term" label={`Number of installments${modeUnit ? ` (${modeUnit}s)` : ''}`} required error={errors.term}>
                  <input id="term" inputMode="numeric" value={form.term} onChange={(e) => { setForm((f) => ({ ...f, term: e.target.value.replace(/\D/g, '') })); setErrors((er) => ({ ...er, term: undefined })); }} />
                </FormField>
                <FormField id="rate" label="Interest rate (% p.a.)" required error={errors.rate}
                  hint={scheme.roiMin === scheme.roiMax ? 'Fixed by the scheme' : `Between ${scheme.roiMin}% and ${scheme.roiMax}%`}>
                  <input id="rate" inputMode="decimal" value={form.rate} onChange={(e) => { setForm((f) => ({ ...f, rate: e.target.value.replace(/[^\d.]/g, '') })); setErrors((er) => ({ ...er, rate: undefined })); }}
                    disabled={scheme.roiMin === scheme.roiMax} />
                </FormField>
              </div>

              <div style={{ marginTop: 14 }}>
                {previewError && <div className="field-error" role="alert">{previewError}</div>}
                {sum && (
                  <div className="notice ok">
                    <strong>EMI {inr(sum.installmentAmount)}</strong> × {sum.installments} {modeUnit ? `${modeUnit}s` : 'installments'} · Total interest {inr(sum.totalInterest)} · Total payable {inr(sum.totalPayable)}
                    {preview.charges && <> · Processing fee {inr(preview.charges.processingFee)}</>}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" className="btn primary">Review &amp; submit</button>
        </div>
      </form>

      <Modal
        open={confirm}
        title="Confirm loan requisition"
        onClose={() => setConfirm(false)}
        busy={saving}
        footer={
          <>
            <button className="btn" onClick={() => setConfirm(false)} disabled={saving}>Back</button>
            <button className="btn primary" onClick={submit} disabled={saving}>{saving ? 'Submitting…' : 'Confirm & submit'}</button>
          </>
        }
      >
        {picked && scheme && sum && (
          <DetailList
            items={[
              ['Borrower', `${picked.code} — ${picked.name}`], ['Branch', branches.find((x) => x.id === form.branch)?.name],
              ['Loan date', form.loanDate], ['Employee ID', form.employeeCode],
              ['Scheme', `${scheme.code} — ${scheme.name}`], ['Request amount', inr(Number(form.amount))],
              ['Mode & term', `${scheme.modes.find((m) => m.value === form.mode)?.label}, ${form.term} installments`],
              ['Interest rate', `${form.rate}% p.a.`], ['EMI', inr(sum.installmentAmount)], ['Total payable', inr(sum.totalPayable)],
            ]}
          />
        )}
      </Modal>
    </>
  );
}
