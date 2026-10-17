import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import { DetailList, PageHeader } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { compressImage } from '../utils/image.js';
import { EmployeeSelect, PhotoField } from './NewBorrower.jsx';

const ADMINS = ['super_admin', 'admin'];
const todayISO = () => new Date().toISOString().slice(0, 10);
const inr = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const MAX_DOC_BYTES = 800 * 1024;
const EXTRA_PERCENT_TOPUP = 25;
// Days in one term unit / one repayment period (the same 30-day month the scheme limits use).
const UNIT_DAYS = { days: 1, weeks: 7, months: 30 };
const MODE_DAYS = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, quarterly: 90, halfyearly: 180, yearly: 360 };

const KINDS = {
  personal: { title: 'Personal Loan Requisition', desc: 'Choose the borrower and the loan scheme, check the EMI, then confirm and submit.', path: '' },
  group: { title: 'Group Loan Requisition', desc: 'Filter the group by branch and employee, choose the group and the loan scheme, then confirm and submit.', path: '/group' },
  business: { title: 'Business / MSME Loan Requisition', desc: 'Choose the loan type and the borrower, add the business details and documents, then confirm and submit.', path: '/business' },
  product: { title: 'Product Loan Requisition', desc: 'Choose the borrower and the product, enter the requisition amount, then confirm and submit.', path: '/product' },
};

