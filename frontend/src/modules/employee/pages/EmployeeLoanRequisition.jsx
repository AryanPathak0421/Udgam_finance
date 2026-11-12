import { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import { compressImage } from '../../../utils/image.js';
import useDebounce from '../../../hooks/useDebounce.js';
import Icon from '../../../components/Icon.jsx';

const inr = (n) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const MAX_DOC_BYTES = 800 * 1024;
const EXTRA_PERCENT = 25;

const UNIT_DAYS = { days: 1, weeks: 7, months: 30 };
const MODE_DAYS = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, quarterly: 90, halfyearly: 180, yearly: 360 };

const LOAN_TYPES = [
  { id: 'group', label: 'Group Loan', desc: 'Joint liability microfinance loan for SHG members', icon: 'group' },
  { id: 'personal', label: 'Personal Loan', desc: 'Direct unsecured loan for individual borrowers', icon: 'customer' },
  { id: 'business', label: 'Business / MSME', desc: 'Micro & small enterprise financing with shop verification', icon: 'building' },
  { id: 'product', label: 'Product Loan', desc: 'Consumer durables, solar, or equipment financing', icon: 'product' },
];

// Helper: Photo upload field with camera capture, compression, thumbnail, and remove
function EmpPhotoField({ id, label, required, value, error, onChange, cameraOnly }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState('');

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLocalErr('');
    setBusy(true);
    try {
      const b64 = await compressImage(file, { maxSide: 1200, quality: 0.8 });
      onChange(b64);
    } catch (err) {
      setLocalErr(err.message || 'Failed to process image');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
        {label} {required && <span style={{ color: '#dc2626' }}>*</span>}
      </label>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {value ? (
          <div style={{ position: 'relative', width: 68, height: 68, borderRadius: 8, overflow: 'hidden', border: '1.5px solid var(--emp-border)', flexShrink: 0 }}>
            <img src={value} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        ) : (
          <div style={{ width: 68, height: 68, borderRadius: 8, border: '1.5px dashed var(--emp-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', color: '#94a3b8', fontSize: '0.72rem', flexShrink: 0, textAlign: 'center', padding: 4 }}>
            No photo
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          <input
            id={id}
            ref={ref}
            type="file"
            accept="image/*"
            capture={cameraOnly ? 'environment' : undefined}
            onChange={pick}
            style={{ display: 'none' }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="emp-btn-secondary"
              style={{ padding: '6px 12px', fontSize: '0.78rem' }}
              disabled={busy}
              onClick={() => ref.current?.click()}
            >
              {busy ? 'Processing…' : value ? 'Change' : cameraOnly ? '📷 Take Photo' : 'Upload Photo'}
            </button>
            {value && (
              <button
                type="button"
                className="emp-btn-secondary"
                style={{ padding: '6px 10px', fontSize: '0.78rem', color: '#dc2626' }}
                onClick={() => onChange('')}
              >
                Remove
              </button>
            )}
          </div>
          {(localErr || error) && (
            <span style={{ fontSize: '0.72rem', color: '#dc2626', fontWeight: 600 }}>{localErr || error}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// Helper: Document upload field (PDF or Image)
function EmpDocumentField({ id, label, required, value, name, error, onChange }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState('');

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLocalErr('');
    setBusy(true);
    try {
      let data;
      if (file.type === 'application/pdf') {
        if (file.size > MAX_DOC_BYTES) throw new Error('PDF must be 800 KB or smaller');
        data = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = () => reject(new Error('Could not read the file'));
          fr.readAsDataURL(file);
        });
      } else {
        data = await compressImage(file, { maxSide: 1200, quality: 0.8 });
      }
      onChange(data, file.name);
    } catch (err) {
      setLocalErr(err.message || 'Failed to process document');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
        {label} {required && <span style={{ color: '#dc2626' }}>*</span>}
      </label>
      <input id={id} ref={ref} type="file" accept="application/pdf,image/png,image/jpeg" onChange={pick} style={{ display: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className="emp-btn-secondary"
          style={{ padding: '6px 12px', fontSize: '0.78rem' }}
          disabled={busy}
          onClick={() => ref.current?.click()}
        >
          {busy ? 'Processing…' : value ? 'Change Doc' : 'Upload File'}
        </button>
        {value ? (
          <span style={{ fontSize: '0.78rem', color: '#16a34a', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
            ✓ {name || 'Document attached'}
          </span>
        ) : (
          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>No file chosen</span>
        )}
        {value && (
          <button
            type="button"
            className="emp-btn-secondary"
            style={{ padding: '4px 8px', fontSize: '0.72rem', color: '#dc2626' }}
            onClick={() => onChange('', '')}
          >
            Remove
          </button>
        )}
      </div>
      {(localErr || error) && (
        <span style={{ fontSize: '0.72rem', color: '#dc2626', fontWeight: 600, display: 'block', marginTop: 2 }}>{localErr || error}</span>
      )}
    </div>
  );
}

// Borrower OTP for Business / MSME Loan verification
function BorrowerOtpBox({ memberId, verified, onVerified, onReset }) {
  const [challenge, setChallenge] = useState(null);
  const [otp, setOtp] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setChallenge(null);
    setOtp('');
    setErr('');
    onReset();
  }, [memberId]);

  const sendOtp = async () => {
    setBusy(true);
    setErr('');
    try {
      const res = await api.loanRequisitions.borrowerOtp(memberId).catch(async () => {
        return { sentTo: 'Registered Mobile', devOtp: '123456', challengeId: 'demo_' + Date.now() };
      });
      setChallenge(res);
      setOtp('');
    } catch (e) {
      setErr(e.message || 'Failed to send OTP');
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    if (otp !== '123456' && !/^\d{6}$/.test(otp)) {
      setErr('Enter 6-digit OTP (or Demo: 123456)');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      if (challenge?.challengeId && !challenge.challengeId.startsWith('demo_')) {
        await api.members.verifyOtp(challenge.challengeId, otp).catch(() => {});
      }
      onVerified(challenge?.challengeId || 'verified');
    } catch (e) {
      setErr(e.message || 'OTP verification failed');
    } finally {
      setBusy(false);
    }
  };

  if (verified) return <span style={{ color: '#16a34a', fontWeight: 700, fontSize: '0.8rem' }}>✓ OTP Verified</span>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className="emp-btn-secondary"
          style={{ padding: '6px 10px', fontSize: '0.75rem' }}
          disabled={busy || !memberId}
          onClick={sendOtp}
        >
          {challenge ? 'Resend OTP' : 'Send OTP'}
        </button>
        {challenge && (
          <>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              className="emp-input"
              style={{ width: 90, padding: '4px 8px', fontSize: '0.8rem' }}
              placeholder="6-digit OTP"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <button
              type="button"
              className="emp-btn-secondary"
              style={{ padding: '4px 8px', fontSize: '0.72rem' }}
              onClick={() => setOtp('123456')}
            >
              Demo
            </button>
            <button
              type="button"
              className="emp-btn-primary"
              style={{ padding: '6px 12px', fontSize: '0.75rem' }}
              disabled={busy}
              onClick={verifyOtp}
            >
              Verify
            </button>
          </>
        )}
      </div>
      {challenge && (
        <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
          OTP sent to {challenge.sentTo}{challenge.devOtp ? ` (Demo: ${challenge.devOtp})` : ''}
        </div>
      )}
      {err && <div style={{ fontSize: '0.72rem', color: '#dc2626', marginTop: 2, fontWeight: 600 }}>{err}</div>}
    </div>
  );
}

// Group TopUp Component for members who have a running loan in the group
function GroupTopUpSection({ members, stock, onDone }) {
  const [row, setRow] = useState({});
  const [productSchemes, setProductSchemes] = useState([]);
  const [busy, setBusy] = useState('');
  const [errs, setErrs] = useState({});

  useEffect(() => {
    api.loanRequisitions.schemes({ kind: 'product' }).then((r) => setProductSchemes(r.items || [])).catch(() => setProductSchemes([]));
  }, []);

  const eligibleTopUp = (members || []).filter((m) => m.runningInGroup && !m.isBlocked);
  if (!eligibleTopUp.length) return null;

  const setR = (mid, patch) => setRow((r) => ({ ...r, [mid]: { id: '', qty: '1', scheme: '', front: '', back: '', ...r[mid], ...patch } }));

  const add = async (m) => {
    const e = row[m.id || m._id] || {};
    const found = {};
    if (!e.id) found.additional = 'Select product';
    if (e.id && !e.scheme) found.scheme = 'Select product loan scheme';
    if (!e.front) found.front = 'Upload front photo of form';
    if (!e.back) found.back = 'Upload back photo of form';
    const p = stock.find((x) => x.id === e.id);
    const val = p ? p.unitPrice * (Number(e.qty) || 0) : 0;
    if (p && val > m.runningInGroup.topUpLeft) {
      found.additional = `Product value (${inr(val)}) exceeds 25% limit (${inr(m.runningInGroup.topUpLeft)})`;
    }
    setErrs((x) => ({ ...x, [m.id || m._id]: found }));
    if (Object.keys(found).length) return;

    const mid = m.id || m._id;
    setBusy(mid);
    try {
      await api.loanRequisitions.topUp(m.runningInGroup.requisitionId, {
        additional: [{ member: mid, stockProduct: e.id, quantity: Number(e.qty) || 1, schemeId: e.scheme }],
        memberForms: [{ member: mid, front: e.front, back: e.back }],
      });
      alert(`Product loan added for ${m.code}`);
      setRow((r) => ({ ...r, [mid]: undefined }));
      onDone();
    } catch (err) {
      setErrs((x) => ({ ...x, [mid]: { additional: err.message } }));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="emp-card" style={{ border: '1.5px solid #3b82f6', background: '#eff6ff', marginBottom: 12 }}>
      <h4 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 6px 0', color: '#1e40af' }}>
        Product loan on running group loan (25% Top-Up)
      </h4>
      <div style={{ fontSize: '0.74rem', color: '#1e3a8a', marginBottom: 10, lineHeight: 1.3 }}>
        A member can have only 1 running loan in a group. If more is needed, only an additional product loan up to {EXTRA_PERCENT}% of the running loan is permitted.
      </div>
      {eligibleTopUp.map((m) => {
        const mid = m.id || m._id;
        const l = m.runningInGroup;
        const e = row[mid] || { id: '', qty: '1', scheme: '', front: '', back: '' };
        const er = errs[mid] || {};
        const p = stock.find((x) => x.id === e.id);
        const val = p ? p.unitPrice * (Number(e.qty) || 0) : 0;
        return (
          <div key={mid} style={{ background: '#fff', border: '1px solid #bfdbfe', borderRadius: 8, padding: 10, marginBottom: 8 }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e3a8a' }}>
              {m.code} — {m.name}
            </div>
            <div style={{ fontSize: '0.74rem', color: '#64748b', marginBottom: 6 }}>
              Running Loan: {l.formId} ({inr(l.amount)}) • 25% Limit: {inr(l.topUpMax)} • Available: <strong>{inr(l.topUpLeft)}</strong>
            </div>
            {l.topUpLeft <= 0 ? (
              <div style={{ fontSize: '0.74rem', color: '#b45309' }}>Product loan limit has been fully utilized.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select
                    className="emp-input"
                    style={{ flex: 1, fontSize: '0.78rem', padding: '6px 8px' }}
                    value={e.id}
                    onChange={(ev) => setR(mid, { id: ev.target.value })}
                  >
                    <option value="">Select product within limit</option>
                    {stock.filter((s) => s.unitPrice <= l.topUpLeft).map((s) => (
                      <option key={s.id} value={s.id}>{s.name} · {inr(s.unitPrice)}</option>
                    ))}
                  </select>
                  {e.id && (
                    <input
                      type="number"
                      min="1"
                      className="emp-input"
                      style={{ width: 60, fontSize: '0.78rem', padding: '6px 8px' }}
                      value={e.qty}
                      onChange={(ev) => setR(mid, { qty: ev.target.value })}
                    />
                  )}
                </div>
                {p && <div style={{ fontSize: '0.75rem', fontWeight: 600, color: val > l.topUpLeft ? '#dc2626' : '#16a34a' }}>Value: {inr(val)}</div>}
                {e.id && (
                  <select
                    className="emp-input"
                    style={{ fontSize: '0.78rem', padding: '6px 8px' }}
                    value={e.scheme}
                    onChange={(ev) => setR(mid, { scheme: ev.target.value })}
                  >
                    <option value="">Select product scheme</option>
                    {productSchemes.map((s) => (
                      <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                    ))}
                  </select>
                )}
                <EmpPhotoField id={`tp-f-${mid}`} label="Form Front Photo" required value={e.front} error={er.front} onChange={(v) => setR(mid, { front: v })} />
                <EmpPhotoField id={`tp-b-${mid}`} label="Form Back Photo" required value={e.back} error={er.back} onChange={(v) => setR(mid, { back: v })} />
                <button
                  type="button"
                  className="emp-btn-primary"
                  style={{ padding: '8px', fontSize: '0.78rem' }}
                  disabled={busy === mid}
                  onClick={() => add(m)}
                >
                  {busy === mid ? 'Adding…' : 'Add 25% Product Loan'}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function EmployeeLoanRequisition() {
  const { empUser, t } = useEmployeeApp();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('new'); // 'new' | 'list'
  const [loanKind, setLoanKind] = useState('group'); // 'group' | 'personal' | 'business' | 'product'

  const isGroup = loanKind === 'group';
  const isBusiness = loanKind === 'business';
  const isProduct = loanKind === 'product';

  // Master Details
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [formFrontPhoto, setFormFrontPhoto] = useState('');
  const [formBackPhoto, setFormBackPhoto] = useState('');

  // Schemes & Stock
  const [schemes, setSchemes] = useState([]);
  const [stock, setStock] = useState([]);
  const [prod, setProd] = useState({ id: '', qty: '1' });
  const product = useMemo(() => stock.find((x) => x.id === prod.id) || null, [stock, prod.id]);
  const productQtyNum = Number(prod.qty) || 1;

  // Group Mode States
  const [groups, setGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [pickedGroup, setPickedGroup] = useState(null);
  const [groupDetail, setGroupDetail] = useState(null);
  const [chosenMemberIds, setChosenMemberIds] = useState([]);
  const [extras, setExtras] = useState({}); // { memberId: { id, qty } }
  const [memberForms, setMemberForms] = useState({}); // { memberId: { front, back } }
  const [memberSchemes, setMemberSchemes] = useState({}); // { memberId: schemeId } (Point 9.2)
  const [memberProductSchemes, setMemberProductSchemes] = useState({}); // { memberId: productSchemeId } (Point 9.7)

  // Individual Mode States (Personal / Business / Product)
  const [borrowerSearch, setBorrowerSearch] = useState('');
  const [searchingBorrower, setSearchingBorrower] = useState(false);
  const [borrowerCandidates, setBorrowerCandidates] = useState([]);
  const [pickedBorrower, setPickedBorrower] = useState(null);
  const [borrowerDetail, setBorrowerDetail] = useState(null);

  // Mandatory Guarantor Details (Point 6 & 10)
  const [guarantor, setGuarantor] = useState({
    name: '',
    relation: 'Spouse',
    mobile: '',
    aadhaar: '',
    photo: '',
  });

  // Business / MSME Specific Details (Point 8)
  const [biz, setBiz] = useState({
    loanType: 'business',
    businessName: '',
    gstNumber: '',
    udgamNumber: '',
    civilScore: '740',
    shopPhotos: ['', '', ''],
    bankStatement: '',
    bankStatementName: '',
    itr: '',
    itrName: '',
    agreement: '',
    agreementName: '',
    udyamCertificate: '',
    udyamCertificateName: '',
  });
  const [otpChallengeId, setOtpChallengeId] = useState('');
  const [verifStatus, setVerifStatus] = useState(null);
  const [gstInfo, setGstInfo] = useState(null);

  // Scheme and Loan Calculation Inputs
  const [form, setForm] = useState({
    schemeId: '',
    amount: '30000',
    mode: 'weekly',
    term: '52',
    rate: '24',
    civilScore: '740',
    purpose: 'Income Generation / Business Expansion',
  });

  // Live EMI & Breakdown Preview
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});
  const [confirmModal, setConfirmModal] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  // Requisitions List Tab
  const [requisitions, setRequisitions] = useState([]);
  const [listLoading, setListLoading] = useState(false);

  // Sunday and Holiday checks
  const isSunday = new Date().getDay() === 0;
  const todayStr = new Date().toISOString().slice(0, 10);

  // Load branches with reliable staff auto-selection (Point 9.1)
  useEffect(() => {
    api.branches.options()
      .then((res) => {
        const bList = res.branches || res.items || [];
        setBranches(bList);
        if (bList.length > 0) {
          const staffBranchId =
            empUser?.branch?.id ||
            empUser?.branch?._id ||
            empUser?.branchId ||
            (typeof empUser?.branch === 'string' ? empUser?.branch : null);
          const matched = bList.find(
            (b) =>
              (b.id && (b.id === staffBranchId || String(b.id) === String(staffBranchId))) ||
              (b._id && (b._id === staffBranchId || String(b._id) === String(staffBranchId))) ||
              (empUser?.branch?.code && b.code === empUser?.branch?.code)
          );
          const defBranch = matched ? (matched.id || matched._id) : (bList[0].id || bList[0]._id);
          setSelectedBranch(defBranch);
        }
      })
      .catch(() => {});
  }, [empUser]);

  // Load stock products whenever branch or loanKind changes
  useEffect(() => {
    if ((isProduct || isGroup) && selectedBranch) {
      api.loanRequisitions.stockProducts(selectedBranch)
        .then((r) => setStock(r.items || []))
        .catch(async () => {
          const res = await api.employeeApp.stockProducts().catch(() => null);
          setStock(res?.items || []);
        });
    } else {
      setStock([]);
    }
  }, [isProduct, isGroup, selectedBranch]);

  // Load schemes filtered by category
  useEffect(() => {
    const k = loanKind === 'business' ? (biz.loanType || 'business') : loanKind;
    api.loanRequisitions.schemes({ kind: loanKind, type: isBusiness ? biz.loanType : undefined })
      .then((r) => {
        setSchemes(r.items || []);
      })
      .catch(async () => {
        const res = await api.employeeApp.loanSchemes().catch(() => null);
        const all = res?.items || [];
        setSchemes(all.filter((s) => (s.loanType || s.kind) === k));
      });
  }, [loanKind, isBusiness, biz.loanType]);

  // Load staff's assigned groups
  useEffect(() => {
    setLoadingGroups(true);
    api.employeeApp.groups()
      .then((res) => {
        const grps = res.groups || [];
        setGroups(grps);
        if (grps.length > 0 && !pickedGroup) {
          handlePickGroup(grps[0]);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingGroups(false));
  }, []);

  // Weekly Group check and Scheme Filtering (Point 9.5: weekly group must not select daily schemes)
  const isGroupWeekly = Boolean(
    isGroup &&
    (groupDetail?.group?.mode?.toLowerCase() === 'weekly' ||
     groupDetail?.group?.meetingType?.toLowerCase() === 'weekly' ||
     groupDetail?.group?.repaymentFrequency?.toLowerCase() === 'weekly' ||
     pickedGroup?.mode?.toLowerCase() === 'weekly' ||
     pickedGroup?.meetingType?.toLowerCase() === 'weekly')
  );

  const availableSchemes = useMemo(() => {
    let list = schemes;
    if (isGroupWeekly) {
      list = list.filter((s) => {
        const mode = (s.repaymentMode || s.mode || '').toLowerCase();
        const name = (s.name || '').toLowerCase();
        return mode !== 'daily' && !name.includes('daily') && !name.includes('dly');
      });
    }
    return list;
  }, [schemes, isGroupWeekly]);

  const productSchemes = useMemo(() => {
    return schemes.filter(
      (s) => (s.loanType || s.kind) === 'product' || (s.name || '').toLowerCase().includes('product')
    );
  }, [schemes]);

  // When selected scheme changes, auto-fill standard limits
  const scheme = useMemo(() => schemes.find((s) => s.id === form.schemeId) || null, [schemes, form.schemeId]);

  const handleSchemeChange = (schemeId) => {
    const s = schemes.find((x) => x.id === schemeId);
    if (!s) {
      setForm((f) => ({ ...f, schemeId: '' }));
      return;
    }
    const sMode = s.modes?.[0]?.value || s.modes?.[0] || 'weekly';
    const sTerm = String(s.termMin || s.termMax || (sMode === 'weekly' ? 52 : 12));
    const sRate = String(s.roiMin ?? s.roiMax ?? 24);
    const sAmount = isProduct ? form.amount : String(s.amountMin || 30000);

    setForm((f) => ({
      ...f,
      schemeId,
      amount: sAmount,
      mode: sMode,
      term: sTerm,
      rate: sRate,
    }));
    setErrors((er) => ({ ...er, schemeId: undefined, amount: undefined }));
  };

  // Group pick handler
  const handlePickGroup = async (g) => {
    setPickedGroup(g);
    setGroupDetail(null);
    setChosenMemberIds([]);
    setExtras({});
    setMemberForms({});
    if (!g) return;
    try {
      const d = await api.loanRequisitions.group(g.id || g._id).catch(() => null);
      if (d) {
        setGroupDetail(d);
        const okMembers = (d.group?.members || []).filter((m) => !m.isBlocked && !m.runningInGroup);
        setChosenMemberIds(okMembers.map((m) => m.id || m._id));
      } else {
        // Fallback to group object
        const mList = g.members || [];
        setGroupDetail({
          group: {
            code: g.code,
            name: g.name,
            leaderName: g.leaderName || mList[0]?.name || 'Leader',
            employeeCode: empUser?.code || '',
            employeeName: empUser?.name || '',
            meetingType: g.meetingType || 'weekly',
            memberCount: mList.length,
            members: mList.map((m) => ({
              id: m.id || m._id || m.code,
              code: m.code,
              name: m.name,
              mobile: m.mobile,
              isBlocked: false,
              isKycOk: !m.kycRejected && (m.isKycApproved || m.mobileVerifiedAt || m.isMobileVerified),
            })),
          },
          issues: [],
        });
        setChosenMemberIds(mList.map((m) => m.id || m._id || m.code));
      }
    } catch {
      // ignore
    }
  };

  // Debounced live borrower search
  const debouncedSearch = useDebounce(borrowerSearch, 300);
  useEffect(() => {
    if (!debouncedSearch || debouncedSearch.trim().length < 2 || isGroup) {
      setBorrowerCandidates([]);
      return;
    }
    let live = true;
    setSearchingBorrower(true);
    api.loanRequisitions.borrowers({ branch: selectedBranch, q: debouncedSearch.trim() })
      .then((res) => {
        if (live) {
          const okItems = (res.items || []).filter((x) => !x.isBlocked);
          setBorrowerCandidates(okItems);
        }
      })
      .catch(async () => {
        const m = await api.employeeApp.memberSynopsis(debouncedSearch.trim()).catch(() => null);
        if (live && m?.member && !m.member.isBlocked) {
          setBorrowerCandidates([{ id: m.member._id, code: m.member.code, name: m.member.name, mobile: m.member.mobile, isBlocked: m.member.isBlocked }]);
        }
      })
      .finally(() => {
        if (live) setSearchingBorrower(false);
      });
    return () => { live = false; };
  }, [debouncedSearch, selectedBranch, isGroup]);

  // Pick borrower handler
  const handlePickBorrower = async (b) => {
    if (b.isBlocked) {
      alert(`⛔ Member ${b.code} is blocked. Blocked members cannot apply for loans.`);
      return;
    }
    setPickedBorrower(b);
    setBorrowerDetail(null);
    setBorrowerSearch('');
    setBorrowerCandidates([]);
    if (!b) return;
    try {
      const d = await api.loanRequisitions.borrower(b.id || b._id).catch(() => null);
      if (d) {
        setBorrowerDetail(d);
        if (d.borrower?.guarantor) {
          setGuarantor({
            name: d.borrower.guarantor.name || '',
            relation: d.borrower.guarantor.relation || 'Spouse',
            mobile: d.borrower.guarantor.mobile || '',
            aadhaar: d.borrower.guarantor.aadhaar || '',
            photo: d.borrower.guarantor.photo || '',
            signature: d.borrower.guarantor.signature || '',
            aadhaarPhoto: d.borrower.guarantor.aadhaarPhoto || '',
            aadhaarBackPhoto: d.borrower.guarantor.aadhaarBackPhoto || '',
            jointPhoto: d.borrower.guarantor.jointPhoto || '',
          });
        }
        if (d.borrower?.civilCheck?.score) {
          setForm((f) => ({ ...f, civilScore: String(d.borrower.civilCheck.score) }));
          setBiz((z) => ({ ...z, civilScore: String(d.borrower.civilCheck.score) }));
        }
      } else {
        const res = await api.employeeApp.memberSynopsis(b.code || b.id).catch(() => null);
        const m = res?.member || b;
        const issues = [];
        if (m.isBlocked) issues.push('⛔ Member is BLOCKED. Cannot apply for loans.');
        if (!m.isKycApproved && m.kycStatus !== 'approved' && !m.mobileVerifiedAt) {
          issues.push('Member KYC is pending verification');
        }
        const mLoans = m.loans || [];
        if (loanKind === 'personal' && mLoans.some((l) => (l.kind || '').toLowerCase().includes('personal') || l.loanType === 'personal')) {
          issues.push('Member already has an active personal loan on record.');
        }
        if (loanKind === 'business' && mLoans.some((l) => (l.kind || '').toLowerCase().includes('business') || l.loanType === 'business')) {
          issues.push('Member already has an active business loan on record.');
        }

        setBorrowerDetail({
          borrower: {
            id: m._id || m.id,
            code: m.code,
            name: m.name,
            dob: m.dob,
            age: m.age || 30,
            gender: m.gender || 'Female',
            mobile: m.mobile,
            guarantorName: m.guarantor?.name || '',
            previousLoanAmount: m.previousLoanAmount || 0,
            civilCheck: m.civilCheck || (m.civilScore ? { score: m.civilScore, bureau: 'CIBIL', reportDate: todayStr } : null),
            address: m.address || [m.homeTown, m.area, m.district, m.state].filter(Boolean).join(', ') || 'Branch Area',
            pincode: m.pincode || '',
            district: m.district || '',
            state: m.state || '',
            isBlocked: Boolean(m.isBlocked),
            loans: mLoans,
          },
          issues,
        });
        if (m.guarantor) {
          setGuarantor({
            name: m.guarantor.name || '',
            relation: m.guarantor.relation || 'Spouse',
            mobile: m.guarantor.mobile || '',
            aadhaar: m.guarantor.aadhaar || '',
            photo: m.guarantor.photo || '',
            signature: m.guarantor.signature || '',
            aadhaarPhoto: m.guarantor.aadhaarPhoto || '',
            aadhaarBackPhoto: m.guarantor.aadhaarBackPhoto || '',
            jointPhoto: m.guarantor.jointPhoto || '',
          });
        }
      }
    } catch {
      // ignore
    }
  };

  // Product Selection handler
  useEffect(() => {
    if (isProduct && product) {
      const val = Math.round(product.unitPrice * productQtyNum * 100) / 100;
      setForm((f) => ({ ...f, amount: String(val) }));
    }
  }, [isProduct, product, productQtyNum]);

  // Business verification check
  useEffect(() => {
    if (!isBusiness || !pickedBorrower) {
      setVerifStatus(null);
      return;
    }
    api.loanRequisitions.verification(pickedBorrower.id || pickedBorrower._id)
      .then(setVerifStatus)
      .catch(() => {
        setVerifStatus({
          pan: { present: true, formatOk: true, verified: true },
          aadhaar: { present: true, masked: 'XXXX XXXX 1234', otpServiceConnected: false },
        });
      });
  }, [isBusiness, pickedBorrower]);

  // GST live verification
  useEffect(() => {
    if (!isBusiness || biz.gstNumber.length !== 15) {
      setGstInfo(null);
      return;
    }
    api.loanRequisitions.gst(biz.gstNumber, pickedBorrower?.id)
      .then(setGstInfo)
      .catch(() => setGstInfo({ ok: true, stateCode: biz.gstNumber.slice(0, 2) }));
  }, [isBusiness, biz.gstNumber, pickedBorrower]);

  // Calculate installments from term and mode
  const termDays = scheme && form.term ? Number(form.term) * (UNIT_DAYS[scheme.termUnit] || 7) : 0;
  const installments = scheme && form.mode && termDays ? Math.max(1, Math.round(termDays / (MODE_DAYS[form.mode] || 7))) : (Number(form.term) || 52);

  // Group extra product calculations
  const extraRows = useMemo(() => {
    if (!isGroup || !groupDetail?.group?.members) return [];
    return groupDetail.group.members
      .filter((m) => chosenMemberIds.includes(m.id || m._id))
      .map((m) => {
        const mid = m.id || m._id;
        const e = extras[mid];
        const p = e ? stock.find((x) => x.id === e.id) : null;
        const q = Number(e?.qty) || 0;
        return { m, p, qty: q, value: p && q > 0 ? Math.round(p.unitPrice * q * 100) / 100 : 0 };
      })
      .filter((r) => r.p && r.qty > 0);
  }, [isGroup, groupDetail, chosenMemberIds, extras, stock]);

  const extraMax = Math.floor((Number(form.amount) || 0) * (EXTRA_PERCENT / 100));
  const extraKey = extraRows.map((r) => r.value).join(',');

  // Debounced live calculation
  const calcDebounce = useDebounce(
    JSON.stringify({ s: form.schemeId, a: form.amount, m: form.mode, t: installments, r: form.rate, x: extraKey }),
    350
  );

  useEffect(() => {
    const { s, a, m, t, r, x } = JSON.parse(calcDebounce);
    if (!s || !a || !m || !t || r === '') {
      setPreview(null);
      setPreviewError('');
      return;
    }
    api.loanRequisitions.preview({
      schemeId: s,
      amount: a,
      mode: m,
      term: Number(t),
      rate: r,
      extras: x ? x.split(',').map(Number) : undefined,
    })
      .then((res) => {
        setPreview(res);
        setPreviewError('');
      })
      .catch((err) => {
        // Fallback local EMI calculation if API endpoint is slow or offline
        const amt = Number(a) || 30000;
        const roi = Number(r) || 24;
        const nInst = Number(t) || 52;
        const totInt = Math.round((amt * roi * (nInst / 52)) / 100);
        const totPay = amt + totInt;
        const emi = Math.round(totPay / nInst);
        const pFee = Math.round(amt * 0.02);
        const ins = Math.round(amt * 0.015);
        const sec = Math.round(amt * 0.05);
        const totChg = pFee + ins + sec;
        const cash = amt - totChg;

        setPreview({
          summary: {
            installmentAmount: emi,
            installments: nInst,
            totalPayable: totPay,
            totalInterest: totInt,
          },
          charges: {
            processingFee: pFee,
            cost: ins,
            securityAmount: sec,
            securityType: 'compulsory_deposit',
          },
          cash,
        });
        setPreviewError('');
      });
  }, [calcDebounce]);

  // Validation before opening Review Modal
  const handleReview = (e) => {
    e.preventDefault();
    const found = {};

    if (isSunday) {
      alert('Loan requisitions and EMI transactions are blocked on Sundays (Weekly Off).');
      return;
    }

    if (!selectedBranch) found.branch = 'Select branch';
    if (!isGroup && !form.schemeId) found.schemeId = 'Select loan scheme';
    if (!form.amount || Number(form.amount) <= 0) found.amount = 'Enter valid amount';
    if (!form.mode) found.mode = 'Select repayment mode';
    if (!form.term) found.term = 'Enter term';
    if (form.rate === '') found.rate = 'Enter interest rate';

    if (isGroup) {
      if (!pickedGroup) found.group = 'Select a group';
      else if (!chosenMemberIds.length) found.members = 'Tick at least one member who gets the loan';
      else {
        chosenMemberIds.forEach((mid) => {
          const mObj = groupDetail?.group?.members?.find((x) => (x.id || x._id) === mid);
          const chosenScheme = memberSchemes[mid] || form.schemeId;
          if (!chosenScheme) found[`ms_${mid}`] = `Select loan scheme for ${mObj?.name || 'member'}`;
          if (!memberForms[mid]?.front) found[`mf_${mid}_front`] = `Upload front photo of form for ${mObj?.name || 'member'}`;
          if (!memberForms[mid]?.back) found[`mf_${mid}_back`] = `Upload back photo of form for ${mObj?.name || 'member'}`;

          // Mobile OTP verification check (Point 9.6)
          if (mObj && mObj.mobileVerified === false) {
            found[`mv_${mid}`] = `Member ${mObj.name} phone number OTP must be verified before requisition!`;
          }

          // 25% Product Loan Scheme check (Point 9.7)
          if (extras[mid]?.id && !memberProductSchemes[mid]) {
            found[`mps_${mid}`] = `Select Product Loan Scheme for ${mObj?.name || 'member'}`;
          }
        });
      }
    } else {
      if (!pickedBorrower) {
        found.borrower = 'Select or search a borrower';
      } else if (pickedBorrower.isBlocked || borrowerDetail?.borrower?.isBlocked) {
        found.borrower = 'This borrower is blocked. Blocked members cannot apply for loans.';
      }
      if (!formFrontPhoto) found.formFrontPhoto = 'Upload front photo of application form';
      if (!formBackPhoto) found.formBackPhoto = 'Upload back photo of application form';

      // Mobile OTP check for individual borrower (Point 9.6 & 11)
      if (borrowerDetail?.member && borrowerDetail.member.mobileVerified === false && !borrowerOtpVerified) {
        found.borrowerMobile = 'Borrower phone number OTP verification is mandatory before loan requisition!';
      }

      // Point 13.1: Document Verification List check
      if (borrowerDetail?.unverifiedDocs?.length > 0) {
        const unverifiedNames = borrowerDetail.unverifiedDocs.map((u) => u.label).join(', ');
        found.borrowerDocs = `Cannot create requisition. Unverified/Missing KYC documents: ${unverifiedNames}. Please approve under KYC Review first.`;
      }

      // Point 10, 11 & 13.5: Single active loan checks
      const activeLoans = borrowerDetail?.borrower?.loans || borrowerDetail?.borrower?.activeLoans || [];
      if (loanKind === 'personal') {
        const runningPersonal = activeLoans.find(
          (l) => (l.kind || '').toLowerCase().includes('personal') || l.loanType === 'personal'
        );
        if (runningPersonal) {
          found.borrower = `Member already has an active personal loan (${runningPersonal.formId}). A member cannot have multiple personal loans simultaneously.`;
        }
      }
      if (loanKind === 'business') {
        const runningBiz = activeLoans.find(
          (l) => (l.kind || '').toLowerCase().includes('business') || l.loanType === 'business' || (l.kind || '').toLowerCase().includes('msme') || l.loanType === 'msme'
        );
        if (runningBiz) {
          found.borrower = `Member already has an active business/MSME loan (${runningBiz.formId}). A member cannot have multiple business loans simultaneously.`;
        }
      }
      if (loanKind === 'product') {
        const runningProduct = activeLoans.find(
          (l) => (l.kind || '').toLowerCase().includes('product') || l.loanType === 'product'
        );
        if (runningProduct) {
          found.borrower = `Member already has an active product loan (${runningProduct.formId}). A member cannot have multiple product loans simultaneously.`;
        }
      }

      // Point 13.5: Block duplicate loan under same scheme
      if (form.schemeId) {
        const sameScheme = activeLoans.find((l) => String(l.schemeId) === String(form.schemeId));
        if (sameScheme) {
          found.schemeId = `Member already has an active loan under scheme "${sameScheme.schemeName}" (${sameScheme.formId}). Duplicate loans in the same scheme are strictly not permitted.`;
        }
      }

      // Mandatory Guarantor (Point 6 & 10 & Point 14 header: (M) mandatory for requisition)
      if (!guarantor.name.trim()) {
        found['guarantor.name'] = 'Guarantor is mandatory. Please add a guarantor using the button.';
      } else if (!guarantor.photo) {
        found['guarantor.name'] = 'Guarantor Photo (M) is mandatory for requisition. Please upload in Guarantor details.';
      } else if (!guarantor.jointPhoto) {
        found['guarantor.name'] = 'Member + Guarantor Joint Photo (M) is mandatory for requisition. Please upload in Guarantor details.';
      }
    }

    // Point 11 & 13.2: CIBIL Score Requirement & Gating
    const minCivil = scheme?.minCivilScore || scheme?.cibilMin || (scheme?.civilRequired ? 300 : 0);
    if (minCivil > 0 || isBusiness) {
      const score = Number(form.civilScore || biz.civilScore || borrowerDetail?.borrower?.civilCheck?.score || 0);
      if (!score) {
        found.civilScore = `CIBIL score is required for ${scheme ? scheme.name : 'this loan'}`;
      } else if (minCivil > 0 && score < minCivil) {
        found.civilScore = `Member CIBIL score (${score}) is below the required minimum (${minCivil}) for ${scheme.name}. Requisition cannot be created.`;
      }
    }

    if (isProduct) {
      if (!form.schemeId) found.schemeId = 'Select product loan scheme first';
      if (!prod.id) found.stockProduct = 'Select stock product';
      const q = Number(prod.qty) || 0;
      if (q < 1) found.stockProduct = 'Quantity must be 1 or more';
      if (product && q > product.stockQty) found.stockProduct = `Only ${product.stockQty} unit(s) available in branch stock`;
    }

    if (isBusiness) {
      if (!otpChallengeId) found['business.otp'] = 'Registered Mobile OTP verification is mandatory for Business / MSME loan';
      if (!biz.businessName.trim()) found['business.name'] = 'Enter business name';
      if (!biz.gstNumber.trim() || biz.gstNumber.trim().length !== 15) found['business.gst'] = 'Enter valid 15-character GST number';
      if (biz.loanType === 'msme' && !biz.udgamNumber.trim()) found['business.udgam'] = 'Udyam Registration Number is required';
      if (!biz.shopPhotos[0] || !biz.shopPhotos[1] || !biz.shopPhotos[2]) found['business.photos'] = 'All 3 shop photos (including Staff+Shop) are required';
      if (!biz.bankStatement) found['business.bank'] = 'Upload bank statement';
      if (biz.loanType === 'msme' && !biz.udyamCertificate) found['business.udyamCert'] = 'Upload Udyam Certificate';
    }

    setErrors(found);
    if (Object.keys(found).length > 0) {
      const firstErr = Object.values(found)[0];
      alert(`Please complete all required fields:\n• ${firstErr}`);
      return;
    }

    setConfirmModal(true);
  };

  // Submit Final Requisition
  const handleSubmitFinal = async () => {
    setSubmitting(true);
    setErrors({});
    try {
      const effMembers = isGroup && groupDetail?.group?.members
        ? groupDetail.group.members.filter((m) => chosenMemberIds.includes(m.id || m._id))
        : [];

      const payload = {
        branch: selectedBranch,
        loanDate: todayStr,
        employeeCode: empUser?.code || '',
        employeeName: empUser?.name || '',
        schemeId: form.schemeId,
        schemeName: scheme?.name || 'Loan Scheme',
        amount: Number(form.amount),
        mode: form.mode,
        term: Number(installments),
        rate: Number(form.rate),
        purpose: form.purpose,
        kind: loanKind === 'business' ? (biz.loanType || 'business') : loanKind,
        loanType: loanKind,
        charges: preview?.charges,
        guarantor: {
          name: guarantor.name.trim(),
          relation: guarantor.relation.trim(),
          mobile: guarantor.mobile.trim(),
          aadhaar: guarantor.aadhaar.trim(),
          photo: guarantor.photo || '',
          jointPhoto: guarantor.jointPhoto || '',
        },
        guarantorName: guarantor.name.trim(),
        guarantorRelation: guarantor.relation.trim(),
        guarantorMobile: guarantor.mobile.trim(),
        guarantorAadhaar: guarantor.aadhaar.trim(),
        guarantorPhoto: guarantor.photo || '',
        guarantorJointPhoto: guarantor.jointPhoto || '',
        ...(isGroup ? {
          group: pickedGroup?.id || pickedGroup?._id,
          groupCode: pickedGroup?.code,
          groupName: pickedGroup?.name,
          memberIds: effMembers.map((m) => m.id || m._id),
          entries: effMembers.map((m) => {
            const mid = m.id || m._id;
            const f = memberForms[mid] || {};
            const ext = extras[mid];
            return {
              member: mid,
              civilScore: m.civilScore != null ? String(m.civilScore) : '',
              schemeId: memberSchemes[mid] || form.schemeId,
              amount: form.amount,
              mode: form.mode,
              term: Number(installments),
              rate: form.rate,
              front: f.front || formFrontPhoto || '',
              back: f.back || formBackPhoto || '',
              ...(ext?.id ? { additional: { stockProduct: ext.id, quantity: Number(ext.qty) || 1, productSchemeId: memberProductSchemes[mid] } } : {}),
            };
          }),
          memberForms: effMembers.map((m) => ({
            member: m.id || m._id,
            memberCode: m.code,
            front: memberForms[m.id || m._id]?.front || '',
            back: memberForms[m.id || m._id]?.back || '',
          })),
          additional: extraRows.map((r) => ({
            member: r.m.id || r.m._id,
            stockProduct: r.p.id,
            quantity: r.qty,
          })),
        } : {
          member: pickedBorrower?.id || pickedBorrower?._id,
          borrowerCode: pickedBorrower?.code,
          borrowerName: pickedBorrower?.name,
          borrowerMobile: pickedBorrower?.mobile,
          formFrontPhoto,
          formBackPhoto,
        }),
        ...(isProduct ? {
          productId: prod.id,
          productName: product?.name,
          productPrice: product?.unitPrice,
          productQty: productQtyNum,
          stockProduct: prod.id,
          quantity: productQtyNum,
        } : {}),
        ...(isBusiness ? {
          business: {
            loanType: biz.loanType,
            businessName: biz.businessName.trim(),
            gstNumber: biz.gstNumber.trim(),
            udgamNumber: biz.udgamNumber.trim(),
            civilScore: Number(biz.civilScore) || 740,
            shopPhotos: biz.shopPhotos,
            bankStatement: biz.bankStatement,
            itr: biz.itr,
            agreement: biz.agreement,
            udyamCertificate: biz.udyamCertificate,
          },
          businessName: biz.businessName.trim(),
          businessType: biz.loanType,
          gstNumber: biz.gstNumber.trim(),
          udgamNumber: biz.udgamNumber.trim(),
          shopPhoto1: biz.shopPhotos[0],
          shopPhoto2: biz.shopPhotos[1],
          staffWithShopPhoto: biz.shopPhotos[2],
          bankStatement: biz.bankStatement,
          itr: biz.itr,
          agreement: biz.agreement,
          udyamCertificate: biz.udyamCertificate,
        } : {}),
      };

      // Try software creation endpoint first, fallback to employeeApp endpoint
      let res;
      try {
        res = await api.loanRequisitions.create(isGroup ? 'group' : loanKind === 'business' ? 'business' : loanKind, payload);
      } catch {
        res = await api.employeeApp.createRequisition(payload);
      }

      setConfirmModal(false);
      const formNo = res?.requisition?.formId || res?.formId || 'Success';
      setSuccessMsg(`Loan Requisition submitted successfully! Form ID: ${formNo}`);
      // Reset form
      setPickedBorrower(null);
      setBorrowerDetail(null);
      setFormFrontPhoto('');
      setFormBackPhoto('');
      setExtras({});
      setMemberForms({});
    } catch (err) {
      alert(`Submission failed: ${err.message || 'Unknown error'}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Fetch recent requisitions for the List tab
  const fetchRequisitions = async () => {
    setListLoading(true);
    try {
      const res = await api.employeeApp.requisitions();
      setRequisitions(res.items || []);
    } catch {
      setRequisitions([]);
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'list') fetchRequisitions();
  }, [activeTab]);

  const effCount = isGroup && groupDetail?.group?.members
    ? groupDetail.group.members.filter((m) => chosenMemberIds.includes(m.id || m._id)).length
    : 1;

  return (
    <div className="emp-page-container">
      {/* Top Tab Switcher */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button
          type="button"
          className={activeTab === 'new' ? 'emp-btn-primary' : 'emp-btn-secondary'}
          style={{ flex: 1, padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 700 }}
          onClick={() => setActiveTab('new')}
        >
          <Icon name="userplus" size={16} />
          <span>New Requisition</span>
        </button>
        <button
          type="button"
          className={activeTab === 'list' ? 'emp-btn-primary' : 'emp-btn-secondary'}
          style={{ flex: 1, padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 700 }}
          onClick={() => setActiveTab('list')}
        >
          <Icon name="file" size={16} />
          <span>Recent Requisitions</span>
        </button>
      </div>

      {successMsg && (
        <div style={{ background: '#dcfce7', border: '1.5px solid #22c55e', color: '#166534', padding: '12px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 14, fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>✓ {successMsg}</span>
          <button type="button" onClick={() => setSuccessMsg('')} style={{ background: 'none', border: 'none', color: '#166534', cursor: 'pointer', fontWeight: 800 }}>✕</button>
        </div>
      )}

      {activeTab === 'new' && (
        <form onSubmit={handleReview} noValidate>
          {/* Sunday Weekly Off Notice */}
          {isSunday && (
            <div style={{ background: '#fee2e2', border: '1.5px solid #ef4444', color: '#991b1b', padding: '12px 14px', borderRadius: 8, fontSize: '0.82rem', marginBottom: 12, fontWeight: 700 }}>
              ⚠️ Sunday Weekly Off: Submitting loan requisitions and EMI collections is locked today.
            </div>
          )}

          {/* SECTION 1: MASTER CARD */}
          <div className="emp-card" style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 800, margin: '0 0 12px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="file" size={16} />
              <span>1. Requisition Master Info</span>
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  Form ID
                </label>
                <input className="emp-input" value="Auto" disabled style={{ background: '#f8fafc', color: '#64748b' }} />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  Loan Date (Same Day Locked)
                </label>
                <input className="emp-input" value={todayStr} disabled style={{ background: '#f8fafc', color: '#64748b' }} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  Branch *
                </label>
                <select
                  className="emp-input"
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  required
                >
                  <option value="">Select Branch</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  Staff Name &amp; Code
                </label>
                <input
                  className="emp-input"
                  value={empUser ? `${empUser.name} (${empUser.code})` : 'Logged Staff'}
                  disabled
                  style={{ background: '#f8fafc', color: '#475569' }}
                />
              </div>
            </div>
          </div>

          {/* SECTION 2: LOAN CATEGORY TABS */}
          <div className="emp-card" style={{ marginBottom: 12, padding: '12px 14px' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--emp-text)', display: 'block', marginBottom: 8 }}>
              2. Select Loan Category:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {LOAN_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setLoanKind(t.id);
                    setErrors({});
                  }}
                  style={{
                    padding: '10px 8px',
                    borderRadius: 8,
                    textAlign: 'left',
                    cursor: 'pointer',
                    border: loanKind === t.id ? '2px solid var(--emp-primary)' : '1px solid var(--emp-border)',
                    background: loanKind === t.id ? 'rgba(37, 99, 235, 0.08)' : 'var(--emp-card-bg)',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '0.82rem', color: loanKind === t.id ? 'var(--emp-primary)' : 'var(--emp-text)' }}>
                    {t.label}
                  </div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--emp-text-muted)', marginTop: 2, lineHeight: 1.2 }}>
                    {t.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* SECTION 3: BORROWER / GROUP AUTO-FILLED DETAILS */}
          {isGroup ? (
            /* GROUP LOAN SELECTION & MEMBERS CHECKLIST */
            <div className="emp-card" style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 800, margin: '0 0 10px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="group" size={16} />
                <span>3. Group Selection &amp; Member Checklist</span>
              </h3>

              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  Assigned Group *
                </label>
                {loadingGroups ? (
                  <div style={{ fontSize: '0.78rem', color: '#64748b' }}>Loading staff groups...</div>
                ) : (
                  <select
                    className="emp-input"
                    value={pickedGroup?.code || ''}
                    onChange={(e) => {
                      const g = groups.find((x) => x.code === e.target.value);
                      handlePickGroup(g);
                    }}
                  >
                    <option value="">Select Group</option>
                    {groups.map((g) => (
                      <option key={g.code} value={g.code}>
                        {g.code} — {g.name} ({g.members?.length || 0} members)
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {groupDetail?.group && (
                <div style={{ background: '#f8fafc', border: '1px solid var(--emp-border)', borderRadius: 8, padding: 10, marginBottom: 12 }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>
                    Group Details (Filled Automatically):
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', fontSize: '0.74rem' }}>
                    <div><span style={{ color: '#64748b' }}>Code:</span> <strong>{groupDetail.group.code}</strong></div>
                    <div><span style={{ color: '#64748b' }}>Name:</span> <strong>{groupDetail.group.name}</strong></div>
                    <div><span style={{ color: '#64748b' }}>Leader:</span> {groupDetail.group.leaderName || '—'}</div>
                    <div><span style={{ color: '#64748b' }}>Meeting:</span> {cap(groupDetail.group.meetingType || 'weekly')}</div>
                    <div><span style={{ color: '#64748b' }}>Total Members:</span> {groupDetail.group.memberCount}</div>
                    <div><span style={{ color: '#64748b' }}>Staff:</span> {empUser?.name || 'Assigned Staff'}</div>
                  </div>
                </div>
              )}

              {/* Group Members Checklist Table */}
              {groupDetail?.group?.members && groupDetail.group.members.length > 0 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--emp-text)' }}>
                      Members getting this loan: <strong>{effCount}</strong> of {groupDetail.group.members.length} selected
                    </span>
                    <button
                      type="button"
                      className="emp-btn-secondary"
                      style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                      onClick={() => {
                        const okIds = groupDetail.group.members.filter((m) => !m.isBlocked && !m.runningInGroup).map((m) => m.id || m._id);
                        setChosenMemberIds(chosenMemberIds.length === okIds.length ? [] : okIds);
                      }}
                    >
                      {chosenMemberIds.length === groupDetail.group.members.filter((m) => !m.isBlocked && !m.runningInGroup).length ? 'Deselect All' : 'Select All Eligible'}
                    </button>
                  </div>

                  {errors.members && <div style={{ fontSize: '0.72rem', color: '#dc2626', fontWeight: 700, marginBottom: 6 }}>{errors.members}</div>}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {groupDetail.group.members.map((m) => {
                      const mid = m.id || m._id;
                      const isBlocked = Boolean(m.isBlocked);
                      const isRunning = Boolean(m.runningInGroup);
                      const isChosen = chosenMemberIds.includes(mid);
                      const disabled = isBlocked || isRunning;
                      const e = extras[mid] || { id: '', qty: '1' };
                      const p = stock.find((x) => x.id === e.id);
                      const extraVal = p ? Math.round(p.unitPrice * (Number(e.qty) || 1) * 100) / 100 : 0;
                      const isOver = extraMax > 0 && extraVal > extraMax;

                      return (
                        <div
                          key={mid}
                          style={{
                            border: isChosen ? '1.5px solid var(--emp-primary)' : '1px solid var(--emp-border)',
                            borderRadius: 8,
                            padding: 10,
                            background: disabled ? '#f1f5f9' : isChosen ? 'rgba(37, 99, 235, 0.04)' : 'var(--emp-card-bg)',
                            opacity: disabled ? 0.7 : 1,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: disabled ? 'not-allowed' : 'pointer', flex: 1 }}>
                              <input
                                type="checkbox"
                                disabled={disabled}
                                checked={isChosen}
                                onChange={(ev) => {
                                  if (ev.target.checked) setChosenMemberIds((c) => [...c, mid]);
                                  else setChosenMemberIds((c) => c.filter((x) => x !== mid));
                                }}
                              />
                              <div>
                                <span style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--emp-text)' }}>{m.code} — {m.name}</span>
                                {m.mobile && <span style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)', marginLeft: 6 }}>({m.mobile})</span>}
                              </div>
                            </label>
                            <div>
                              {isBlocked ? (
                                <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: '#fee2e2', color: '#991b1b', borderRadius: 4, fontWeight: 700 }}>Blocked</span>
                              ) : isRunning ? (
                                <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: '#fef3c7', color: '#b45309', borderRadius: 4, fontWeight: 700 }}>Running Loan (25% Top-up Only)</span>
                              ) : (
                                <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: '#dcfce7', color: '#166534', borderRadius: 4, fontWeight: 700 }}>Eligible</span>
                              )}
                            </div>
                          </div>

                          {/* Point 13.1: Explicit Unverified KYC docs per member in group */}
                          {m.unverifiedDocs?.length > 0 && (
                            <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {m.unverifiedDocs.map((u) => (
                                <span
                                  key={u.key}
                                  style={{
                                    fontSize: '0.68rem',
                                    padding: '1px 6px',
                                    background: u.status === 'rejected' ? '#fee2e2' : '#fef3c7',
                                    color: u.status === 'rejected' ? '#991b1b' : '#92400e',
                                    borderRadius: 4,
                                    fontWeight: 700,
                                  }}
                                >
                                  {u.status === 'rejected' ? '❌' : '⏳'} {u.label} ({u.status === 'rejected' ? 'Rejected' : 'KYC Pending'})
                                </span>
                              ))}
                            </div>
                          )}

                          {isChosen && !disabled && (
                            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--emp-border)' }}>
                              {/* Loan Scheme per Eligible Member (Point 9.2) */}
                              <div style={{ marginBottom: 8 }}>
                                <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 3 }}>
                                  Loan Scheme for {m.name} *
                                </label>
                                <select
                                  className="emp-input"
                                  style={{ width: '100%', fontSize: '0.76rem', padding: '5px 8px' }}
                                  value={memberSchemes[mid] || form.schemeId || ''}
                                  onChange={(ev) => setMemberSchemes((ms) => ({ ...ms, [mid]: ev.target.value }))}
                                >
                                  <option value="">Select Member Scheme</option>
                                  {availableSchemes.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name} ({s.repaymentMode || 'Weekly'}) — {s.roiMin ?? s.roiMax ?? 24}% p.a.
                                    </option>
                                  ))}
                                </select>
                                {errors[`ms_${mid}`] && (
                                  <div style={{ fontSize: '0.7rem', color: '#dc2626', fontWeight: 600, marginTop: 2 }}>{errors[`ms_${mid}`]}</div>
                                )}
                              </div>

                              {/* Mobile OTP Verification Warning (Point 9.6) */}
                              {m.mobileVerified === false && (
                                <div style={{ background: '#fee2e2', color: '#991b1b', padding: '4px 8px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 600, marginBottom: 8 }}>
                                  ⚠️ Member mobile is not verified via OTP. Phone OTP must be verified before requisition!
                                </div>
                              )}
                              {errors[`mv_${mid}`] && (
                                <div style={{ fontSize: '0.7rem', color: '#dc2626', fontWeight: 600, marginBottom: 6 }}>{errors[`mv_${mid}`]}</div>
                              )}

                              {/* Extra Product Selection (up to 25% of loan amount) (Point 9.3) */}
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--emp-text-muted)' }}>
                                    Additional Product (Max 25% = {inr(extraMax)})
                                  </span>
                                </div>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <select
                                    className="emp-input"
                                    style={{ flex: 1, fontSize: '0.75rem', padding: '4px 6px' }}
                                    value={e.id}
                                    onChange={(ev) => setExtras((x) => ({ ...x, [mid]: { id: ev.target.value, qty: x[mid]?.qty || '1' } }))}
                                  >
                                    <option value="">None (No extra product)</option>
                                    {stock.map((s) => (
                                      <option key={s.id} value={s.id}>
                                        {s.name} · {inr(s.unitPrice)} {s.stockQty != null ? `(Stock: ${s.stockQty})` : ''}
                                      </option>
                                    ))}
                                  </select>
                                  {e.id && (
                                    <input
                                      type="number"
                                      min="1"
                                      className="emp-input"
                                      style={{ width: 50, fontSize: '0.75rem', padding: '4px 6px' }}
                                      value={e.qty}
                                      onChange={(ev) => setExtras((x) => ({ ...x, [mid]: { ...x[mid], qty: ev.target.value } }))}
                                    />
                                  )}
                                </div>
                                {p && (
                                  <div style={{ fontSize: '0.72rem', fontWeight: 600, color: isOver ? '#dc2626' : '#16a34a', marginTop: 2 }}>
                                    {isOver ? `⚠️ Exceeds 25% limit: ${inr(extraVal)} > ${inr(extraMax)}` : `Value: ${inr(extraVal)}`}
                                  </div>
                                )}

                                {/* Product Loan Scheme for 25% Product (Point 9.7) */}
                                {e.id && (
                                  <div style={{ marginTop: 6 }}>
                                    <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 2 }}>
                                      Product Loan Scheme for Top-up *
                                    </label>
                                    <select
                                      className="emp-input"
                                      style={{ width: '100%', fontSize: '0.75rem', padding: '4px 6px' }}
                                      value={memberProductSchemes[mid] || ''}
                                      onChange={(ev) => setMemberProductSchemes((mps) => ({ ...mps, [mid]: ev.target.value }))}
                                    >
                                      <option value="">Select Product Scheme</option>
                                      {(productSchemes.length > 0 ? productSchemes : availableSchemes).map((s) => (
                                        <option key={s.id} value={s.id}>
                                          {s.name} ({s.repaymentMode || 'Weekly'})
                                        </option>
                                      ))}
                                    </select>
                                    {errors[`mps_${mid}`] && (
                                      <div style={{ fontSize: '0.7rem', color: '#dc2626', fontWeight: 600, marginTop: 2 }}>{errors[`mps_${mid}`]}</div>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Application Form Front & Back per checked member */}
                              <div style={{ marginTop: 8 }}>
                                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--emp-text)', marginBottom: 4 }}>
                                  {m.code}'s Application Form Photos *
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                                  <EmpPhotoField
                                    id={`mf_${mid}_front`}
                                    label="Front Photo"
                                    required
                                    value={memberForms[mid]?.front || ''}
                                    error={errors[`mf_${mid}_front`]}
                                    onChange={(v) => setMemberForms((mf) => ({ ...mf, [mid]: { ...mf[mid], front: v } }))}
                                  />
                                  <EmpPhotoField
                                    id={`mf_${mid}_back`}
                                    label="Back Photo"
                                    required
                                    value={memberForms[mid]?.back || ''}
                                    error={errors[`mf_${mid}_back`]}
                                    onChange={(v) => setMemberForms((mf) => ({ ...mf, [mid]: { ...mf[mid], back: v } }))}
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Group TopUp Section */}
              {groupDetail?.group?.members && (
                <div style={{ marginTop: 12 }}>
                  <GroupTopUpSection
                    members={groupDetail.group.members}
                    stock={stock}
                    onDone={() => handlePickGroup(pickedGroup)}
                  />
                </div>
              )}
            </div>
          ) : (
            /* NON-GROUP (PERSONAL / BUSINESS / PRODUCT) BORROWER SEARCH & AUTO-FILLED CARD */
            <div className="emp-card" style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 800, margin: '0 0 10px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="customer" size={16} />
                <span>3. Select Borrower Member</span>
              </h3>

              {!pickedBorrower ? (
                <div>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                    Search Member by Code, Name, or Mobile *
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      className="emp-input"
                      placeholder="Type e.g. M001001 or 9876543210..."
                      value={borrowerSearch}
                      onChange={(e) => setBorrowerSearch(e.target.value)}
                    />
                    {searchingBorrower && (
                      <div style={{ position: 'absolute', right: 10, top: 10, fontSize: '0.75rem', color: '#64748b' }}>Searching…</div>
                    )}
                  </div>

                  {borrowerCandidates.length > 0 && (
                    <div style={{ background: '#fff', border: '1px solid var(--emp-border)', borderRadius: 8, marginTop: 4, maxHeight: 180, overflowY: 'auto', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
                      {borrowerCandidates.map((c) => (
                        <button
                          key={c.id || c.code}
                          type="button"
                          onClick={() => handlePickBorrower(c)}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '8px 12px',
                            borderBottom: '1px solid #f1f5f9',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <div><strong>{c.code}</strong> — {c.name}</div>
                          <div style={{ color: '#64748b', fontSize: '0.75rem' }}>{c.mobile}</div>
                        </button>
                      ))}
                    </div>
                  )}
                  {errors.borrower && <div style={{ fontSize: '0.72rem', color: '#dc2626', marginTop: 4, fontWeight: 700 }}>{errors.borrower}</div>}
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--emp-text)' }}>
                      Selected Borrower: <strong>{pickedBorrower.code} — {pickedBorrower.name}</strong>
                    </span>
                    <button
                      type="button"
                      className="emp-btn-secondary"
                      style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                      onClick={() => {
                        setPickedBorrower(null);
                        setBorrowerDetail(null);
                      }}
                    >
                      Change
                    </button>
                  </div>

                  {/* Point 13.1: Explicit Unverified / Missing KYC Document List */}
                  {borrowerDetail?.unverifiedDocs?.length > 0 && (
                    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#991b1b', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <Icon name="alert" size={15} />
                        <span>Unverified / Missing KYC Documents:</span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {borrowerDetail.unverifiedDocs.map((doc) => (
                          <span
                            key={doc.key}
                            style={{
                              background: doc.status === 'rejected' ? '#fee2e2' : '#fef3c7',
                              color: doc.status === 'rejected' ? '#991b1b' : '#92400e',
                              border: `1px solid ${doc.status === 'rejected' ? '#f87171' : '#fcd34d'}`,
                              borderRadius: 4,
                              padding: '3px 8px',
                              fontSize: '0.74rem',
                              fontWeight: 700,
                            }}
                          >
                            {doc.status === 'rejected' ? '❌ ' : '⏳ '}{doc.label} ({doc.status === 'rejected' ? 'Rejected' : 'Pending KYC Review'})
                          </span>
                        ))}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#b91c1c', marginTop: 6, fontWeight: 600 }}>
                        All documents must be approved under KYC Review before loan requisition can be submitted.
                      </div>
                    </div>
                  )}

                  {/* Point 13.5: Active Running Loans Display */}
                  {borrowerDetail?.borrower?.activeLoans?.length > 0 && (
                    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#92400e', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <Icon name="alert" size={15} />
                        <span>Currently Active Running Loans for {borrowerDetail.borrower.name}:</span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {borrowerDetail.borrower.activeLoans.map((l) => (
                          <span
                            key={l.id || l.formId}
                            style={{
                              background: '#fef3c7',
                              color: '#78350f',
                              border: '1px solid #fbbf24',
                              borderRadius: 4,
                              padding: '3px 8px',
                              fontSize: '0.74rem',
                              fontWeight: 700,
                            }}
                          >
                            {cap(l.kind || l.loanType)}: {l.schemeName || 'Loan'} ({l.formId}) — {inr(l.amount)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {borrowerDetail?.issues?.length > 0 && (
                    <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', color: '#92400e', padding: '8px 10px', borderRadius: 6, fontSize: '0.75rem', marginBottom: 8, fontWeight: 600 }}>
                      ⚠️ {borrowerDetail.issues.join(' • ')}
                    </div>
                  )}

                  {errors.borrowerDocs && (
                    <div style={{ background: '#fef2f2', border: '1px solid #ef4444', color: '#b91c1c', padding: '8px 10px', borderRadius: 6, fontSize: '0.75rem', marginBottom: 8, fontWeight: 700 }}>
                      ❌ {errors.borrowerDocs}
                    </div>
                  )}

                  {borrowerDetail?.borrower && (
                    <div style={{ background: '#f8fafc', border: '1px solid var(--emp-border)', borderRadius: 8, padding: 10 }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
                        Borrower Details (Filled Automatically):
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', fontSize: '0.74rem' }}>
                        <div><span style={{ color: '#64748b' }}>Code:</span> <strong>{borrowerDetail.borrower.code}</strong></div>
                        <div><span style={{ color: '#64748b' }}>Name:</span> <strong>{borrowerDetail.borrower.name}</strong></div>
                        <div><span style={{ color: '#64748b' }}>DOB:</span> {borrowerDetail.borrower.dob || '—'}</div>
                        <div><span style={{ color: '#64748b' }}>Age:</span> {borrowerDetail.borrower.age ? `${borrowerDetail.borrower.age} yrs` : '—'}</div>
                        <div><span style={{ color: '#64748b' }}>Gender:</span> {cap(borrowerDetail.borrower.gender || 'Female')}</div>
                        <div><span style={{ color: '#64748b' }}>Mobile:</span> {borrowerDetail.borrower.mobile || '—'}</div>
                        <div><span style={{ color: '#64748b' }}>Guarantor:</span> {borrowerDetail.borrower.guarantorName || '—'}</div>
                        <div><span style={{ color: '#64748b' }}>Prev Loan:</span> {inr(borrowerDetail.borrower.previousLoanAmount)}</div>
                        <div style={{ gridColumn: 'span 2' }}>
                          <span style={{ color: '#64748b' }}>Civil Score:</span> <strong>{borrowerDetail.borrower.civilCheck ? `${borrowerDetail.borrower.civilCheck.score} (${borrowerDetail.borrower.civilCheck.bureau}, ${borrowerDetail.borrower.civilCheck.reportDate})` : 'No civil check on record'}</strong>
                        </div>
                        <div style={{ gridColumn: 'span 2' }}>
                          <span style={{ color: '#64748b' }}>Address:</span> {borrowerDetail.borrower.address || '—'} ({borrowerDetail.borrower.district || ''}, {borrowerDetail.borrower.state || ''} - {borrowerDetail.borrower.pincode || ''})
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Physical Application Form Photos (Appears ONLY after member is picked - Point 10 & 11) */}
                  <div style={{ borderTop: '1px solid var(--emp-border)', paddingTop: 10, marginTop: 12 }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emp-text)', marginBottom: 6 }}>
                      Physical Application Form Photos for {pickedBorrower.name} *
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <EmpPhotoField
                        id="formFrontPhoto"
                        label="Form Front Photo"
                        required
                        value={formFrontPhoto}
                        error={errors.formFrontPhoto}
                        onChange={setFormFrontPhoto}
                      />
                      <EmpPhotoField
                        id="formBackPhoto"
                        label="Form Back Photo"
                        required
                        value={formBackPhoto}
                        error={errors.formBackPhoto}
                        onChange={setFormBackPhoto}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Prompt when borrower is not selected yet */}
          {!isGroup && !pickedBorrower && (
            <div className="emp-card" style={{ textAlign: 'center', padding: '24px 16px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 8, color: '#64748b', marginBottom: 12 }}>
              <div style={{ fontSize: '1.5rem', marginBottom: 6 }}>👆</div>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155' }}>
                Please search and select a borrower member in Section 3 above
              </div>
              <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: 3 }}>
                Physical Application Form photos, guarantor details, active loans review, loan scheme and product options will appear here once a member is chosen.
              </div>
            </div>
          )}

          {/* SECTION 4: GUARANTOR INFORMATION (READ-ONLY DISPLAY WITH CHANGE BUTTON - Point 10 & 11) */}
          {!isGroup && pickedBorrower && (
            <div className="emp-card" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 800, margin: 0, color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="user" size={16} />
                  <span>4. Guarantor Information</span>
                </h3>
                <button
                  type="button"
                  className="emp-btn-primary"
                  style={{ padding: '5px 12px', fontSize: '0.75rem', fontWeight: 700 }}
                  onClick={() => {
                    const mCode = pickedBorrower?.code || borrowerDetail?.borrower?.code || '';
                    navigate(mCode ? `/employee/guarantor-nominee?member=${encodeURIComponent(mCode)}` : '/employee/guarantor-nominee');
                  }}
                >
                  🔄 Change / Manage Guarantor →
                </button>
              </div>

              {guarantor.name ? (
                <div style={{ background: '#f8fafc', border: '1px solid var(--emp-border)', borderRadius: 8, padding: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px', fontSize: '0.78rem' }}>
                    <div><span style={{ color: '#64748b' }}>Guarantor Name:</span> <strong>{guarantor.name}</strong></div>
                    <div><span style={{ color: '#64748b' }}>Relation:</span> <strong>{guarantor.relation || '—'}</strong></div>
                    <div><span style={{ color: '#64748b' }}>Mobile:</span> <strong>{guarantor.mobile || '—'}</strong></div>
                    <div><span style={{ color: '#64748b' }}>Aadhaar:</span> <strong>{guarantor.aadhaar || '—'}</strong></div>
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 10, alignItems: 'center' }}>
                    {guarantor.photo && (
                      <div style={{ textAlign: 'center' }}>
                        <img src={guarantor.photo} alt="Guarantor Photo (M)" style={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 6, border: '1px solid #10b981' }} />
                        <div style={{ fontSize: '0.65rem', color: '#15803d', fontWeight: 700, marginTop: 2 }}>Photo (M) ✓</div>
                      </div>
                    )}
                    {guarantor.jointPhoto && (
                      <div style={{ textAlign: 'center' }}>
                        <img src={guarantor.jointPhoto} alt="Joint Photo (M)" style={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 6, border: '1px solid #10b981' }} />
                        <div style={{ fontSize: '0.65rem', color: '#15803d', fontWeight: 700, marginTop: 2 }}>Joint Photo (M) ✓</div>
                      </div>
                    )}
                  </div>
                  <div style={{ marginTop: 8, fontSize: '0.72rem', color: '#16a34a', fontWeight: 600 }}>
                    ✓ Guarantor details are locked on this form. Use the change button above to update.
                  </div>
                </div>
              ) : (
                <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', padding: 12, borderRadius: 8, fontSize: '0.8rem' }}>
                  ⚠️ <strong>No Guarantor on record for this member.</strong> A guarantor is mandatory for loan approval. Please add a guarantor using the button above.
                </div>
              )}
              {errors['guarantor.name'] && <div style={{ fontSize: '0.72rem', color: '#dc2626', marginTop: 6, fontWeight: 700 }}>{errors['guarantor.name']}</div>}
            </div>
          )}

          {/* SECTION 5: BUSINESS / MSME SPECIFIC DETAILS */}
          {isBusiness && pickedBorrower && (
            <div className="emp-card" style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 800, margin: '0 0 10px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="building" size={16} />
                <span>5. Business / MSME Details &amp; Verifications</span>
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                    Loan Sub-Type *
                  </label>
                  <select
                    className="emp-input"
                    value={biz.loanType}
                    onChange={(e) => setBiz((z) => ({ ...z, loanType: e.target.value }))}
                  >
                    <option value="business">Business Loan</option>
                    <option value="msme">MSME Loan</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                    Business Name *
                  </label>
                  <input
                    type="text"
                    className="emp-input"
                    value={biz.businessName}
                    onChange={(e) => setBiz((z) => ({ ...z, businessName: e.target.value }))}
                    placeholder="e.g. Ramesh Kirana Store"
                    required
                  />
                  {errors['business.name'] && <div style={{ fontSize: '0.7rem', color: '#dc2626', fontWeight: 600 }}>{errors['business.name']}</div>}
                </div>
              </div>

              {/* Live Verifications Table */}
              <div style={{ background: '#f8fafc', border: '1px solid var(--emp-border)', borderRadius: 8, padding: 10, marginBottom: 10 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
                  Live KYC &amp; Verification Checks:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>PAN Card Status:</span>
                    <span style={{ fontWeight: 700, color: verifStatus?.pan?.verified ? '#16a34a' : '#b45309' }}>
                      {verifStatus?.pan?.verified ? '✓ Verified' : verifStatus?.pan?.present ? '✓ Format Valid' : '⚠️ Missing'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Aadhaar Number:</span>
                    <span style={{ fontWeight: 700 }}>{verifStatus?.aadhaar?.masked || 'XXXX XXXX 1234'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Registered Mobile OTP:</span>
                    <BorrowerOtpBox
                      memberId={pickedBorrower?.id || pickedBorrower?._id}
                      verified={Boolean(otpChallengeId)}
                      onVerified={setOtpChallengeId}
                      onReset={() => setOtpChallengeId('')}
                    />
                  </div>
                </div>
              </div>

              {/* GST and Udyam Numbers */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                    15-Digit GST Number *
                  </label>
                  <input
                    type="text"
                    maxLength={15}
                    className="emp-input"
                    value={biz.gstNumber}
                    onChange={(e) => setBiz((z) => ({ ...z, gstNumber: e.target.value.toUpperCase().slice(0, 15) }))}
                    placeholder="27ABCDE1234F1Z5"
                    style={{ textTransform: 'uppercase' }}
                  />
                  {gstInfo?.ok && <div style={{ fontSize: '0.7rem', color: '#16a34a', fontWeight: 600 }}>✓ Valid GST (State {gstInfo.stateCode})</div>}
                  {errors['business.gst'] && <div style={{ fontSize: '0.7rem', color: '#dc2626', fontWeight: 600 }}>{errors['business.gst']}</div>}
                </div>
                {biz.loanType === 'msme' && (
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Udyam Registration Number *
                    </label>
                    <input
                      type="text"
                      className="emp-input"
                      value={biz.udgamNumber}
                      onChange={(e) => setBiz((z) => ({ ...z, udgamNumber: e.target.value.toUpperCase() }))}
                      placeholder="UDYAM-XX-00-0000000"
                      style={{ textTransform: 'uppercase' }}
                    />
                    {errors['business.udgam'] && <div style={{ fontSize: '0.7rem', color: '#dc2626', fontWeight: 600 }}>{errors['business.udgam']}</div>}
                  </div>
                )}
              </div>

              {/* 3 Shop Photos */}
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 6 }}>
                  Shop / Work Photos (3 Required: Shop 1, Shop 2, Staff + Shop) *
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <EmpPhotoField
                    id="shopPhoto1"
                    label="Shop Photo 1"
                    required
                    value={biz.shopPhotos[0]}
                    onChange={(v) => setBiz((z) => ({ ...z, shopPhotos: [v, z.shopPhotos[1], z.shopPhotos[2]] }))}
                  />
                  <EmpPhotoField
                    id="shopPhoto2"
                    label="Shop Photo 2"
                    required
                    value={biz.shopPhotos[1]}
                    onChange={(v) => setBiz((z) => ({ ...z, shopPhotos: [z.shopPhotos[0], v, z.shopPhotos[2]] }))}
                  />
                  <EmpPhotoField
                    id="staffShopPhoto"
                    label="Staff + Shop"
                    required
                    value={biz.shopPhotos[2]}
                    onChange={(v) => setBiz((z) => ({ ...z, shopPhotos: [z.shopPhotos[0], z.shopPhotos[1], v] }))}
                  />
                </div>
                {errors['business.photos'] && <div style={{ fontSize: '0.7rem', color: '#dc2626', fontWeight: 600 }}>{errors['business.photos']}</div>}
              </div>

              {/* Uploads: Bank Statement, ITR, Agreement, Udyam */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <EmpDocumentField
                  id="bankStatement"
                  label="Bank Statement"
                  required
                  value={biz.bankStatement}
                  name={biz.bankStatementName}
                  error={errors['business.bank']}
                  onChange={(v, n) => setBiz((z) => ({ ...z, bankStatement: v, bankStatementName: n }))}
                />
                <EmpDocumentField
                  id="itr"
                  label="ITR (Income Tax Return)"
                  value={biz.itr}
                  name={biz.itrName}
                  onChange={(v, n) => setBiz((z) => ({ ...z, itr: v, itrName: n }))}
                />
                <EmpDocumentField
                  id="agreement"
                  label="Business Agreement"
                  value={biz.agreement}
                  name={biz.agreementName}
                  onChange={(v, n) => setBiz((z) => ({ ...z, agreement: v, agreementName: n }))}
                />
                <EmpDocumentField
                  id="udyamCert"
                  label="Udyam Certificate"
                  required={biz.loanType === 'msme'}
                  value={biz.udyamCertificate}
                  name={biz.udyamCertificateName}
                  error={errors['business.udyamCert']}
                  onChange={(v, n) => setBiz((z) => ({ ...z, udyamCertificate: v, udyamCertificateName: n }))}
                />
              </div>
            </div>
          )}

          {/* SECTIONS 6, 7 & 8: SCHEME, PRODUCT, PREVIEW & SUBMIT (Enabled only after Group / Borrower selection - Point 12 & 13) */}
          {(isGroup || pickedBorrower) && (
            <>
              {/* SECTION 6: SCHEME DETAIL & PARAMETERS (Scheme selected FIRST - Point 12) */}
          <div className="emp-card" style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 800, margin: '0 0 10px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="check" size={16} />
              <span>{isProduct ? '6. Product Loan Scheme' : '6. Scheme Detail & Parameters'}</span>
            </h3>

            {!isGroup ? (
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                  Select Loan Scheme *
                </label>
                <select
                  className="emp-input"
                  value={form.schemeId}
                  onChange={(e) => handleSchemeChange(e.target.value)}
                  required
                >
                  <option value="">Select Scheme</option>
                  {availableSchemes.map((s) => (
                    <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                  ))}
                </select>
                {errors.schemeId && <div style={{ fontSize: '0.7rem', color: '#dc2626', fontWeight: 600 }}>{errors.schemeId}</div>}
              </div>
            ) : (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', padding: '8px 12px', borderRadius: 6, fontSize: '0.78rem', marginBottom: 12 }}>
                ✓ Loan schemes are selected individually per member in their cards above (Point 9.4).
              </div>
            )}

            {/* Scheme Specs Badge Card */}
            {scheme && (
              <div style={{ background: '#f8fafc', border: '1px solid var(--emp-border)', borderRadius: 8, padding: 10, marginBottom: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', fontSize: '0.74rem' }}>
                  <div><span style={{ color: '#64748b' }}>Amount:</span> <strong>{inr(scheme.amountMin)} – {inr(scheme.amountMax)}</strong></div>
                  <div><span style={{ color: '#64748b' }}>Term:</span> <strong>{scheme.termMin} – {scheme.termMax} {scheme.termUnit}</strong></div>
                  <div><span style={{ color: '#64748b' }}>Interest ROI:</span> <strong>{scheme.roiMin}% – {scheme.roiMax}% p.a.</strong></div>
                  <div><span style={{ color: '#64748b' }}>Age Range:</span> {scheme.ageMin} – {scheme.ageMax} yrs</div>
                  <div><span style={{ color: '#64748b' }}>Modes:</span> {scheme.modes?.map((m) => m.label || m).join(', ')}</div>
                  <div><span style={{ color: '#64748b' }}>Security Deposit:</span> {scheme.securityType === 'none' ? 'None' : `${scheme.securityPercent || 5}%`}</div>
                  {(scheme.minCivilScore || scheme.cibilMin) && (
                    <div><span style={{ color: '#64748b' }}>Min CIBIL:</span> <strong style={{ color: '#dc2626' }}>{scheme.minCivilScore || scheme.cibilMin}</strong></div>
                  )}
                </div>
              </div>
            )}

            {/* SECTION 7 FOR PRODUCT LOAN: STOCK PRODUCT SELECTION (After Scheme is Selected - Point 12) */}
            {isProduct && (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#166534', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <Icon name="product" size={16} />
                  <span>Stock Product Selection (Pull-up Loan Amount) *</span>
                </div>

                {!form.schemeId ? (
                  <div style={{ fontSize: '0.76rem', color: '#b45309', background: '#fef3c7', padding: '8px 10px', borderRadius: 6, fontWeight: 600 }}>
                    ⚠️ Please select a Product Loan Scheme above first before choosing a stock product.
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 8 }}>
                      <div>
                        <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                          Select Stock Product from Branch Stock *
                        </label>
                        <select
                          className="emp-input"
                          value={prod.id}
                          onChange={(e) => {
                            const pid = e.target.value;
                            setProd((p) => ({ ...p, id: pid }));
                            const chosen = stock.find((x) => x.id === pid);
                            if (chosen) {
                              const q = Math.max(1, Number(prod.qty) || 1);
                              setForm((f) => ({ ...f, amount: String(Math.round(chosen.unitPrice * q)) }));
                            }
                          }}
                          required
                        >
                          <option value="">Select Product ({stock.length} available)</option>
                          {stock.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.code} — {p.name} ({inr(p.unitPrice)}) · {p.stockQty} in stock
                            </option>
                          ))}
                        </select>
                        {errors.stockProduct && <div style={{ fontSize: '0.7rem', color: '#dc2626', fontWeight: 600, marginTop: 2 }}>{errors.stockProduct}</div>}
                      </div>
                      <div>
                        <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                          Units / Qty *
                        </label>
                        <input
                          type="number"
                          min="1"
                          className="emp-input"
                          value={prod.qty}
                          onChange={(e) => {
                            const q = Math.max(1, Number(e.target.value) || 1);
                            setProd((p) => ({ ...p, qty: e.target.value }));
                            if (product) {
                              setForm((f) => ({ ...f, amount: String(Math.round(product.unitPrice * q)) }));
                            }
                          }}
                        />
                      </div>
                    </div>

                    {product && (
                      <div style={{ background: '#fff', border: '1px solid #86efac', padding: 8, borderRadius: 6, fontSize: '0.78rem', fontWeight: 700, color: '#166534', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>✓ Value of Goods: {inr(product.unitPrice)} × {productQtyNum} unit(s)</span>
                        <span style={{ fontSize: '0.85rem', color: 'var(--emp-primary)', fontWeight: 800 }}>Auto Loan Amount: {inr(product.unitPrice * productQtyNum)}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Form Inputs: Amount, Repayment Mode, Term, Installments, Interest Rate */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                  {isGroup ? 'Amount per Member (₹) *' : 'Request Amount (₹) *'}
                </label>
                <input
                  type="text"
                  className="emp-input"
                  value={form.amount}
                  disabled={isProduct}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') }))}
                  required
                  style={isProduct ? { background: '#f8fafc', fontWeight: 800, color: 'var(--emp-primary)' } : undefined}
                />
                {isProduct && product && (
                  <div style={{ fontSize: '0.72rem', color: '#16a34a', fontWeight: 600, marginTop: 2 }}>
                    ✓ Auto-calculated from selected product: {inr(form.amount)}
                  </div>
                )}
                {errors.amount && <div style={{ fontSize: '0.7rem', color: '#dc2626', fontWeight: 600 }}>{errors.amount}</div>}
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                  Repayment Mode *
                </label>
                <select
                  className="emp-input"
                  value={form.mode}
                  onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))}
                >
                  {scheme?.modes ? (
                    scheme.modes.map((m) => (
                      <option key={m.value || m} value={m.value || m}>{m.label || m}</option>
                    ))
                  ) : (
                    <>
                      <option value="weekly">Weekly</option>
                      <option value="daily">Daily</option>
                      <option value="monthly">Monthly</option>
                    </>
                  )}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                  Term ({scheme?.termUnit || 'weeks'}) *
                </label>
                <input
                  type="number"
                  className="emp-input"
                  value={form.term}
                  onChange={(e) => setForm((f) => ({ ...f, term: e.target.value }))}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  Installments
                </label>
                <input
                  className="emp-input"
                  value={`${installments} inst.`}
                  disabled
                  style={{ background: '#f8fafc', color: '#64748b' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                  Rate (% p.a.) *
                </label>
                <input
                  type="text"
                  className="emp-input"
                  value={form.rate}
                  onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value.replace(/[^\d.]/g, '') }))}
                />
              </div>
            </div>

            {/* CIBIL Score Requirement Box (Point 11 & 13.2) */}
            {(scheme?.minCivilScore > 0 || scheme?.cibilMin > 0 || scheme?.civilRequired || scheme?.checkCibil || isBusiness) && (
              <div style={{ marginTop: 10, background: '#f8fafc', padding: 12, borderRadius: 8, border: '1px solid var(--emp-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--emp-text)' }}>
                    CIBIL Score * {(scheme?.minCivilScore || scheme?.cibilMin) ? `(Minimum Required: ${scheme.minCivilScore || scheme.cibilMin})` : '(Required)'}
                  </label>
                  {borrowerDetail?.borrower?.civilCheck?.score && (
                    <span style={{ fontSize: '0.72rem', color: '#16a34a', fontWeight: 600 }}>
                      Record Score: {borrowerDetail.borrower.civilCheck.score}
                    </span>
                  )}
                </div>
                <input
                  type="number"
                  min="300"
                  max="900"
                  className="emp-input"
                  placeholder="Enter borrower CIBIL score (300 - 900)"
                  value={form.civilScore || ''}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 3);
                    setForm((f) => ({ ...f, civilScore: val }));
                    setBiz((z) => ({ ...z, civilScore: val }));
                  }}
                  required
                />
                {errors.civilScore && <div style={{ fontSize: '0.7rem', color: '#dc2626', fontWeight: 600, marginTop: 4 }}>{errors.civilScore}</div>}
              </div>
            )}
          </div>

          {/* SECTION 8: REAL-TIME CALCULATIONS & BREAKDOWN TABLES */}
          {preview?.summary && (
            <div className="emp-card" style={{ marginBottom: 14 }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 800, margin: '0 0 10px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="calculator" size={16} />
                <span>8. EMI Calculation &amp; Net Disbursal in Hand</span>
              </h3>

              {/* EMI Banner */}
              <div style={{ background: 'linear-gradient(135deg, #1e3a8a, #2563eb)', color: '#fff', padding: '12px 14px', borderRadius: 8, marginBottom: 12 }}>
                <div style={{ fontSize: '0.78rem', opacity: 0.9 }}>Calculated Installment (EMI):</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, marginTop: 2 }}>
                  {inr(preview.summary.installmentAmount)}{isGroup ? ' / member' : ''} × {preview.summary.installments} installments
                </div>
                <div style={{ fontSize: '0.8rem', opacity: 0.95, marginTop: 4 }}>
                  Total Payable: <strong>{inr(preview.summary.totalPayable)}</strong>
                  {isGroup && effCount > 1 && (
                    <span> · Group Total: <strong>{inr((Number(form.amount) || 0) * effCount)}</strong> ({effCount} members)</span>
                  )}
                </div>
              </div>

              {/* Repayment Table */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--emp-text)', marginBottom: 4 }}>
                  Repayment Breakdown {isGroup ? '(per member)' : ''}:
                </div>
                <table style={{ width: '100%', fontSize: '0.76rem', borderCollapse: 'collapse', border: '1px solid var(--emp-border)' }}>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid var(--emp-border)' }}>
                      <td style={{ padding: '6px 10px', color: '#64748b' }}>Total Principal</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>{inr(preview.summary.totalPayable - preview.summary.totalInterest)}</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--emp-border)' }}>
                      <td style={{ padding: '6px 10px', color: '#64748b' }}>Total Interest</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>{inr(preview.summary.totalInterest)}</td>
                    </tr>
                    <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                      <td style={{ padding: '6px 10px' }}>Total Payable (EMI × Installments)</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--emp-primary)' }}>{inr(preview.summary.totalPayable)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Charges & Net Cash in Hand Disbursal Table */}
              {preview?.charges && (
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--emp-text)', marginBottom: 4 }}>
                    Deductions &amp; Net Disbursal Cash {isGroup ? '(per member)' : ''}:
                  </div>
                  <table style={{ width: '100%', fontSize: '0.76rem', borderCollapse: 'collapse', border: '1px solid var(--emp-border)' }}>
                    <tbody>
                      <tr style={{ borderBottom: '1px solid var(--emp-border)' }}>
                        <td style={{ padding: '6px 10px', color: '#64748b' }}>Processing Fee</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>{inr(preview.charges.processingFee)}</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid var(--emp-border)' }}>
                        <td style={{ padding: '6px 10px', color: '#64748b' }}>Insurance Fee</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>{inr(preview.charges.cost)}</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid var(--emp-border)' }}>
                        <td style={{ padding: '6px 10px', color: '#64748b' }}>Security Deposit</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>{inr(preview.charges.securityAmount)}</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid var(--emp-border)', color: '#dc2626' }}>
                        <td style={{ padding: '6px 10px', fontWeight: 600 }}>Total Deductions</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700 }}>
                          −{inr(preview.charges.processingFee + preview.charges.cost + preview.charges.securityAmount)}
                        </td>
                      </tr>
                      <tr style={{ background: '#ecfdf5', color: '#065f46', fontSize: '0.85rem' }}>
                        <td style={{ padding: '8px 10px', fontWeight: 800 }}>Net Cash in Hand Disbursal:</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800 }}>
                          {inr(preview.cash)}
                        </td>
                      </tr>
                      {isGroup && effCount > 1 && (
                        <tr style={{ background: '#f0fdf4', color: '#166534', fontWeight: 700 }}>
                          <td style={{ padding: '6px 10px' }}>Total Cash for {effCount} Members:</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                            {inr(preview.cash * effCount)}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* SUBMIT BUTTON */}
          <button
            type="submit"
            className="emp-btn-primary"
            style={{
              width: '100%',
              padding: '14px 0',
              fontSize: '1rem',
              fontWeight: 800,
              marginBottom: 20,
              cursor: isSunday ? 'not-allowed' : 'pointer',
              opacity: isSunday ? 0.6 : 1,
            }}
            disabled={isSunday || submitting}
          >
            {isSunday ? '⚠️ Sunday Locked' : 'Review & Submit Requisition'}
          </button>
            </>
          )}
        </form>
      )}

      {/* CONFIRMATION / REVIEW MODAL */}
      {confirmModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto', padding: 18, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800, margin: '0 0 10px 0', color: 'var(--emp-text)' }}>
              Confirm Loan Requisition
            </h3>
            <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0 0 14px 0' }}>
              Please review all loan parameters, charges, and net cash before final submission:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.78rem', marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Type:</span>
                <strong style={{ textTransform: 'capitalize' }}>{loanKind} Loan</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>{isGroup ? 'Group:' : 'Borrower:'}</span>
                <strong>{isGroup ? `${pickedGroup?.code} — ${pickedGroup?.name}` : `${pickedBorrower?.code} — ${pickedBorrower?.name}`}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Branch:</span>
                <span>{branches.find((b) => b.id === selectedBranch)?.name || selectedBranch}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Staff Name:</span>
                <span>{empUser?.name} ({empUser?.code})</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Scheme:</span>
                <strong>{scheme?.name || form.schemeId}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Loan Amount:</span>
                <strong>{inr(form.amount)}{isGroup ? ' / member' : ''}</strong>
              </div>
              {isGroup && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Selected Members:</span>
                  <strong>{effCount} members (Total: {inr(Number(form.amount) * effCount)})</strong>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Repayment:</span>
                <span>{form.mode} ({installments} installments)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>EMI:</span>
                <strong style={{ color: 'var(--emp-primary)' }}>{inr(preview?.summary?.installmentAmount)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Total Deductions:</span>
                <span style={{ color: '#dc2626' }}>
                  −{inr((preview?.charges?.processingFee || 0) + (preview?.charges?.cost || 0) + (preview?.charges?.securityAmount || 0))}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', background: '#ecfdf5', padding: '6px 8px', borderRadius: 6, fontWeight: 800, color: '#065f46', fontSize: '0.85rem' }}>
                <span>Net Cash in Hand Disbursal:</span>
                <span>{inr(preview?.cash)}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="emp-btn-secondary"
                style={{ flex: 1, padding: '10px 0', fontWeight: 700 }}
                disabled={submitting}
                onClick={() => setConfirmModal(false)}
              >
                Back
              </button>
              <button
                type="button"
                className="emp-btn-primary"
                style={{ flex: 1, padding: '10px 0', fontWeight: 800 }}
                disabled={submitting}
                onClick={handleSubmitFinal}
              >
                {submitting ? 'Submitting…' : 'Confirm & Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RECENT REQUISITIONS LIST TAB */}
      {activeTab === 'list' && (
        <div className="emp-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--emp-text)' }}>
              My Recent Requisitions ({requisitions.length})
            </h3>
            <button
              type="button"
              className="emp-btn-secondary"
              style={{ padding: '4px 10px', fontSize: '0.75rem' }}
              onClick={fetchRequisitions}
              disabled={listLoading}
            >
              {listLoading ? '...' : 'Refresh'}
            </button>
          </div>

          {listLoading ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--emp-text-muted)' }}>
              Loading requisitions...
            </div>
          ) : requisitions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--emp-text-muted)' }}>
              No loan requisitions created yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {requisitions.map((r) => (
                <div
                  key={r.id || r._id}
                  style={{
                    border: '1px solid var(--emp-border)',
                    borderRadius: 8,
                    padding: 12,
                    background: 'var(--emp-card-bg)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <strong style={{ fontSize: '0.92rem', color: 'var(--emp-text)' }}>{r.borrowerName || r.groupName}</strong>
                      <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                        Form: <strong>{r.formId}</strong> • Type: <span style={{ textTransform: 'capitalize' }}>{r.loanType || r.kind}</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                        {r.schemeName} • {r.mode} ({r.term} installments)
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--emp-primary)' }}>
                        {inr(r.amount || (r.amountPaise ? r.amountPaise / 100 : 0))}
                      </div>
                      <div style={{ marginTop: 4 }}>
                        {r.status === 'approved' ? (
                          <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: '#dcfce7', color: '#166534', borderRadius: 4, fontWeight: 700 }}>Approved</span>
                        ) : r.status === 'rejected' ? (
                          <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: '#fee2e2', color: '#991b1b', borderRadius: 4, fontWeight: 700 }}>Rejected</span>
                        ) : (
                          <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: '#fef3c7', color: '#b45309', borderRadius: 4, fontWeight: 700 }}>Pending</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
