import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import { DetailList, PageHeader } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { EmployeeSelect, PhotoField } from './NewBorrower.jsx';
import { ProductSchemeField } from './ProductSchemeField.jsx';
import { Search, GroupTopUp } from './PersonalLoanRequisition.jsx';

const todayISO = () => new Date().toISOString().slice(0, 10);
const inr = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const EXTRA_PERCENT = 25;
// Days in one term unit / one repayment period (the same 30-day month the scheme limits use).
const UNIT_DAYS = { days: 1, weeks: 7, months: 30 };
const MODE_DAYS = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, quarterly: 90, halfyearly: 180, yearly: 360 };
const installmentsFor = (s, mode) => Math.max(1, Math.round((s.termMin * UNIT_DAYS[s.termUnit]) / MODE_DAYS[mode]));
const blank = { schemeId: '', amount: '', mode: '', term: '', rate: '', front: '', back: '', extraId: '', extraQty: '1', extraScheme: '' };
const eligible = (m) => !m.isBlocked && !m.runningInGroup && !(m.issues && m.issues.length);

// One member's loan: her own scheme, amount, mode, installments and rate, application form photos and an optional product.
function MemberLoan({ index, m, e, schemes, productSchemes, stock, errors, onChange, onPreview }) {
  const scheme = schemes.find((s) => s.id === e.schemeId);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const debounced = useDebounce(JSON.stringify({ s: e.schemeId, a: e.amount, m: e.mode, t: e.term, r: e.rate }), 400);

  useEffect(() => {
    const x = JSON.parse(debounced);
    if (!x.s || !x.a || !x.m || !x.t || x.r === '') {
      setPreview(null);
      setPreviewError('');
      onPreview(null);
      return;
    }
    api.loanRequisitions.preview({ schemeId: x.s, amount: x.a, mode: x.m, term: Number(x.t), rate: x.r })
      .then((res) => { setPreview(res); setPreviewError(''); onPreview(res); })
      .catch((err) => { setPreview(null); setPreviewError(err.errors?.amount || err.errors?.term || err.errors?.rate || err.errors?.mode || err.message); onPreview(null); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  function chooseScheme(ev) {
    const s = schemes.find((x) => x.id === ev.target.value);
    onChange(s ? { schemeId: s.id, amount: String(s.amountMin), mode: s.modes[0].value, term: String(installmentsFor(s, s.modes[0].value)), rate: String(s.roiMin) } : { schemeId: '', amount: '', mode: '', term: '', rate: '' });
  }
  const err = (f) => errors?.[`entries.${m.id}.${f}`];
  const extraProduct = stock.find((p) => p.id === e.extraId);
  const extraValue = extraProduct ? Math.round(extraProduct.unitPrice * (Number(e.extraQty) || 0) * 100) / 100 : 0;
  const extraMax = Math.floor((Number(e.amount) || 0) * EXTRA_PERCENT) / 100;
  const sum = preview?.summary;

  return (
    <div className="panel" style={{ padding: 16, marginBottom: 14 }}>
      <h3 className="section-title">{index + 1}. {m.code} — {m.name}</h3>
      <div className="muted small" style={{ marginBottom: 8 }}>Guarantor {m.guarantorName || '—'} · Previous loan {inr(m.previousLoan)} · Civil score {m.civilScore ?? 'not recorded'}</div>
      {err('member') && <div className="field-error" role="alert">{err('member')}</div>}
      <div className="form-grid">
        <FormField id={`sch-${m.id}`} label="Loan scheme" required error={err('schemeId')}>
          <select id={`sch-${m.id}`} value={e.schemeId} onChange={chooseScheme}>
            <option value="">Select loan scheme</option>
            {schemes.filter((s) => !m.runningSchemeIds?.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
          </select>
        </FormField>
        <FormField id={`amt-${m.id}`} label="Loan amount (₹)" required error={err('amount')} hint={scheme ? `Between ${inr(scheme.amountMin)} and ${inr(scheme.amountMax)}` : 'Choose the scheme first'}>
          <input id={`amt-${m.id}`} inputMode="decimal" value={e.amount} disabled={!scheme} onChange={(ev) => onChange({ amount: ev.target.value.replace(/[^\d.]/g, '') })} />
        </FormField>
        {scheme && (
          <>
            <FormField id={`mode-${m.id}`} label="Repayment mode" required error={err('mode')}>
              <select id={`mode-${m.id}`} value={e.mode} onChange={(ev) => onChange({ mode: ev.target.value, term: String(installmentsFor(scheme, ev.target.value)) })}>
                {scheme.modes.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              </select>
            </FormField>
            <FormField id={`term-${m.id}`} label="Installments" required error={err('term')} hint={`Loan term ${scheme.termMin} to ${scheme.termMax} ${scheme.termUnit}`}>
              <input id={`term-${m.id}`} inputMode="numeric" value={e.term} onChange={(ev) => onChange({ term: ev.target.value.replace(/\D/g, '').slice(0, 4) })} />
            </FormField>
            <FormField id={`rate-${m.id}`} label="Interest rate (% p.a.)" required error={err('rate')} hint={scheme.roiMin === scheme.roiMax ? 'Fixed by the scheme' : `Between ${scheme.roiMin}% and ${scheme.roiMax}%`}>
              <input id={`rate-${m.id}`} inputMode="decimal" value={e.rate} disabled={scheme.roiMin === scheme.roiMax} onChange={(ev) => onChange({ rate: ev.target.value.replace(/[^\d.]/g, '') })} />
            </FormField>
          </>
        )}
        <PhotoField id={`front-${m.id}`} label="Form front photo" required value={e.front} error={err('front')} onChange={(v) => onChange({ front: v })} />
        <PhotoField id={`back-${m.id}`} label="Form back photo" required value={e.back} error={err('back')} onChange={(v) => onChange({ back: v })} />
      </div>
      {previewError && <div className="field-error" role="alert">{previewError}</div>}
      {sum && (
        <div className="notice ok" style={{ marginTop: 10 }}>
          <strong>EMI {inr(sum.installmentAmount)}</strong> × {sum.installments} = <strong>{inr(sum.totalPayable)}</strong>
          {preview.charges && <> · Cash in hand <strong>{inr(preview.cash)}</strong> (amount − security {inr(preview.charges.securityAmount)} − processing {inr(preview.charges.processingFee)} − insurance {inr(preview.charges.cost)})</>}
        </div>
      )}
      {scheme && (
        <div style={{ marginTop: 10 }}>
          <div className="muted small" style={{ marginBottom: 4 }}>Optional: a product on top of this loan, up to {EXTRA_PERCENT}% of it{extraMax ? ` (${inr(extraMax)})` : ''}. Its EMI is worked out on its own value.</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select aria-label={`Additional product for ${m.code}`} value={e.extraId} onChange={(ev) => onChange({ extraId: ev.target.value, extraScheme: ev.target.value ? e.extraScheme : '' })}>
              <option value="">{stock.length ? 'No product' : 'No product in stock'}</option>
              {stock.map((p) => <option key={p.id} value={p.id}>{p.name} · {inr(p.unitPrice)}</option>)}
            </select>
            {e.extraId && <input aria-label={`Units for ${m.code}`} inputMode="numeric" style={{ width: 70 }} value={e.extraQty} onChange={(ev) => onChange({ extraQty: ev.target.value.replace(/\D/g, '').slice(0, 4) })} />}
            {extraProduct && <span className={extraValue > extraMax ? 'field-error' : 'muted small'}>{inr(extraValue)}{extraValue > extraMax ? ` is more than ${inr(extraMax)}` : ''}</span>}
          </div>
          {e.extraId && extraProduct && (
            <ProductSchemeField id={`psch-${m.id}`} code={m.code} schemes={productSchemes} mode={e.mode} term={e.term} rate={e.rate} value={extraValue} schemeId={e.extraScheme} onChange={(v) => onChange({ extraScheme: v })} error={err('extraScheme')} />
          )}
          {err('additional') && <div className="field-error" role="alert">{err('additional')}</div>}
        </div>
      )}
    </div>
  );
}

// Group loan requisition: branch, today's date, who is making it, the group, then every member's own loan.
export default function GroupLoanRequisition() {
  const toast = useToast();
  const navigate = useNavigate();
  const [branches, setBranches] = useState([]);
  const [form, setForm] = useState({ branch: '', employeeCode: '', filterEmployee: '' });
  const [schemes, setSchemes] = useState([]);
  const [productSchemes, setProductSchemes] = useState([]);
  const [stock, setStock] = useState([]);
  const [picked, setPicked] = useState(null);
  const [detail, setDetail] = useState(null);
  const [chosen, setChosen] = useState([]);
  const [entries, setEntries] = useState({});
  const [previews, setPreviews] = useState({});
  const [errors, setErrors] = useState({});
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  // a daily group has daily schemes only, a weekly group weekly, a monthly group monthly
  const meeting = detail?.group?.meetingType || '';
  const usable = meeting ? schemes.filter((s) => s.modes.some((x) => x.value === meeting)).map((s) => ({ ...s, modes: s.modes.filter((x) => x.value === meeting) })) : schemes;

  useEffect(() => {
    api.groups.branchOptions().then((r) => {
      setBranches(r.items);
      if (r.items.length === 1) setForm((f) => ({ ...f, branch: r.items[0].id }));
    }).catch(() => {});
    api.loanRequisitions.schemes({ kind: 'group' }).then((r) => setSchemes(r.items)).catch(() => setSchemes([]));
    api.loanRequisitions.schemes({ kind: 'product' }).then((r) => setProductSchemes(r.items)).catch(() => setProductSchemes([]));
  }, []);
  useEffect(() => {
    if (form.branch) api.loanRequisitions.stockProducts(form.branch).then((r) => setStock(r.items)).catch(() => setStock([]));
    else setStock([]);
  }, [form.branch]);
  // A new branch means different groups and employees.
  useEffect(() => {
    setPicked(null);
    setDetail(null);
    setChosen([]);
    setForm((f) => ({ ...f, employeeCode: '', filterEmployee: '' }));
  }, [form.branch]);

  async function pick(item) {
    setPicked(item);
    setDetail(null);
    setErrors({});
    setChosen([]);
    setEntries({});
    setPreviews({});
    if (!item) return;
    try {
      const d = await api.loanRequisitions.group(item.id);
      setDetail(d);
      setChosen(d.group.members.filter(eligible).map((m) => m.id));
      setEntries(Object.fromEntries(d.group.members.map((m) => [m.id, { ...blank }])));
      if (d.group.employeeCode) setForm((f) => ({ ...f, employeeCode: d.group.employeeCode }));
    } catch (err) {
      toast.error(err.message);
      setPicked(null);
    }
  }

  const g = detail?.group;
  const members = g ? g.members.filter((m) => chosen.includes(m.id) && eligible(m)) : [];
  const patch = (mid, p) => {
    setEntries((x) => ({ ...x, [mid]: { ...x[mid], ...p } }));
    setErrors((er) => Object.fromEntries(Object.entries(er).filter(([k]) => !k.startsWith(`entries.${mid}.`))));
  };
  // The first member's scheme and amount can be copied to the others (each can still be changed).
  function copyFirst() {
    const first = entries[members[0]?.id];
    if (!first?.schemeId) return toast.error("Fill in the first member's scheme and amount first");
    setEntries((x) => {
      const next = { ...x };
      members.slice(1).forEach((m) => {
        if (!m.runningSchemeIds?.includes(first.schemeId)) next[m.id] = { ...next[m.id], schemeId: first.schemeId, amount: first.amount, mode: first.mode, term: first.term, rate: first.rate };
      });
      return next;
    });
    toast.success('Scheme and amount copied to the other members');
  }

  function review(e) {
    e.preventDefault();
    const found = {};
    if (!form.branch) found.branch = 'Select a branch';
    if (!picked) found.group = 'Select the group';
    else if (detail?.issues?.length) found.group = detail.issues[0];
    else if (!members.length) found.entries = 'Tick at least one member who gets a loan';
    if (!form.employeeCode) found.employeeCode = 'Select the employee who is making the requisition';
    members.forEach((m) => {
      const x = entries[m.id] || blank;
      const k = (f) => `entries.${m.id}.${f}`;
      if (!x.schemeId) found[k('schemeId')] = `Select the loan scheme of ${m.code}`;
      else if (!(Number(x.amount) > 0)) found[k('amount')] = 'Enter the loan amount';
      if (!x.front) found[k('front')] = `Upload the front photo of the form of ${m.code}`;
      if (!x.back) found[k('back')] = `Upload the back photo of the form of ${m.code}`;
      if (x.extraId) {
        const p = stock.find((s) => s.id === x.extraId);
        const val = p ? p.unitPrice * (Number(x.extraQty) || 0) : 0;
        if (val > Math.floor((Number(x.amount) || 0) * EXTRA_PERCENT) / 100) found[k('additional')] = `The product is more than ${EXTRA_PERCENT}% of the loan`;
        else if (p && Number(x.extraQty) > p.stockQty) found[k('additional')] = `Only ${p.stockQty} in stock`;
        if (!x.extraScheme) found[k('extraScheme')] = `Select the product loan scheme of ${m.code}`;
      }
    });
    setErrors(found);
    if (Object.keys(found).length) return toast.error('Please correct the highlighted fields');
    setConfirm(true);
  }

  async function submit() {
    setSaving(true);
    try {
      const payload = {
        branch: form.branch,
        loanDate: todayISO(),
        employeeCode: form.employeeCode,
        group: picked.id,
        entries: members.map((m) => {
          const x = entries[m.id];
          return { member: m.id, schemeId: x.schemeId, amount: x.amount, mode: x.mode, term: Number(x.term), rate: x.rate, front: x.front, back: x.back, additional: x.extraId ? { stockProduct: x.extraId, quantity: Number(x.extraQty) || 1, schemeId: x.extraScheme } : undefined };
        }),
      };
      const r = await api.loanRequisitions.create('group', payload);
      toast.success(`Requisition ${r.batch.formId} submitted — ${r.batch.count} member loan${r.batch.count === 1 ? '' : 's'}`);
      navigate('/loan-requisition/list');
    } catch (err) {
      setErrors(err.errors || {});
      setConfirm(false);
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  const total = members.reduce((s, m) => s + (Number(entries[m.id]?.amount) || 0), 0);
  const eligibleCount = g ? g.members.filter(eligible).length : 0;
  return (
    <>
      <PageHeader title="Group Loan Requisition" description="Choose the branch, the group and the employee, then fill in each member's loan: scheme, amount and the two photos of her application form." />
      <form onSubmit={review} noValidate>
        <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
          <h3 className="section-title">Requisition</h3>
          <div className="form-grid">
            <FormField id="formid" label="Form ID" hint="Generated automatically on submit"><input id="formid" value="Auto" disabled /></FormField>
            <FormField id="branch" label="Branch" required error={errors.branch}>
              <select id="branch" value={form.branch} onChange={(e) => { setForm((f) => ({ ...f, branch: e.target.value })); setErrors((x) => ({ ...x, branch: undefined })); }}>
                <option value="">Select branch</option>
                {branches.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}
              </select>
            </FormField>
            <FormField id="loanDate" label="Loan date" hint="A group requisition is made for today only (no back date)" error={errors.loanDate}>
              <input id="loanDate" type="date" value={todayISO()} disabled />
            </FormField>
            <EmployeeSelect id="filterEmployee" branch={form.branch} value={form.filterEmployee} label="Filter groups by employee" required={false} autoDefault={false}
              onChange={(code) => { setForm((f) => ({ ...f, filterEmployee: code })); setPicked(null); setDetail(null); setChosen([]); }} />
            <div className="span-2">
              <Search
                id="group" label="Select group" required error={errors.group} placeholder="All groups of the branch are listed; search by group code, name or leader"
                branch={form.branch} value={picked} display={picked ? `${picked.code} — ${picked.name}` : ''}
                fetchItems={(q) => api.loanRequisitions.groups({ branch: form.branch, employeeCode: form.filterEmployee, q }).then((r) => r.items)}
                render={(it) => <><strong>{it.code}</strong> — {it.name} <span className="muted">· {it.memberCount} members · {it.employeeCode || 'no employee'}</span></>}
                onPick={pick}
              />
            </div>
            <EmployeeSelect branch={form.branch} value={form.employeeCode} label="Employee ID (who is making the requisition)" error={errors.employeeCode}
              onChange={(code) => { setForm((f) => ({ ...f, employeeCode: code })); setErrors((x) => ({ ...x, employeeCode: undefined })); }} />
          </div>
        </div>

        {picked && !g && <div className="muted" style={{ marginBottom: 14 }}>Loading the group…</div>}
        {g && (
          <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
            <h3 className="section-title">Group detail — {g.code} {g.name}</h3>
            <DetailList items={[['Group leader', g.leaderName], ['Employee', g.employeeCode ? `${g.employeeCode}${g.employeeName ? ` — ${g.employeeName}` : ''}` : ''], ['Members', String(g.memberCount)]]} />
            {detail.issues.length > 0 && <div className="notice warn" style={{ marginTop: 10 }}>{detail.issues.map((i) => <div key={i}>{i}</div>)}</div>}
            {errors.entries && <div className="field-error" role="alert">{errors.entries}</div>}
            <div className="muted small" style={{ margin: '10px 0 6px' }}>
              Tick the members who get a loan — <strong>{members.length}</strong> of {g.members.length} selected. A member whose documents are not verified, or who has no guarantor or nominee, cannot be selected.
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th style={{ width: 40 }}><input type="checkbox" aria-label="Select all members" checked={eligibleCount > 0 && members.length === eligibleCount} onChange={(e) => setChosen(e.target.checked ? g.members.filter(eligible).map((m) => m.id) : [])} /></th><th>Member code</th><th>Name</th><th>Status</th></tr></thead>
                <tbody>
                  {g.members.map((m) => {
                    const ok = eligible(m);
                    return (
                      <tr key={m.id} style={ok ? undefined : { opacity: 0.7 }}>
                        <td><input type="checkbox" aria-label={`Select ${m.code}`} disabled={!ok} checked={ok && chosen.includes(m.id)} onChange={() => setChosen((c) => (c.includes(m.id) ? c.filter((x) => x !== m.id) : [...c, m.id]))} /></td>
                        <td data-label="Code"><strong>{m.code}</strong></td>
                        <td data-label="Name">{m.name}</td>
                        <td data-label="Status">
                          {m.isBlocked ? <span className="badge danger">Blocked</span>
                            : m.runningInGroup ? <span className="badge grey">Has loan {m.runningInGroup.formId} in this group — product loan only</span>
                              : m.issues?.length ? <div>{m.issues.map((i) => <div key={i} className="field-error small">{i}</div>)}</div>
                                : <span className="badge green">Eligible</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {members.length > 1 && (
          <div style={{ marginBottom: 10 }}><button type="button" className="btn sm" onClick={copyFirst}>Use the first member's scheme and amount for all members</button></div>
        )}
        {members.map((m, i) => (
          <MemberLoan key={m.id} index={i} m={m} e={entries[m.id] || blank} schemes={usable} productSchemes={productSchemes} stock={stock} errors={errors} onChange={(p) => patch(m.id, p)}
            onPreview={(res) => setPreviews((x) => (x[m.id] === res || (x[m.id] && res && JSON.stringify(x[m.id]) === JSON.stringify(res)) ? x : { ...x, [m.id]: res }))} />
        ))}

        {g && <GroupTopUp members={g.members} stock={stock} onDone={() => pick(picked)} />}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, alignItems: 'center' }}>
          {members.length > 0 && <span className="muted">{members.length} member loan{members.length === 1 ? '' : 's'} · total {inr(total)}</span>}
          <button type="submit" className="btn primary">Review &amp; submit</button>
        </div>
      </form>

      <Modal open={confirm} title="Confirm group loan requisition" onClose={() => setConfirm(false)} busy={saving} size="lg"
        footer={<><button className="btn" onClick={() => setConfirm(false)} disabled={saving}>Back</button><button className="btn primary" onClick={submit} disabled={saving}>{saving ? 'Submitting…' : 'Confirm & submit'}</button></>}>
        {picked && (
          <>
            <DetailList items={[['Group', `${picked.code} — ${picked.name}`], ['Branch', branches.find((x) => x.id === form.branch)?.name], ['Loan date', todayISO()], ['Employee ID', form.employeeCode], ['Members', String(members.length)], ['Total of the loans', inr(total)]]} />
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="data-table">
                <thead><tr><th>Member</th><th>Scheme</th><th className="num">Amount</th><th>Installments</th><th className="num">EMI</th><th className="num">Cash in hand</th><th>Product</th></tr></thead>
                <tbody>
                  {members.map((m) => {
                    const x = entries[m.id];
                    const s = usable.find((y) => y.id === x.schemeId);
                    const pv = previews[m.id];
                    const p = stock.find((y) => y.id === x.extraId);
                    return (
                      <tr key={m.id}>
                        <td data-label="Member"><strong>{m.code}</strong> {m.name}</td>
                        <td data-label="Scheme">{s ? `${s.code} — ${s.name}` : '—'}</td>
                        <td data-label="Amount" className="num">{inr(Number(x.amount))}</td>
                        <td data-label="Installments">{x.term} ({s?.modes.find((y) => y.value === x.mode)?.label}) at {x.rate}%</td>
                        <td data-label="EMI" className="num">{pv ? inr(pv.summary.installmentAmount) : '—'}</td>
                        <td data-label="Cash" className="num">{pv ? inr(pv.cash) : '—'}</td>
                        <td data-label="Product">{p ? `${p.name} × ${x.extraQty}` : '—'}{p && <div className="muted small">{productSchemes.find((y) => y.id === x.extraScheme)?.name || ''}</div>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