// ---- pickers --------------------------------------------------------------------------------------------------
function Search({ id, label, required, error, hint, placeholder, branch, value, display, fetchItems, render, onPick, disabled }) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const q = useDebounce(search);

  useEffect(() => {
    if (!branch || disabled) return undefined;
    let live = true;
    fetchItems(q).then((r) => live && setItems(r)).catch(() => live && setItems([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch, q, disabled, fetchItems]);

  return (
    <FormField id={id} label={label} required={required} error={error} hint={!branch ? 'Select the branch first' : hint}>
      {value ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input id={id} value={display} disabled />
          <button type="button" className="btn sm" onClick={() => { onPick(null); setSearch(''); setOpen(true); }}>Change</button>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <input id={id} type="search" placeholder={placeholder} value={search} disabled={!branch || disabled} autoComplete="off"
            onFocus={() => setOpen(true)} onChange={(e) => { setSearch(e.target.value); setOpen(true); }} />
          {open && branch && !disabled && (
            <div className="panel" style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, maxHeight: 240, overflow: 'auto', marginTop: 4 }}>
              {items.length === 0 ? (
                <div className="muted" style={{ padding: 10 }}>Nothing found</div>
              ) : (
                items.map((it) => (
                  <button key={it.id} type="button" className="btn" style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, borderRadius: 0 }}
                    onClick={() => { onPick(it); setOpen(false); }}>
                    {render(it)}
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

// PDF or image, up to 800 KB (images are shrunk first).
function DocumentField({ id, label, required, value, name, error, onChange }) {
  const ref = useRef(null);
  const [err, setErr] = useState('');
  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr('');
    try {
      let data;
      if (file.type === 'application/pdf') {
        if (file.size > MAX_DOC_BYTES) throw new Error('The PDF must be 800 KB or smaller');
        data = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = () => reject(new Error('Could not read the file'));
          fr.readAsDataURL(file);
        });
      } else {
        data = await compressImage(file, { maxSide: 1600, quality: 0.75 });
      }
      onChange(data, file.name);
    } catch (ex) {
      setErr(ex.message);
    }
  }
  return (
    <FormField id={id} label={label} required={required} error={err || error}>
      <div className="stamp-upload">
        {value ? <div className="muted">{name || 'Document attached'}</div> : <div className="stamp-empty">No file</div>}
        <div className="stamp-actions">
          <input id={id} ref={ref} type="file" accept="application/pdf,image/png,image/jpeg" onChange={pick} hidden />
          <button type="button" className="btn sm" onClick={() => ref.current?.click()}>{value ? 'Change' : 'Upload'}</button>
          {value && <button type="button" className="btn sm danger-outline" onClick={() => onChange('', '')}>Remove</button>}
        </div>
      </div>
    </FormField>
  );
}

// OTP to the mobile registered on the borrower (business loan: confirms the Aadhaar of the borrower).
function BorrowerOtp({ member, verified, onVerified, onReset }) {
  const toast = useToast();
  const [challenge, setChallenge] = useState(null);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setChallenge(null);
    setOtp('');
    setError('');
    onReset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member]);

  async function send() {
    setBusy(true);
    setError('');
    try {
      const r = await api.loanRequisitions.borrowerOtp(member);
      setChallenge(r);
      setOtp('');
      toast.success(`OTP sent to ${r.sentTo}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    if (!/^\d{6}$/.test(otp)) return setError('Enter the 6-digit OTP');
    setBusy(true);
    setError('');
    try {
      await api.members.verifyOtp(challenge.challengeId, otp);
      onVerified(challenge.challengeId);
      toast.success('Borrower verified with OTP');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (verified) return <span className="badge green">OTP verified</span>;
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn sm" disabled={busy || !member} onClick={send}>{challenge ? 'Resend OTP' : "Send OTP to the borrower's mobile"}</button>
        {challenge && (
          <>
            <input aria-label="OTP" inputMode="numeric" style={{ width: 110 }} placeholder="6-digit OTP" value={otp} maxLength={6}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} />
            <button type="button" className="btn sm primary" disabled={busy} onClick={verify}>Verify</button>
          </>
        )}
      </div>
      {challenge && <div className="muted small">OTP sent to {challenge.sentTo}{challenge.devOtp ? ` (dev OTP: ${challenge.devOtp})` : ''}</div>}
      {error && <div className="field-error" role="alert">{error}</div>}
    </div>
  );
}

// A member who already has a loan in the group takes a product loan on it: up to 25% of the running loan.
function GroupTopUp({ members, stock, onDone }) {
  const toast = useToast();
  const [row, setRow] = useState({}); // { memberId: { id, qty, front, back } }
  const [busy, setBusy] = useState('');
  const [errors, setErrors] = useState({});
  const eligible = members.filter((m) => m.runningInGroup && !m.isBlocked);
  if (!eligible.length) return null;
  const set = (mid, patch) => setRow((r) => ({ ...r, [mid]: { id: '', qty: '1', front: '', back: '', ...r[mid], ...patch } }));

  async function add(m) {
    const e = row[m.id] || {};
    const found = {};
    if (!e.id) found.additional = 'Select the product';
    if (!e.front) found.front = 'Upload the front photo of the form';
    if (!e.back) found.back = 'Upload the back photo of the form';
    const p = stock.find((x) => x.id === e.id);
    if (p && p.unitPrice * (Number(e.qty) || 0) > m.runningInGroup.topUpLeft) found.additional = `More than the ${inr(m.runningInGroup.topUpLeft)} that can still be taken`;
    setErrors((x) => ({ ...x, [m.id]: found }));
    if (Object.keys(found).length) return;
    setBusy(m.id);
    try {
      await api.loanRequisitions.topUp(m.runningInGroup.requisitionId, {
        additional: [{ member: m.id, stockProduct: e.id, quantity: Number(e.qty) || 1 }],
        memberForms: [{ member: m.id, front: e.front, back: e.back }],
      });
      toast.success(`Product loan added for ${m.code}`);
      setRow((r) => ({ ...r, [m.id]: undefined }));
      onDone();
    } catch (err) {
      setErrors((x) => ({ ...x, [m.id]: { additional: err.errors?.additional || err.message, front: err.errors?.[`memberForms.${m.id}.front`], back: err.errors?.[`memberForms.${m.id}.back`] } }));
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
      <h3 className="section-title">Product loan on a running group loan</h3>
      <div className="muted small" style={{ marginBottom: 8 }}>
        A member can have only one loan in a group. If a member needs more, only a product loan up to {EXTRA_PERCENT_TOPUP}% of the running loan is allowed (for example ₹10,000 → ₹2,500).
        Upload this loan's own form photos for the member.
      </div>
      {eligible.map((m) => {
        const l = m.runningInGroup;
        const e = row[m.id] || { id: '', qty: '1', front: '', back: '' };
        const er = errors[m.id] || {};
        const p = stock.find((x) => x.id === e.id);
        const value = p ? Math.round(p.unitPrice * (Number(e.qty) || 0) * 100) / 100 : 0;
        return (
          <div key={m.id} className="panel" style={{ padding: 12, marginBottom: 10 }}>
            <div><strong>{m.code}</strong> — {m.name} <span className="muted">· running loan {l.formId} of {inr(l.amount)} · product loan limit {inr(l.topUpMax)}, left {inr(l.topUpLeft)}</span></div>
            {l.topUpLeft <= 0 ? <div className="muted small">The product loan limit is used up.</div> : (
              <div className="form-grid" style={{ marginTop: 8 }}>
                <FormField id={`tp-${m.id}`} label="Product" error={er.additional}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select id={`tp-${m.id}`} value={e.id} onChange={(ev) => set(m.id, { id: ev.target.value })}>
                      <option value="">{stock.length ? 'Select product' : 'No product in stock'}</option>
                      {stock.map((s) => <option key={s.id} value={s.id}>{s.name} · {inr(s.unitPrice)}</option>)}
                    </select>
                    {e.id && <input aria-label={`Units for ${m.code}`} inputMode="numeric" style={{ width: 64 }} value={e.qty} onChange={(ev) => set(m.id, { qty: ev.target.value.replace(/\D/g, '').slice(0, 4) })} />}
                  </div>
                  {p && <div className="small muted">{inr(value)}</div>}
                </FormField>
                <PhotoField id={`tpf-${m.id}`} label="Form front photo" required value={e.front} error={er.front} onChange={(v) => set(m.id, { front: v })} />
                <PhotoField id={`tpb-${m.id}`} label="Form back photo" required value={e.back} error={er.back} onChange={(v) => set(m.id, { back: v })} />
                <div><button type="button" className="btn primary" disabled={busy === m.id} onClick={() => add(m)}>{busy === m.id ? 'Adding…' : 'Add product loan'}</button></div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---- the form ---------------------------------------------------------------------------------------------------
function RequisitionForm({ kind }) {
  const cfg = KINDS[kind];
  const isGroup = kind === 'group';
  const isBusiness = kind === 'business';
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = ADMINS.includes(user?.role);

  const [branches, setBranches] = useState([]);
  const [schemes, setSchemes] = useState([]);
  const [form, setForm] = useState({ branch: '', loanDate: todayISO(), employeeCode: '', filterEmployee: '', schemeId: '', amount: '', mode: '', term: '', rate: '', formFrontPhoto: '', formBackPhoto: '' });
  const isProduct = kind === 'product';
  const [stock, setStock] = useState([]); // product loan: products in stock
  const [prod, setProd] = useState({ id: '', qty: '1' });
  const [verif, setVerif] = useState(null); // business / MSME: PAN + Aadhaar OTP status
  const [extras, setExtras] = useState({}); // group loan: additional product per member { memberId: { id, qty } }
  const [chosen, setChosen] = useState([]); // group loan: ids of the members who get the loan
  const [biz, setBiz] = useState({ loanType: '', businessName: '', gstNumber: '', udgamNumber: '', civilScore: '', shopPhoto: '', bankStatement: '', bankStatementName: '', itr: '', itrName: '', agreement: '', agreementName: '', udyamCertificate: '', udyamCertificateName: '', aadhaarNumber: '' });
  const [otpId, setOtpId] = useState(''); // business loan: OTP sent to the borrower's registered mobile, verified
  const [memberForms, setMemberForms] = useState({}); // group loan: form photos of each member { memberId: { front, back } }
  const [picked, setPicked] = useState(null);
  const [gstInfo, setGstInfo] = useState(null); // live check of the GST number
  const [detail, setDetail] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [errors, setErrors] = useState({});
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (isProduct || isGroup) api.loanRequisitions.stockProducts().then((r) => setStock(r.items)).catch(() => setStock([]));
  }, [isProduct, isGroup]);

  useEffect(() => {
    api.groups.branchOptions().then((r) => {
      setBranches(r.items);
      if (r.items.length === 1) setForm((f) => ({ ...f, branch: r.items[0].id }));
    }).catch(() => {});
  }, []);

  // Schemes depend on the kind (and, for business, on the chosen Business / MSME type).
  useEffect(() => {
    if (isBusiness && !biz.loanType) {
      setSchemes([]);
      return;
    }
    api.loanRequisitions.schemes({ kind, type: isBusiness ? biz.loanType : undefined }).then((r) => setSchemes(r.items)).catch(() => setSchemes([]));
  }, [kind, isBusiness, biz.loanType]);

  const scheme = schemes.find((s) => s.id === form.schemeId) || null;
  // The number of installments follows from the loan term and the repayment mode.
  const termDays = scheme && form.term ? Number(form.term) * UNIT_DAYS[scheme.termUnit] : 0;
  const installments = scheme && form.mode && termDays ? Math.max(1, Math.round(termDays / MODE_DAYS[form.mode])) : '';
  const evenSplit = !termDays || !form.mode || termDays % MODE_DAYS[form.mode] === 0;
  const setF = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };
  const setB = (key) => (e) => {
    setBiz((x) => ({ ...x, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [`business.${key}`]: undefined }));
  };
  const clearScheme = () => {
    setForm((f) => ({ ...f, schemeId: '', amount: '', mode: '', term: '', rate: '' }));
    setPreview(null);
  };

  // A new branch means different borrowers / groups / employees.
  useEffect(() => {
    setPicked(null);
    setDetail(null);
    setForm((f) => ({ ...f, employeeCode: '', filterEmployee: '' }));
  }, [form.branch]);

  async function pick(item) {
    setPicked(item);
    setDetail(null);
    setErrors((er) => ({ ...er, member: undefined, group: undefined }));
    if (!item) return;
    try {
      const d = isGroup ? await api.loanRequisitions.group(item.id) : await api.loanRequisitions.borrower(item.id);
      setDetail(d);
      setExtras({});
      setMemberForms({});
      if (isGroup) setChosen(d.group.members.filter((x) => !x.isBlocked && !x.runningInGroup).map((x) => x.id));
      // A scheme in which the borrower still has an unfinished loan is not offered.
      else if (d.borrower.runningSchemeIds?.includes(form.schemeId)) clearScheme();
      // A group loan is looked after by the group's employee.
      if (isGroup && d.group.employeeCode) setForm((f) => ({ ...f, employeeCode: d.group.employeeCode }));
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
      // Starting values from the scheme, so the EMI is shown straight away; the user can change them.
      amount: s && !isProduct ? String(s.amountMin) : form.amount,
      mode: s ? s.modes[0].value : '',
      term: s ? String(s.termMin) : '',
      rate: s ? String(s.roiMin) : '',
    }));
    setErrors((er) => ({ ...er, schemeId: undefined }));
    setPreview(null);
  }

  // GST number: checked as soon as all 15 characters are in (against the borrower's PAN as well).
  useEffect(() => {
    if (!isBusiness || biz.gstNumber.length !== 15) {
      setGstInfo(null);
      return undefined;
    }
    let live = true;
    api.loanRequisitions.gst(biz.gstNumber, picked?.id).then((r) => live && setGstInfo(r)).catch(() => live && setGstInfo(null));
    return () => {
      live = false;
    };
  }, [isBusiness, biz.gstNumber, picked]);

  // Group loan: a product on top of the loan, up to 25% of the loan amount, for the ticked members.
  const EXTRA_PERCENT = 25;
  const amountForLimit = Number(form.amount) || 0;
  const extraMax = Math.floor(amountForLimit * EXTRA_PERCENT) / 100;
  const extraRows = isGroup
    ? (detail?.group?.members || [])
        .filter((m) => chosen.includes(m.id) && !m.isBlocked && !m.runningInGroup && !(form.schemeId && m.runningSchemeIds?.includes(form.schemeId)))
        .map((m) => {
          const e = extras[m.id];
          const p = e ? stock.find((x) => x.id === e.id) : null;
          const qty = Number(e?.qty) || 0;
          return { m, p, qty, value: p && qty > 0 ? Math.round(p.unitPrice * qty * 100) / 100 : 0 };
        })
        .filter((r) => r.p && r.qty > 0)
    : [];
  const extraKey = extraRows.map((r) => r.value).join(',');
  const product = stock.find((p) => p.id === prod.id) || null;
  const qtyNum = Number(prod.qty) || 0;
  // A product loan is for the value of the goods.
  useEffect(() => {
    if (isProduct) setForm((f) => ({ ...f, amount: product && qtyNum > 0 ? String(Math.round(product.unitPrice * qtyNum * 100) / 100) : '' }));
  }, [isProduct, product, qtyNum]);

  // Business / MSME: what can be verified for the chosen borrower; the civil score comes from the civil check.
  useEffect(() => {
    if (!isBusiness || !picked) {
      setVerif(null);
      return;
    }
    api.loanRequisitions.verification(picked.id).then(setVerif).catch(() => setVerif(null));
  }, [isBusiness, picked]);
  useEffect(() => {
    const cs = detail?.borrower?.civilCheck?.score;
    if (isBusiness && cs) setBiz((x) => (x.civilScore ? x : { ...x, civilScore: String(cs) }));
  }, [isBusiness, detail]);

  // Live EMI.
  const debounced = useDebounce(JSON.stringify({ s: form.schemeId, a: form.amount, m: form.mode, t: installments, r: form.rate, x: extraKey }), 400);
  useEffect(() => {
    const { s, a, m, t, r, x } = JSON.parse(debounced);
    if (!s || !a || !m || !t || r === '') {
      setPreview(null);
      setPreviewError('');
      return;
    }
    const id = ++seq.current;
    api.loanRequisitions
      .preview({ schemeId: s, amount: a, mode: m, term: Number(t), rate: r, extras: x ? x.split(',').map(Number) : undefined })
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
    if (isGroup) {
      if (!picked) found.group = 'Select the group';
      else if (detail?.issues?.length) found.group = detail.issues[0];
      else if (!effective.length) found.memberIds = 'Tick at least one member who gets the loan';
    } else if (!picked) found.member = 'Select the borrower';
    else if (detail?.issues?.length) found.member = detail.issues[0];
    if (!form.employeeCode) found.employeeCode = 'Select the employee';
    if (isGroup) {
      const over = extraRows.find((r) => r.value > extraMax);
      if (over) found.additional = `${over.m.code}: the product (${inr(over.value)}) is more than ${EXTRA_PERCENT}% of the loan (${inr(extraMax)})`;
      const noStock = extraRows.find((r) => r.qty > r.p.stockQty);
      if (noStock) found.additional = `Only ${noStock.p.stockQty} unit(s) of ${noStock.p.name} in stock`;
    }
    if (isProduct) {
      if (!prod.id) found.stockProduct = 'Select the product';
      if (!(qtyNum >= 1)) found.quantity = 'Enter the number of units';
      else if (product && qtyNum > product.stockQty) found.quantity = `Only ${product.stockQty} in stock`;
    }
    if (isBusiness && verif && !verif.pan.present) found.member = 'The borrower has no PAN. Add it first (Borrower Synopsis → Edit details)';
    if (isGroup) {
      // every member's loan has its own form
      effective.forEach((m) => {
        if (!memberForms[m.id]?.front) found[`memberForms.${m.id}.front`] = `Upload the front photo of the form of ${m.code}`;
        if (!memberForms[m.id]?.back) found[`memberForms.${m.id}.back`] = `Upload the back photo of the form of ${m.code}`;
      });
    } else {
      if (!form.formFrontPhoto) found.formFrontPhoto = 'Upload the front photo of the form';
      if (!form.formBackPhoto) found.formBackPhoto = 'Upload the back photo of the form';
    }
    if (isBusiness) {
      if (!biz.loanType) found['business.loanType'] = 'Select Business or MSME';
      if (biz.businessName.trim().length < 2) found['business.businessName'] = 'Enter the business name';
      if (biz.loanType === 'msme' && !biz.udgamNumber.trim()) found['business.udgamNumber'] = 'Udgam number is required for an MSME loan';
      if (biz.loanType === 'business' && !biz.gstNumber.trim()) found['business.gstNumber'] = 'GST number is required for a business loan';
      else if (biz.gstNumber && gstInfo && gstInfo.ok === false) found['business.gstNumber'] = gstInfo.message;
      const c = Number(biz.civilScore);
      if (!Number.isInteger(c) || c < 300 || c > 900) found['business.civilScore'] = 'Enter the civil score (300 to 900)';
      if (!biz.shopPhoto) found['business.shopPhoto'] = 'Shop photo is required';
      if (!biz.bankStatement) found['business.bankStatement'] = 'Upload the bank statement';
      if (biz.loanType === 'msme' && !biz.udyamCertificate) found['business.udyamCertificate'] = 'Upload the Udyam certificate';
      if (!/^\d{12}$/.test(biz.aadhaarNumber)) found['business.aadhaarNumber'] = 'Enter the 12-digit Aadhaar number';
      if (!otpId) found['business.otp'] = "Verify the OTP sent to the borrower's registered mobile number";
    }
    if (!form.schemeId) found.schemeId = kind === 'product' ? 'Select the product' : 'Select a loan scheme';
    if (!form.amount) found.amount = isGroup ? 'Enter the amount per member' : 'Enter the request amount';
    if (!form.mode) found.mode = 'Select the repayment mode';
    if (!form.term) found.term = 'Enter the loan term';
    else if (scheme && (Number(form.term) < scheme.termMin || Number(form.term) > scheme.termMax)) found.term = `Term must be ${scheme.termMin} to ${scheme.termMax} ${scheme.termUnit}`;
    if (form.rate === '') found.rate = 'Enter the interest rate';
    if (!found.amount && !found.term && !found.rate && !found.mode && previewError) found.amount = previewError;
    setErrors(found);
    if (Object.keys(found).length) return toast.error('Please correct the highlighted fields');
    setConfirm(true);
  }

  async function submit() {
    setSaving(true);
    try {
      const payload = {
        branch: form.branch,
        loanDate: form.loanDate,
        employeeCode: form.employeeCode,
        schemeId: form.schemeId,
        amount: form.amount,
        mode: form.mode,
        term: Number(installments),
        rate: form.rate,
        ...(isGroup
          ? { memberForms: effective.map((m) => ({ member: m.id, front: memberForms[m.id]?.front, back: memberForms[m.id]?.back })) }
          : { formFrontPhoto: form.formFrontPhoto, formBackPhoto: form.formBackPhoto }),
        ...(isProduct ? { stockProduct: prod.id, quantity: qtyNum } : {}),
        ...(isGroup && extraRows.length ? { additional: extraRows.map((r) => ({ member: r.m.id, stockProduct: r.p.id, quantity: r.qty })) } : {}),
        ...(isGroup ? { group: picked.id, memberIds: effective.map((m) => m.id) } : { member: picked.id }),
        ...(isBusiness
          ? { business: { loanType: biz.loanType, businessName: biz.businessName.trim(), gstNumber: biz.gstNumber.trim(), udgamNumber: biz.loanType === 'msme' ? biz.udgamNumber.trim() : '', civilScore: Number(biz.civilScore), shopPhoto: biz.shopPhoto, bankStatement: biz.bankStatement, itr: biz.itr, agreement: biz.agreement, udyamCertificate: biz.udyamCertificate, aadhaarNumber: biz.aadhaarNumber, otpChallengeId: otpId } }
          : {}),
      };
      const r = await api.loanRequisitions.create(kind, payload);
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
  const g = detail?.group;
  // Schemes the chosen borrower already has an unfinished loan in are not offered again.
  const runningIds = !isGroup ? b?.runningSchemeIds || [] : [];
  const visibleSchemes = schemes.filter((s) => !runningIds.includes(s.id));
  const hiddenSchemes = schemes.filter((s) => runningIds.includes(s.id));
  // Group loan: the members that are ticked and can get this loan.
  const memberOk = (m) => !m.isBlocked && !m.runningInGroup && !(form.schemeId && m.runningSchemeIds?.includes(form.schemeId));
  const effective = isGroup && g ? g.members.filter((m) => chosen.includes(m.id) && memberOk(m)) : [];
  const sum = preview?.summary;
  const modeUnit = scheme?.modes.find((m) => m.value === form.mode)?.unit;
  const members = isGroup && g ? effective.length : 1;
  const amountNum = Number(form.amount) || 0;
  const schemeLabel = kind === 'product' ? 'Product' : 'Loan scheme';

  return (
    <>
      <PageHeader title={cfg.title} description={cfg.desc} />

      <form onSubmit={review} noValidate>
        <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
          <h3 className="section-title">Requisition</h3>
          <div className="form-grid">
            <FormField id="formid" label="Form ID" hint="Generated automatically on submit">
              <input id="formid" value="Auto" disabled />
            </FormField>
            <FormField id="branch" label="Branch" required error={errors.branch}>
              <select id="branch" value={form.branch} onChange={setF('branch')}>
                <option value="">Select branch</option>
                {branches.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}
              </select>
            </FormField>
            <FormField id="loanDate" label="Loan date" error={errors.loanDate} hint={isAdmin ? undefined : 'Today, or up to 30 days back'}>
              <input id="loanDate" type="date" max={todayISO()} value={form.loanDate} onChange={setF('loanDate')} />
            </FormField>
            {isGroup && (
              <EmployeeSelect
                id="filterEmployee"
                branch={form.branch}
                value={form.filterEmployee}
                label="Filter groups by employee"
                required={false}
                autoDefault={false}
                onChange={(code) => { setForm((f) => ({ ...f, filterEmployee: code })); setPicked(null); setDetail(null); }}
              />
            )}
            {isBusiness && (
              <FormField id="loanType" label="Loan type" required error={errors['business.loanType']}>
                <select id="loanType" value={biz.loanType} onChange={(e) => { setB('loanType')(e); clearScheme(); }}>
                  <option value="">Select type</option>
                  <option value="business">Business loan</option>
                  <option value="msme">MSME loan</option>
                </select>
              </FormField>
            )}
            {!isGroup && (
              <>
                <PhotoField id="formFrontPhoto" label="Form front photo" required value={form.formFrontPhoto} error={errors.formFrontPhoto}
                  onChange={(v) => { setForm((f) => ({ ...f, formFrontPhoto: v })); setErrors((er) => ({ ...er, formFrontPhoto: undefined })); }} />
                <PhotoField id="formBackPhoto" label="Form back photo" required value={form.formBackPhoto} error={errors.formBackPhoto}
                  onChange={(v) => { setForm((f) => ({ ...f, formBackPhoto: v })); setErrors((er) => ({ ...er, formBackPhoto: undefined })); }} />
              </>
            )}
            <div className="span-2">
              {isGroup ? (
                <Search
                  id="group" label="Select group" required error={errors.group} placeholder="Search by group code, name or leader"
                  branch={form.branch} value={picked} display={picked ? `${picked.code} — ${picked.name}` : ''}
                  fetchItems={(q) => api.loanRequisitions.groups({ branch: form.branch, employeeCode: form.filterEmployee, q }).then((r) => r.items)}
                  render={(it) => <><strong>{it.code}</strong> — {it.name} <span className="muted">· {it.memberCount} members · {it.employeeCode || 'no employee'}</span></>}
                  onPick={pick}
                />
              ) : (
                <Search
                  id="borrower" label="Select borrower" required error={errors.member} placeholder="Search by member code, name or mobile"
                  branch={form.branch} value={picked} display={picked ? `${picked.code} — ${picked.name}` : ''}
                  fetchItems={(q) => api.loanRequisitions.borrowers({ branch: form.branch, q }).then((r) => r.items)}
                  render={(it) => <><strong>{it.code}</strong> — {it.name} <span className="muted">· {it.mobile}</span></>}
                  onPick={pick}
                />
              )}
            </div>
            <EmployeeSelect
              branch={form.branch}
              value={form.employeeCode}
              error={errors.employeeCode}
              onChange={(code) => { setForm((f) => ({ ...f, employeeCode: code })); setErrors((er) => ({ ...er, employeeCode: undefined })); }}
            />
          </div>
        </div>

        {picked && !isGroup && (
          <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
            <h3 className="section-title">Borrower details (filled automatically)</h3>
            {!b ? <span className="muted">Loading…</span> : (
              <>
                {detail.issues.length > 0 && <div className="notice warn">{detail.issues.map((i) => <div key={i}>{i}</div>)}</div>}
                <DetailList
                  items={[
                    ['Borrower code', b.code], ['Borrower name', b.name], ['Date of birth', b.dob], ['Age', `${b.age} years`],
                    ['Gender', cap(b.gender)], ['Phone', b.mobile], ['Guarantor name', b.guarantorName],
                    ['Previous loan amount', inr(b.previousLoanAmount)],
                    ['Civil score', b.civilCheck ? `${b.civilCheck.score} (${b.civilCheck.bureau}, ${b.civilCheck.reportDate})` : 'No civil check yet — use Civil Check'],
                    ['Address', b.address],
                    ['Pincode', b.pincode], ['District / State', `${b.district}, ${b.state}`],
                  ]}
                />
              </>
            )}
          </div>
        )}

        {picked && isGroup && (
          <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
            <h3 className="section-title">Group details (filled automatically)</h3>
            {!g ? <span className="muted">Loading…</span> : (
              <>
                {detail.issues.length > 0 && <div className="notice warn">{detail.issues.map((i) => <div key={i}>{i}</div>)}</div>}
                <DetailList
                  items={[
                    ['Group code', g.code], ['Group name', g.name], ['Group leader', g.leaderName],
                    ['Employee', g.employeeCode ? `${g.employeeCode}${g.employeeName ? ` — ${g.employeeName}` : ''}` : ''],
                    ['Meeting', g.meetingType ? cap(g.meetingType) : ''], ['Members', String(g.memberCount)],
                  ]}
                />
                {g.members.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div className="muted small" style={{ marginBottom: 6 }}>
                      Tick the members who get this loan — <strong>{effective.length}</strong> of {g.members.length} selected
                    </div>
                    {errors.memberIds && <div className="field-error" role="alert">{errors.memberIds}</div>}
                    {errors.additional && <div className="field-error" role="alert">{errors.additional}</div>}
                    <div className="muted small" style={{ marginBottom: 6 }}>
                      Each member can also take a product (goods) on top of the loan, up to {EXTRA_PERCENT}% of the loan amount. The EMI of the product is worked out on its actual value only.
                    </div>
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th style={{ width: 40 }}>
                              <input
                                type="checkbox"
                                aria-label="Select all members"
                                checked={g.members.filter(memberOk).length > 0 && g.members.filter(memberOk).every((m) => chosen.includes(m.id))}
                                onChange={(e) => setChosen(e.target.checked ? g.members.filter(memberOk).map((m) => m.id) : [])}
                              />
                            </th>
                            <th>Member code</th><th>Name</th><th>Status</th>
                            <th>Additional product <span className="muted">(up to {EXTRA_PERCENT}%{extraMax ? ` = ${inr(extraMax)}` : ''})</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.members.map((m) => {
                            const ok = memberOk(m);
                            const busy = form.schemeId && m.runningSchemeIds?.includes(form.schemeId);
                            return (
                              <tr key={m.id} style={ok ? undefined : { opacity: 0.6 }}>
                                <td>
                                  <input
                                    type="checkbox"
                                    aria-label={`Select ${m.code}`}
                                    disabled={!ok}
                                    checked={ok && chosen.includes(m.id)}
                                    onChange={() => { setChosen((c) => (c.includes(m.id) ? c.filter((x) => x !== m.id) : [...c, m.id])); setErrors((er) => ({ ...er, memberIds: undefined })); }}
                                  />
                                </td>
                                <td data-label="Code"><strong>{m.code}</strong></td>
                                <td data-label="Name">{m.name}</td>
                                <td data-label="Status">
                                  {m.isBlocked ? <span className="badge danger">Blocked</span> : m.runningInGroup ? <span className="badge grey">Has loan {m.runningInGroup.formId} in this group — product loan only</span> : busy ? <span className="badge grey">Loan in this scheme not finished</span> : <span className="badge green">Eligible</span>}
                                </td>
                                <td data-label="Additional product">
                                  {ok && chosen.includes(m.id) ? (() => {
                                    const e = extras[m.id] || { id: '', qty: '1' };
                                    const p = stock.find((x) => x.id === e.id);
                                    const qty = Number(e.qty) || 0;
                                    const value = p && qty > 0 ? Math.round(p.unitPrice * qty * 100) / 100 : 0;
                                    const idx = extraRows.findIndex((r) => r.m.id === m.id);
                                    const emi = idx >= 0 ? preview?.extras?.[idx] : null;
                                    const over = value > extraMax;
                                    return (
                                      <div style={{ minWidth: 220 }}>
                                        <div style={{ display: 'flex', gap: 6 }}>
                                          <select aria-label={`Additional product for ${m.code}`} value={e.id}
                                            onChange={(ev) => setExtras((x) => ({ ...x, [m.id]: { id: ev.target.value, qty: x[m.id]?.qty || '1' } }))}>
                                            <option value="">{stock.length ? 'None' : 'No product in stock'}</option>
                                            {stock.map((s) => <option key={s.id} value={s.id}>{s.name} · {inr(s.unitPrice)}</option>)}
                                          </select>
                                          {e.id && (
                                            <input aria-label={`Units for ${m.code}`} inputMode="numeric" style={{ width: 64 }} value={e.qty}
                                              onChange={(ev) => setExtras((x) => ({ ...x, [m.id]: { ...x[m.id], qty: ev.target.value.replace(/\D/g, '').slice(0, 4) } }))} />
                                          )}
                                        </div>
                                        {p && qty > 0 && (
                                          <div className={`small ${over ? 'field-error' : 'muted'}`}>
                                            {over
                                              ? `${inr(value)} is more than ${inr(extraMax)}`
                                              : emi && !emi.error
                                                ? `${inr(value)} · EMI ${inr(emi.installmentAmount)}`
                                                : `${inr(value)}`}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })() : '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {effective.length > 0 && (
                      <div style={{ marginTop: 14 }}>
                        <h3 className="section-title">Application form of each member</h3>
                        <div className="muted small" style={{ marginBottom: 6 }}>The requisition is one, but every member's loan has its own form: upload the front and back photo for each member.</div>
                        {effective.map((m) => (
                          <div key={m.id} className="panel" style={{ padding: 12, marginBottom: 10 }}>
                            <strong>{m.code}</strong> — {m.name}
                            <div className="form-grid" style={{ marginTop: 6 }}>
                              <PhotoField id={`mf-${m.id}-front`} label="Form front photo" required value={memberForms[m.id]?.front || ''} error={errors[`memberForms.${m.id}.front`]}
                                onChange={(v) => { setMemberForms((x) => ({ ...x, [m.id]: { ...x[m.id], front: v } })); setErrors((er) => ({ ...er, [`memberForms.${m.id}.front`]: undefined })); }} />
                              <PhotoField id={`mf-${m.id}-back`} label="Form back photo" required value={memberForms[m.id]?.back || ''} error={errors[`memberForms.${m.id}.back`]}
                                onChange={(v) => { setMemberForms((x) => ({ ...x, [m.id]: { ...x[m.id], back: v } })); setErrors((er) => ({ ...er, [`memberForms.${m.id}.back`]: undefined })); }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {isGroup && g && <GroupTopUp members={g.members} stock={stock} onDone={() => pick(picked)} />}

        {isBusiness && (
          <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
            <h3 className="section-title">Verification</h3>
            {!picked ? (
              <div className="muted" style={{ marginBottom: 12 }}>Select the borrower to see the PAN and Aadhaar verification.</div>
            ) : !verif ? (
              <div className="muted" style={{ marginBottom: 12 }}>Checking…</div>
            ) : (
              <div className="table-wrap" style={{ marginBottom: 14, maxWidth: 560 }}>
                <table className="data-table">
                  <tbody>
                    <tr>
                      <td>PAN</td>
                      <td>
                        {!verif.pan.present ? <span className="badge danger">PAN missing — add it to the member first</span>
                          : verif.pan.verified ? <span className="badge green">Verified</span>
                            : verif.pan.formatOk ? <span className="badge grey">Format valid · holder check not done (PAN service not connected)</span>
                              : <span className="badge danger">PAN is not valid</span>}
                      </td>
                    </tr>
                    <tr>
                      <td>Aadhaar number</td>
                      <td>
                        <input aria-label="Aadhaar number" inputMode="numeric" maxLength={12} placeholder="12-digit Aadhaar number" value={biz.aadhaarNumber}
                          onChange={(e) => { setBiz((x) => ({ ...x, aadhaarNumber: e.target.value.replace(/\D/g, '').slice(0, 12) })); setErrors((er) => ({ ...er, 'business.aadhaarNumber': undefined })); }} />
                        {errors['business.aadhaarNumber'] && <div className="field-error" role="alert">{errors['business.aadhaarNumber']}</div>}
                      </td>
                    </tr>
                    <tr>
                      <td>OTP to registered mobile</td>
                      <td>
                        <BorrowerOtp member={picked.id} verified={Boolean(otpId)} onVerified={setOtpId} onReset={() => setOtpId('')} />
                        {errors['business.otp'] && <div className="field-error" role="alert">{errors['business.otp']}</div>}
                      </td>
                    </tr>
                    <tr>
                      <td>Aadhaar OTP</td>
                      <td>
                        {verif.aadhaar.otpServiceConnected
                          ? <span className="badge grey">Aadhaar OTP service is connected</span>
                          : <span className="badge grey">Not done — Aadhaar OTP service is not connected, so it is recorded as not verified</span>}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <h3 className="section-title">Business details</h3>
            <div className="form-grid">
              <FormField id="businessName" label="Business name" required error={errors['business.businessName']}>
                <input id="businessName" value={biz.businessName} onChange={setB('businessName')} maxLength={100} />
              </FormField>
              <FormField id="civilScore" label="Civil score" required error={errors['business.civilScore']}
                hint={detail?.borrower?.civilCheck ? `From the civil check of ${detail.borrower.civilCheck.reportDate} (300 to 900)` : '300 to 900. Record it under Civil Check'}>
                <input id="civilScore" inputMode="numeric" value={biz.civilScore} maxLength={3}
                  onChange={(e) => { setBiz((x) => ({ ...x, civilScore: e.target.value.replace(/\D/g, '').slice(0, 3) })); setErrors((er) => ({ ...er, 'business.civilScore': undefined })); }} />
              </FormField>
              {biz.loanType === 'msme' && (
                <FormField id="udgamNumber" label="Udgam number" required error={errors['business.udgamNumber']}>
                  <input id="udgamNumber" value={biz.udgamNumber} onChange={(e) => { setBiz((x) => ({ ...x, udgamNumber: e.target.value.toUpperCase() })); setErrors((er) => ({ ...er, 'business.udgamNumber': undefined })); }} maxLength={30} />
                </FormField>
              )}
              <FormField id="gstNumber" label="GST number" required={biz.loanType === 'business'} error={errors['business.gstNumber'] || (gstInfo && gstInfo.ok === false ? gstInfo.message : '')}
                hint={gstInfo?.ok ? `✓ Valid GST number — state code ${gstInfo.stateCode}${gstInfo.panMatched ? ', PAN matches the borrower' : ''}${gstInfo.registryChecked ? ', registration confirmed' : ''}` : biz.loanType === 'msme' ? 'Optional for an MSME loan' : 'Required for a business loan'}>
                <input id="gstNumber" value={biz.gstNumber} onChange={(e) => { setBiz((x) => ({ ...x, gstNumber: e.target.value.toUpperCase().slice(0, 15) })); setErrors((er) => ({ ...er, 'business.gstNumber': undefined })); }} maxLength={15} />
              </FormField>
              <PhotoField id="shopPhoto" label="Shop photo" required value={biz.shopPhoto} error={errors['business.shopPhoto']}
                onChange={(v) => { setBiz((x) => ({ ...x, shopPhoto: v })); setErrors((er) => ({ ...er, 'business.shopPhoto': undefined })); }} />
              <DocumentField id="bankStatement" label="Bank statement" required value={biz.bankStatement} name={biz.bankStatementName} error={errors['business.bankStatement']}
                onChange={(v, n) => { setBiz((x) => ({ ...x, bankStatement: v, bankStatementName: n })); setErrors((er) => ({ ...er, 'business.bankStatement': undefined })); }} />
              <DocumentField id="itr" label="ITR (income tax return)" value={biz.itr} name={biz.itrName} error={errors['business.itr']}
                onChange={(v, n) => { setBiz((x) => ({ ...x, itr: v, itrName: n })); setErrors((er) => ({ ...er, 'business.itr': undefined })); }} />
              <DocumentField id="agreement" label="Shop / business agreement" value={biz.agreement} name={biz.agreementName} error={errors['business.agreement']}
                onChange={(v, n) => { setBiz((x) => ({ ...x, agreement: v, agreementName: n })); setErrors((er) => ({ ...er, 'business.agreement': undefined })); }} />
              <DocumentField id="udyamCertificate" label="Udyam certificate" required={biz.loanType === 'msme'} value={biz.udyamCertificate} name={biz.udyamCertificateName} error={errors['business.udyamCertificate']}
                onChange={(v, n) => { setBiz((x) => ({ ...x, udyamCertificate: v, udyamCertificateName: n })); setErrors((er) => ({ ...er, 'business.udyamCertificate': undefined })); }} />
            </div>
          </div>
        )}

        {isProduct && (
          <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
            <h3 className="section-title">Stock product</h3>
            <div className="form-grid">
              <FormField id="stockProduct" label="Select stock product" required error={errors.stockProduct} className="span-2"
                hint={stock.length ? undefined : 'No product is in stock. Add products under Admin Master → Stock Product Master.'}>
                <select id="stockProduct" value={prod.id} onChange={(e) => { setProd((p) => ({ ...p, id: e.target.value })); setErrors((er) => ({ ...er, stockProduct: undefined })); }}>
                  <option value="">{stock.length ? 'Select product' : 'No product in stock'}</option>
                  {stock.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}{p.category ? ` (${p.category})` : ''} · {inr(p.unitPrice)} · {p.stockQty} in stock</option>)}
                </select>
              </FormField>
              <FormField id="quantity" label="Number of units" required error={errors.quantity} hint={product ? `${inr(product.unitPrice)} per unit` : undefined}>
                <input id="quantity" inputMode="numeric" value={prod.qty}
                  onChange={(e) => { setProd((p) => ({ ...p, qty: e.target.value.replace(/\D/g, '').slice(0, 6) })); setErrors((er) => ({ ...er, quantity: undefined })); }} />
              </FormField>
              <FormField id="productValue" label="Value of the goods (loan amount)">
                <input id="productValue" value={product && qtyNum > 0 ? inr(product.unitPrice * qtyNum) : ''} disabled placeholder="Auto" />
              </FormField>
            </div>
          </div>
        )}

        <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
          <h3 className="section-title">{kind === 'product' ? 'Product loan scheme' : 'Scheme detail'}</h3>
          <div className="form-grid">
            <FormField id="schemeId" label={schemeLabel} required error={errors.schemeId} className="span-2"
              hint={isBusiness && !biz.loanType ? 'Select the loan type first' : undefined}>
              <select id="schemeId" value={form.schemeId} onChange={chooseScheme} disabled={isBusiness && !biz.loanType}>
                <option value="">{visibleSchemes.length ? `Select ${schemeLabel.toLowerCase()}` : `No ${schemeLabel.toLowerCase()} available`}</option>
                {visibleSchemes.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select>
            </FormField>
            {hiddenSchemes.length > 0 && (
              <div className="notice warn span-2">
                Not offered, because {b?.name || 'this borrower'} already has a loan in {hiddenSchemes.length === 1 ? 'it' : 'them'} that is not finished: {hiddenSchemes.map((s) => s.name).join(', ')}.
              </div>
            )}
          </div>

          {scheme && (
            <>
              <div style={{ margin: '12px 0' }}>
                <DetailList
                  items={[
                    ['Amount', `${inr(scheme.amountMin)} – ${inr(scheme.amountMax)}${isGroup ? ' per member' : ''}`],
                    ['Term', `${scheme.termMin} – ${scheme.termMax} ${scheme.termUnit}`],
                    ['Interest', `${scheme.roiMin}% – ${scheme.roiMax}% p.a. (${scheme.calculationType})`],
                    ['Age', `${scheme.ageMin} – ${scheme.ageMax} years`],
                    ['Repayment', scheme.modes.map((m) => m.label).join(', ')],
                    ['Security', scheme.securityType === 'none' ? 'None' : `${scheme.securityType.replace('_', ' ')} (${scheme.securityDeposit?.type === 'fixed' ? inr(scheme.securityDeposit.value) : `${scheme.securityDeposit?.value ?? scheme.securityPercent}%`})`],
                  ]}
                />
              </div>
              <div className="form-grid">
                <FormField id="amount" label={isGroup ? 'Request amount per member (₹)' : isProduct ? 'Requisition amount (₹) — price × units' : 'Request amount (₹)'} required error={errors.amount}>
                  <input id="amount" inputMode="decimal" value={form.amount} disabled={isProduct} onChange={(e) => { setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })); setErrors((er) => ({ ...er, amount: undefined })); }} />
                </FormField>
                <FormField id="mode" label="Repayment mode" required error={errors.mode}>
                  <select id="mode" value={form.mode} onChange={setF('mode')}>
                    <option value="">Select mode</option>
                    {scheme.modes.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </FormField>
                <FormField id="term" label={`Loan term (${scheme.termUnit})`} required error={errors.term}
                  hint={scheme.termMin === scheme.termMax ? 'Fixed by the scheme' : `Between ${scheme.termMin} and ${scheme.termMax} ${scheme.termUnit}`}>
                  <input id="term" inputMode="numeric" value={form.term} disabled={scheme.termMin === scheme.termMax}
                    onChange={(e) => { setForm((f) => ({ ...f, term: e.target.value.replace(/\D/g, '') })); setErrors((er) => ({ ...er, term: undefined })); }} />
                </FormField>
                <FormField id="installments" label="Number of installments" hint={!form.mode ? 'Select the repayment mode' : evenSplit ? 'Calculated from the term and the repayment mode' : 'Calculated and rounded to the nearest whole installment'}>
                  <input id="installments" value={installments ? `${installments}${modeUnit ? ` ${modeUnit}s` : ''}` : ''} disabled placeholder="Auto" />
                </FormField>
                <FormField id="rate" label="Interest rate (% p.a.)" required error={errors.rate}
                  hint={scheme.roiMin === scheme.roiMax ? 'Fixed by the scheme' : `Between ${scheme.roiMin}% and ${scheme.roiMax}%`}>
                  <input id="rate" inputMode="decimal" value={form.rate} disabled={scheme.roiMin === scheme.roiMax}
                    onChange={(e) => { setForm((f) => ({ ...f, rate: e.target.value.replace(/[^\d.]/g, '') })); setErrors((er) => ({ ...er, rate: undefined })); }} />
                </FormField>
              </div>

              <div style={{ marginTop: 14 }}>
                {previewError && <div className="field-error" role="alert">{previewError}</div>}
                {sum && (
                  <div className="notice ok">
                    <strong>EMI {inr(sum.installmentAmount)}</strong>{isGroup ? ' per member' : ''} × {sum.installments} {modeUnit ? `${modeUnit}s` : 'installments'}
                    {' = '}<strong>{inr(sum.totalPayable)}</strong>
                    {sum.lastInstallmentAmount !== sum.installmentAmount && <span className="muted"> (the last installment is {inr(sum.lastInstallmentAmount)})</span>}
                    {isGroup && g && <> · <strong>Group total {inr(amountNum * members)}</strong> for {members} members</>}
                  </div>
                )}
                {sum && (
                  <div className="table-wrap" style={{ marginTop: 10, maxWidth: 460 }}>
                    <table className="data-table">
                      <thead><tr><th>Repayment{isGroup ? ' (per member)' : ''}</th><th className="num">Amount</th></tr></thead>
                      <tbody>
                        <tr><td>Total principal</td><td className="num">{inr(sum.totalPayable - sum.totalInterest)}</td></tr>
                        <tr><td>Total interest</td><td className="num">{inr(sum.totalInterest)}</td></tr>
                        <tr>
                          <td><strong>Total payable</strong> (EMI {inr(sum.installmentAmount)} × {sum.installments})</td>
                          <td className="num"><strong>{inr(sum.totalPayable)}</strong></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
                {preview?.charges && (
                  <div className="table-wrap" style={{ marginTop: 10, maxWidth: 460 }}>
                    <table className="data-table">
                      <thead><tr><th>Charges{isGroup ? ' (per member)' : ''}</th><th className="num">Amount</th></tr></thead>
                      <tbody>
                        <tr><td>Processing fee</td><td className="num">{inr(preview.charges.processingFee)}</td></tr>
                        <tr><td>Insurance fee</td><td className="num">{inr(preview.charges.cost)}</td></tr>
                        <tr>
                          <td>Security amount{preview.charges.securityType && preview.charges.securityType !== 'none' ? ` (${preview.charges.securityType.replace('_', ' ')})` : ''}</td>
                          <td className="num">{inr(preview.charges.securityAmount)}</td>
                        </tr>
                        <tr>
                          <td><strong>Total charges</strong></td>
                          <td className="num"><strong>{inr(preview.charges.processingFee + preview.charges.cost + preview.charges.securityAmount)}</strong></td>
                        </tr>
                        <tr>
                          <td>{isGroup ? 'Loan amount (per member)' : 'Loan requisition amount'}</td>
                          <td className="num">{inr(amountNum)}</td>
                        </tr>
                        <tr style={{ background: 'var(--surface-2, #f4f7f7)' }}>
                          <td><strong>Cash {isGroup ? 'per member ' : ''}(amount − security − processing − insurance)</strong></td>
                          <td className="num"><strong>{inr(preview.cash)}</strong></td>
                        </tr>
                        {isGroup && g && (
                          <tr>
                            <td><strong>Total cash for {members} member{members === 1 ? '' : 's'}</strong></td>
                            <td className="num"><strong>{inr(preview.cash * members)}</strong></td>
                          </tr>
                        )}
                      </tbody>
                    </table>
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
        title={`Confirm ${cfg.title.toLowerCase()}`}
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
              [isGroup ? 'Group' : 'Borrower', `${picked.code} — ${picked.name}`], ['Branch', branches.find((x) => x.id === form.branch)?.name],
              ['Loan date', form.loanDate], ['Employee ID', form.employeeCode],
              ...(isBusiness ? [['Loan type', biz.loanType === 'msme' ? 'MSME loan' : 'Business loan'], ['Business', biz.businessName], ['Civil score', biz.civilScore]] : []),
              [schemeLabel, `${scheme.code} — ${scheme.name}`],
              [isGroup ? 'Amount per member' : 'Request amount', inr(amountNum)],
              ...(isGroup && g ? [['Members getting the loan', effective.map((m) => m.code).join(', ')], ['Number of members', String(members)], ['Group total', inr(amountNum * members)]] : []),
              ...(isGroup && extraRows.length ? [['Additional products', extraRows.map((r, i) => `${r.m.code}: ${r.p.name} × ${r.qty} = ${inr(r.value)}${preview?.extras?.[i]?.installmentAmount ? ` (EMI ${inr(preview.extras[i].installmentAmount)})` : ''}`).join('; ')]] : []),
              ['Loan term', `${form.term} ${scheme.termUnit}`],
              ['Mode & installments', `${scheme.modes.find((m) => m.value === form.mode)?.label}, ${installments} installments`],
              ['Interest rate', `${form.rate}% p.a.`], ['EMI', inr(sum.installmentAmount)], ['Total payable', inr(sum.totalPayable)],
              ...(preview?.charges ? [['Processing fee', inr(preview.charges.processingFee)], ['Insurance fee', inr(preview.charges.cost)], ['Security amount', inr(preview.charges.securityAmount)], [isGroup ? 'Cash per member' : 'Cash in hand', inr(preview.cash)]] : []),
              ...(preview?.charges && isGroup ? [['Total cash', inr(preview.cash * members)]] : []),
            ]}
          />
        )}
      </Modal>
    </>
  );
}

export const PersonalLoanRequisition = () => <RequisitionForm kind="personal" />;
export const GroupLoanRequisition = () => <RequisitionForm kind="group" />;
export const BusinessLoanRequisition = () => <RequisitionForm kind="business" />;
export const ProductLoanRequisition = () => <RequisitionForm kind="product" />;
export default PersonalLoanRequisition;
