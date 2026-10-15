import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import { DetailList, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { compressImage } from '../utils/image.js';
import { downloadMemberPdf } from '../utils/memberPdf.js';

const LIMIT = 25;
const CREATORS = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer'];
const today = () => new Date().toISOString().slice(0, 10);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
// Whole years since a 'YYYY-MM-DD' date.
const yearsSince = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const n = new Date();
  let a = n.getUTCFullYear() - d.getUTCFullYear();
  const m = n.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && n.getUTCDate() < d.getUTCDate())) a -= 1;
  return a;
};
// Latest date of birth that is still 18 years old today.
const minDob = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear() - 18, n.getUTCMonth(), n.getUTCDate())).toISOString().slice(0, 10);
};

const EMPTY = {
  branch: '', name: '', dob: '', gender: '', mobile: '', email: '', husbandName: '', occupation: '', education: '',
  address: '', pincode: '', state: '', district: '', area: '', aadhaar: '', pan: '', bankName: '', ifsc: '', accountNumber: '',
  memberPhoto: '', aadhaarPhoto: '', panPhoto: '', signaturePhoto: '', employeeCode: '',
};

// A value (mobile / PAN) that must be confirmed with an OTP before the form can be saved.
export function OtpVerify({ id, label, value, valid, purpose, mobile, verified, onVerified, onReset, hint }) {
  const toast = useToast();
  const [challenge, setChallenge] = useState(null);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lastValue = useRef(value);

  // Changing the value invalidates an earlier verification.
  useEffect(() => {
    if (lastValue.current !== value) {
      lastValue.current = value;
      setChallenge(null);
      setOtp('');
      setError('');
      onReset();
    }
  }, [value, onReset]);

  async function send() {
    setBusy(true);
    setError('');
    try {
      const r = await api.members.sendOtp({ purpose, mobile, pan: purpose === 'pan' ? value : undefined });
      setChallenge(r);
      setOtp('');
      toast.success(`OTP sent to ${r.sentTo}`);
    } catch (err) {
      setError(err.errors?.mobile || err.errors?.pan || err.message);
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
      toast.success(`${label} verified`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (verified) return <div className="field-hint" style={{ color: '#14532d' }}>✓ {label} verified</div>;
  return (
    <div style={{ marginTop: 6 }}>
      {!challenge ? (
        <button type="button" className="btn sm" disabled={busy || !valid} onClick={send}>
          {busy ? 'Sending…' : 'Send OTP'}
        </button>
      ) : (
        <div>
          {challenge.devOtp && <div className="notice warn" style={{ marginBottom: 8 }}>Development mode — no SMS sent. OTP: <strong>{challenge.devOtp}</strong></div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              id={`${id}-otp`}
              placeholder="6-digit OTP"
              inputMode="numeric"
              maxLength={6}
              value={otp}
              autoComplete="one-time-code"
              style={{ maxWidth: 150 }}
              onChange={(e) => { setOtp(e.target.value.replace(/\D/g, '')); setError(''); }}
            />
            <button type="button" className="btn sm primary" disabled={busy} onClick={verify}>Verify</button>
            <button type="button" className="btn sm" disabled={busy} onClick={send}>Resend</button>
          </div>
          <div className="field-hint">OTP sent to {challenge.sentTo}</div>
        </div>
      )}
      {error && <div className="field-error" role="alert">{error}</div>}
      {!error && !challenge && hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

// Employee whose staff ID goes on the record. On the web software it is chosen here;
// the mobile app fills it in automatically from the signed-in employee.
export function EmployeeSelect({ id = 'employeeCode', label = 'Employee ID', required = true, autoDefault = true, branch, value, onChange, error }) {
  const [state, setState] = useState({ items: [], me: '', loading: false });

  useEffect(() => {
    if (!branch) {
      setState({ items: [], me: '', loading: false });
      return undefined;
    }
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    api.members
      .employees(branch)
      .then((r) => {
        if (!live) return;
        setState({ items: r.items, me: r.me, loading: false });
        // Default to the signed-in employee when they are in this list.
        if (autoDefault && !value && r.items.some((x) => x.code === r.me)) onChange(r.me);
        else if (value && !r.items.some((x) => x.code === value)) onChange('');
      })
      .catch(() => live && setState({ items: [], me: '', loading: false }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch]);

  return (
    <FormField id={id} label={label} required={required} error={error} hint={!branch ? 'Select the branch first' : undefined}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={!branch || state.loading}>
        <option value="">{state.loading ? 'Loading…' : required ? 'Select employee' : 'All employees'}</option>
        {state.items.map((x) => (
          <option key={x.code} value={x.code}>{x.code} — {x.name}{x.code === state.me ? ' (you)' : ''}</option>
        ))}
      </select>
    </FormField>
  );
}

export function PhotoField({ id, label, value, error, onChange, required }) {
  const ref = useRef(null);
  const [err, setErr] = useState('');
  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr('');
    try {
      onChange(await compressImage(file, id === 'signaturePhoto' ? { maxSide: 600 } : {}));
    } catch (ex) {
      setErr(ex.message);
    }
  }
  return (
    <FormField id={id} label={label} required={required} error={err || error}>
      <div className="stamp-upload">
        {value ? <img src={value} alt={label} className="stamp-img" /> : <div className="stamp-empty">No image</div>}
        <div className="stamp-actions">
          <input id={id} ref={ref} type="file" accept="image/png,image/jpeg" onChange={pick} hidden />
          <button type="button" className="btn sm" onClick={() => ref.current?.click()}>{value ? 'Change' : 'Upload'}</button>
          {value && <button type="button" className="btn sm danger-outline" onClick={() => onChange('')}>Remove</button>}
        </div>
      </div>
    </FormField>
  );
}

// Registers a new borrower, or (with `member`) lets an admin change every detail of an existing one.
export function BorrowerForm({ branches, options, onCancel, onSaved, member = null }) {
  const toast = useToast();
  const isEdit = Boolean(member);
  const [form, setForm] = useState(() =>
    member
      ? {
          ...EMPTY,
          branch: member.branchId,
          employeeCode: member.employeeCode || '',
          name: member.name,
          husbandName: member.husbandName || '',
          dob: member.dob || '',
          gender: member.gender,
          mobile: member.mobile,
          email: member.email || '',
          occupation: member.occupation,
          education: member.education,
          address: member.address,
          pincode: member.pincode,
          state: member.state,
          district: member.district,
          area: member.area || '',
          aadhaar: member.aadhaar,
          pan: member.pan || '',
          bankName: member.bankName,
          ifsc: member.ifsc,
          accountNumber: member.accountNumber,
          memberPhoto: member.memberPhoto || '',
          aadhaarPhoto: member.aadhaarPhoto || '',
          panPhoto: member.panPhoto || '',
          signaturePhoto: member.signaturePhoto || '',
        }
      : { ...EMPTY, branch: branches.length === 1 ? branches[0].id : '' }
  );
  const [errors, setErrors] = useState({});
  const [districts, setDistricts] = useState([]);
  const [mobileCh, setMobileCh] = useState('');
  const [pinInfo, setPinInfo] = useState(null); // result of the pincode lookup
  const [bankInfo, setBankInfo] = useState(null); // result of the IFSC lookup
  const pendingDistrict = useRef('');
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };
  const setDigits = (key, len) => (e) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, len);
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };
  const setUpper = (key, len) => (e) => {
    const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, len);
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };
  const setPhoto = (key) => (v) => {
    setForm((f) => ({ ...f, [key]: v }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  // Districts of the chosen state. A district found from the pincode is applied once the list is loaded.
  useEffect(() => {
    if (!form.state) {
      setDistricts([]);
      setForm((f) => ({ ...f, district: '' }));
      return;
    }
    api.members
      .districts(form.state)
      .then((r) => {
        setDistricts(r.cities);
        const want = pendingDistrict.current;
        pendingDistrict.current = '';
        // A district the pincode reports that is not in our list is offered as an extra choice.
        const list = want && !r.cities.includes(want) ? [...r.cities, want] : r.cities;
        setDistricts(list);
        setForm((f) => ({ ...f, district: want || (list.includes(f.district) ? f.district : '') }));
      })
      .catch(() => setDistricts([]));
  }, [form.state]);

  // Pincode: verify it and fill in the state and district.
  useEffect(() => {
    if (!/^[1-9]\d{5}$/.test(form.pincode)) {
      setPinInfo(null);
      return undefined;
    }
    let live = true;
    setPinInfo({ status: 'checking' });
    api.members
      .pincode(form.pincode)
      .then((r) => {
        if (!live) return;
        setPinInfo(r);
        // An admin editing a saved member keeps the saved location until the pincode itself is changed.
        if (isEdit && form.pincode === member.pincode) return;
        if (r.status === 'ok' && r.stateKnown) {
          const found = r.district || r.postalDistrict || '';
          setForm((f) => {
            if (f.state === r.state) return { ...f, district: found || f.district, area: r.areas?.includes(f.area) ? f.area : r.areas?.[0] || f.area };
            pendingDistrict.current = found;
            return { ...f, state: r.state, area: r.areas?.[0] || '' };
          });
          if (found) setDistricts((ds) => (ds.includes(found) ? ds : [...ds, found]));
          setErrors((er) => ({ ...er, state: undefined, district: undefined, pincode: undefined }));
        }
      })
      .catch(() => live && setPinInfo({ status: 'unavailable' }));
    return () => {
      live = false;
    };
  }, [form.pincode]);

  // IFSC: verify it and fill in the bank name.
  useEffect(() => {
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.ifsc)) {
      setBankInfo(null);
      return undefined;
    }
    let live = true;
    setBankInfo({ status: 'checking' });
    api.members
      .ifsc(form.ifsc)
      .then((r) => {
        if (!live) return;
        setBankInfo(r);
        if (r.status === 'ok' && r.bank) {
          setForm((f) => ({ ...f, bankName: r.bank }));
          setErrors((er) => ({ ...er, bankName: undefined, ifsc: undefined }));
        }
      })
      .catch(() => live && setBankInfo({ status: 'unavailable' }));
    return () => {
      live = false;
    };
  }, [form.ifsc]);

  const resetMobile = useCallback(() => setMobileCh(''), []);

  const mobileValid = /^[6-9]\d{9}$/.test(form.mobile);
  const mobileKept = isEdit && member.mobileVerified && form.mobile === member.mobile;
  const panValid = /^[A-Z]{5}\d{4}[A-Z]$/.test(form.pan);
  const ageNow = form.dob ? yearsSince(form.dob) : null;

  async function submit(e) {
    e.preventDefault();
    const found = {};
    const need = (k, msg) => !String(form[k]).trim() && (found[k] = msg);
    need('branch', 'Select a branch');
    if (!isEdit) need('employeeCode', 'Select the employee');
    need('name', 'Member name is required');
    need('dob', 'Date of birth is required');
    need('gender', 'Select gender');
    need('occupation', 'Select occupation');
    need('education', 'Select education');
    need('address', 'Address is required');
    need('state', 'Select state');
    need('district', 'Select district');
    need('bankName', 'Bank name is required');
    need('memberPhoto', 'Member photo is required');
    need('aadhaarPhoto', 'Aadhaar photo is required');
    need('signaturePhoto', 'Signature photo is required');
    if (!mobileValid) found.mobile = 'Enter a valid 10-digit mobile number';
    else if (!mobileCh && !mobileKept) found.mobile = isEdit ? 'Verify the new mobile number with an OTP' : 'Verify the mobile number with an OTP';
    if (!/^\d{6}$/.test(form.pincode)) found.pincode = 'Enter a valid 6-digit pincode';
    else if (pinInfo?.status === 'invalid') found.pincode = 'This pincode does not exist';
    if (form.dob && ageNow !== null && ageNow < 18) found.dob = 'Borrower must be at least 18 years old';
    if (!/^\d{12}$/.test(form.aadhaar)) found.aadhaar = 'Enter the 12-digit Aadhaar number';
    if (form.pan) {
      if (!panValid) found.pan = 'Enter a valid PAN (e.g. ABCDE1234F)';
      else if (form.pan[3] !== 'P') found.pan = 'A borrower PAN must be an individual PAN (4th letter P)';
      if (!form.panPhoto) found.panPhoto = 'PAN photo is required when a PAN is given';
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.ifsc)) found.ifsc = 'Enter a valid IFSC code (e.g. SBIN0001234)';
    else if (bankInfo?.status === 'invalid') found.ifsc = 'This IFSC code does not exist';
    if (!/^\d{9,18}$/.test(form.accountNumber)) found.accountNumber = 'Account number must be 9–18 digits';
    setErrors(found);
    if (Object.keys(found).length) {
      toast.error('Please correct the highlighted fields');
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        const r = await api.members.update(member.id, { ...form, mobileChallengeId: mobileCh || undefined });
        toast.success('Member details updated');
        onSaved(r.member);
      } else {
        const r = await api.members.create({ ...form, mobileChallengeId: mobileCh });
        toast.success(`Borrower added — ${r.member.code}`);
        onSaved(r.member);
      }
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
        <h3 className="section-title">Basic details</h3>
        <div className="form-grid">
          <FormField id="branch" label="Branch" required error={errors.branch}>
            <select id="branch" value={form.branch} onChange={set('branch')} disabled={isEdit}>
              <option value="">Select branch</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
          </FormField>
          <FormField id="joining" label="Joining date" hint="Set automatically">
            <input id="joining" value={today()} disabled />
          </FormField>
          <FormField id="mcode" label="Member code" hint="Generated automatically on save">
            <input id="mcode" value="Auto" disabled />
          </FormField>
          <FormField id="formid" label="Form ID" hint="Generated automatically on save">
            <input id="formid" value="Auto" disabled />
          </FormField>
          {isEdit ? (
            <FormField id="emp" label="Employee ID" hint="Who registered the member">
              <input id="emp" value={form.employeeCode || '—'} disabled />
            </FormField>
          ) : (
            <EmployeeSelect
              branch={form.branch}
              value={form.employeeCode}
              error={errors.employeeCode}
              onChange={(code) => { setForm((f) => ({ ...f, employeeCode: code })); setErrors((er) => ({ ...er, employeeCode: undefined })); }}
            />
          )}
          <FormField id="name" label="Member name" required error={errors.name}>
            <input id="name" value={form.name} onChange={set('name')} maxLength={80} />
          </FormField>
          <FormField id="husbandName" label="Husband name" error={errors.husbandName}>
            <input id="husbandName" value={form.husbandName} onChange={set('husbandName')} maxLength={80} />
          </FormField>
          <FormField id="dob" label="Date of birth" required error={errors.dob} hint={ageNow !== null ? `Age: ${ageNow} years${ageNow < 18 ? ' (minimum 18)' : ''}` : 'Borrower must be at least 18 years old'}>
            <input id="dob" type="date" max={minDob()} value={form.dob} onChange={set('dob')} />
          </FormField>
          <FormField id="gender" label="Gender" required error={errors.gender}>
            <select id="gender" value={form.gender} onChange={set('gender')}>
              <option value="">Select gender</option>
              {options.genders.map((g) => <option key={g} value={g}>{cap(g)}</option>)}
            </select>
          </FormField>
          <FormField id="occupation" label="Occupation" required error={errors.occupation}>
            <select id="occupation" value={form.occupation} onChange={set('occupation')}>
              <option value="">Select occupation</option>
              {options.occupations.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </FormField>
          <FormField id="education" label="Education" required error={errors.education}>
            <select id="education" value={form.education} onChange={set('education')}>
              <option value="">Select education</option>
              {options.educations.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </FormField>
        </div>
      </div>

      <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
        <h3 className="section-title">Contact &amp; address</h3>
        <div className="form-grid">
          <FormField id="mobile" label="Mobile number" required error={errors.mobile}>
            <input id="mobile" value={form.mobile} onChange={setDigits('mobile', 10)} inputMode="numeric" maxLength={10} />
            <OtpVerify id="mobile" label="Mobile number" purpose="mobile" value={form.mobile} valid={mobileValid} mobile={form.mobile}
              verified={Boolean(mobileCh) || mobileKept} onVerified={setMobileCh} onReset={resetMobile} />
          </FormField>
          <FormField id="email" label="Email ID" error={errors.email} hint="Optional">
            <input id="email" type="email" value={form.email} onChange={set('email')} maxLength={120} />
          </FormField>
          <FormField id="address" label="Address" required error={errors.address} className="span-2">
            <textarea id="address" rows={2} value={form.address} onChange={set('address')} maxLength={300} />
          </FormField>
          <FormField id="state" label="State" required error={errors.state}>
            <select id="state" value={form.state} onChange={set('state')}>
              <option value="">Select state</option>
              {options.states.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </FormField>
          <FormField id="district" label="District" required error={errors.district}>
            <select id="district" value={form.district} onChange={set('district')} disabled={!form.state}>
              <option value="">{form.state ? 'Select district' : 'Select state first'}</option>
              {districts.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </FormField>
          <FormField id="area" label="Area / post office" hint="Filled in from the pincode">
            {pinInfo?.areas?.length ? (
              <select id="area" value={form.area} onChange={set('area')}>
                {!pinInfo.areas.includes(form.area) && form.area && <option value={form.area}>{form.area}</option>}
                {pinInfo.areas.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            ) : (
              <input id="area" value={form.area} onChange={set('area')} maxLength={80} />
            )}
          </FormField>
          <FormField id="pincode" label="Pincode" required error={errors.pincode}
            hint={
              pinInfo?.status === 'checking' ? 'Checking pincode…'
                : pinInfo?.status === 'ok' ? `✓ Pincode verified — ${pinInfo.postalDistrict}, ${pinInfo.state}`
                  : pinInfo?.status === 'unavailable' ? 'Could not verify the pincode right now. Choose the state and district yourself.'
                    : pinInfo?.status === 'invalid' ? undefined : 'State and district are filled in from the pincode'
            }>
            <input id="pincode" value={form.pincode} onChange={setDigits('pincode', 6)} inputMode="numeric" maxLength={6} />
          </FormField>
        </div>
      </div>

      <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
        <h3 className="section-title">KYC &amp; bank</h3>
        <div className="form-grid">
          <FormField id="aadhaar" label="Aadhaar number" required error={errors.aadhaar}>
            <input id="aadhaar" value={form.aadhaar} onChange={setDigits('aadhaar', 12)} inputMode="numeric" maxLength={12} />
          </FormField>
          <FormField id="pan" label="PAN number" error={errors.pan}
            hint={form.pan && panValid && form.pan[3] === 'P' ? '✓ PAN format is valid' : 'Optional. Format: ABCDE1234F (individual PAN)'}>
            <input id="pan" value={form.pan} onChange={setUpper('pan', 10)} maxLength={10} />
          </FormField>
          <FormField id="bankName" label="Bank name" required error={errors.bankName}>
            <input id="bankName" value={form.bankName} onChange={set('bankName')} maxLength={80} />
          </FormField>
          <FormField id="ifsc" label="IFSC code" required error={errors.ifsc}
            hint={
              bankInfo?.status === 'checking' ? 'Checking IFSC…'
                : bankInfo?.status === 'ok' ? `✓ ${bankInfo.bank}, ${bankInfo.branch}${bankInfo.city ? `, ${bankInfo.city}` : ''}`
                  : bankInfo?.status === 'unavailable' ? 'Could not verify the IFSC right now' : 'The bank name is filled in from the IFSC'
            }>
            <input id="ifsc" value={form.ifsc} onChange={setUpper('ifsc', 11)} maxLength={11} />
          </FormField>
          <FormField id="accountNumber" label="Account number" required error={errors.accountNumber} hint="9 to 18 digits">
            <input id="accountNumber" value={form.accountNumber} onChange={setDigits('accountNumber', 18)} inputMode="numeric" maxLength={18} />
          </FormField>
        </div>
      </div>

      <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
        <h3 className="section-title">Photos</h3>
        <div className="form-grid">
          <PhotoField id="memberPhoto" label="Member photo" required value={form.memberPhoto} error={errors.memberPhoto} onChange={setPhoto('memberPhoto')} />
          <PhotoField id="signaturePhoto" label="Signature photo" required value={form.signaturePhoto} error={errors.signaturePhoto} onChange={setPhoto('signaturePhoto')} />
          <PhotoField id="aadhaarPhoto" label="Aadhaar photo" required value={form.aadhaarPhoto} error={errors.aadhaarPhoto} onChange={setPhoto('aadhaarPhoto')} />
          <PhotoField id="panPhoto" label="PAN photo" required={Boolean(form.pan)} value={form.panPhoto} error={errors.panPhoto} onChange={setPhoto('panPhoto')} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save borrower'}</button>
      </div>
    </form>
  );
}

function MemberDetail({ id, onClose }) {
  const [m, setM] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.members.get(id).then((r) => setM(r.member)).catch((e) => setError(e.message));
  }, [id]);
  return (
    <Modal
      open
      title={m ? `${m.name} — ${m.code}` : 'Borrower'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {m && <button className="btn" onClick={() => downloadMemberPdf(m)}>Download PDF</button>}
          <button className="btn" onClick={onClose}>Close</button>
        </>
      }
    >
      {error ? (
        <ErrorState message={error} />
      ) : !m ? (
        <Spinner label="Loading…" />
      ) : (
        <>
          <DetailList
            items={[
              ['Member code', m.code], ['Form ID', m.formId], ['Branch', m.branch ? `${m.branch.code} — ${m.branch.name}` : ''],
              ['Joining date', m.joiningDate], ['Date of birth', m.dob], ['Gender', cap(m.gender)],
              ['Mobile', `${m.mobile}${m.mobileVerified ? ' ✓' : ''}`], ['Email', m.email], ['Husband name', m.husbandName],
              ['Occupation', m.occupation], ['Education', m.education], ['Address', `${m.address}, ${m.district}, ${m.state} - ${m.pincode}`],
              ['Aadhaar', m.aadhaar], ['PAN', m.pan ? `${m.pan}${m.panVerified ? ' ✓' : ''}` : ''],
              ['Bank', `${m.bankName} (${m.ifsc})`], ['Account number', m.accountNumber],
              ['Employee ID', m.employeeCode],
              ['Guarantor', m.guarantor ? `${m.guarantor.name} (${m.guarantor.mobile})` : 'Not added'],
              ['Nominee', m.nominee ? `${m.nominee.name} (${m.nominee.mobile})` : 'Not added'],
            ]}
          />
          <div className="stamp-view sign-row" style={{ marginTop: 16 }}>
            {[['Member photo', m.memberPhoto], ['Signature', m.signaturePhoto], ['Aadhaar', m.aadhaarPhoto], ['PAN', m.panPhoto]].map(([l, src]) => (
              <div key={l}>
                <div className="detail-label">{l}</div>
                {src ? <img src={src} alt={l} className="stamp-img" /> : <span className="muted">Not uploaded</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

export default function NewBorrower() {
  const { user } = useAuth();
  const canCreate = CREATORS.includes(user?.role);
  const [view, setView] = useState('list');
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [branches, setBranches] = useState([]);
  const [options, setOptions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null);
  const [justSaved, setJustSaved] = useState(null);
  const q = useDebounce(search);

  useEffect(() => {
    if (!canCreate) return;
    api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {});
    api.members.options().then(setOptions).catch(() => {});
  }, [canCreate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.members.list({ page, limit: LIMIT, q }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, q]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [q]);

  if (view === 'form' && options) {
    return (
      <>
        <PageHeader title="New Borrower" description="Register a new member. Mobile number (and PAN, if given) must be verified with an OTP." />
        <BorrowerForm branches={branches} options={options} onCancel={() => setView('list')} onSaved={(saved) => { setView('list'); setJustSaved(saved); load(); }} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Member Details"
        description="Registered borrowers. Add a new borrower to generate the member code and form ID."
        actions={canCreate && <button className="btn primary" onClick={() => setView('form')} disabled={!options}>+ New Borrower</button>}
      />
      <div className="panel">
        <div className="toolbar">
          <input type="search" className="toolbar-search" placeholder="Search by name, member code, form ID, mobile, last 4 digits of Aadhaar or PAN" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search borrowers" />
        </div>
        {loading && !data.items.length ? (
          <Spinner label="Loading borrowers…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : data.items.length === 0 ? (
          <EmptyState title={q ? 'No borrowers match your search' : 'No borrowers yet'} description={q ? 'Try a different search.' : 'Use "+ New Borrower" to register the first one.'} />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead>
                  <tr><th>Member code</th><th>Form ID</th><th>Name</th><th>Branch</th><th>Mobile</th><th>Aadhaar</th><th>Joined</th><th className="actions-col">Actions</th></tr>
                </thead>
                <tbody>
                  {data.items.map((m) => (
                    <tr key={m.id}>
                      <td data-label="Member code"><strong>{m.code}</strong></td>
                      <td data-label="Form ID">{m.formId}</td>
                      <td data-label="Name">{m.name}{m.matchedVia === 'guarantor' && <div className="muted small">found via guarantor</div>}</td>
                      <td data-label="Branch">{m.branch ? m.branch.name : '—'}</td>
                      <td data-label="Mobile">{m.mobile}</td>
                      <td data-label="Aadhaar">{m.aadhaar}</td>
                      <td data-label="Joined">{m.joiningDate}</td>
                      <td data-label="Actions" className="actions-col"><button className="btn sm" onClick={() => setOpenId(m.id)}>View</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page || page} totalPages={data.totalPages} total={data.total} limit={LIMIT} onPage={setPage} />
          </>
        )}
      </div>
      <Modal
        open={Boolean(justSaved)}
        title="Borrower registered"
        onClose={() => setJustSaved(null)}
        footer={
          <>
            <button className="btn" onClick={() => setJustSaved(null)}>Close</button>
            <button className="btn primary" onClick={async () => { const r = await api.members.get(justSaved.id); downloadMemberPdf(r.member); }}>Download PDF</button>
          </>
        }
      >
        {justSaved && (
          <>
            <p>
              <strong>{justSaved.name}</strong> has been registered.
            </p>
            <DetailList items={[['Member code', justSaved.code], ['Form ID', justSaved.formId], ['Employee ID', justSaved.employeeCode]]} />
            <p className="muted small">Add the guarantor and nominee under Member Details → Guarantor Detail / Nominee Detail.</p>
          </>
        )}
      </Modal>
      {openId && <MemberDetail id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
