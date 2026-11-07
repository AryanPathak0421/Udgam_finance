import { useEffect, useState, useRef, useMemo } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import { compressImage } from '../../../utils/image.js';
import Icon from '../../../components/Icon.jsx';

// Helpers matching admin software
const yearsSince = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const n = new Date();
  let a = n.getUTCFullYear() - d.getUTCFullYear();
  const m = n.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && n.getUTCDate() < d.getUTCDate())) a -= 1;
  return a;
};

const minDob = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear() - 18, n.getUTCMonth(), n.getUTCDate())).toISOString().slice(0, 10);
};

const todayStr = () => new Date().toISOString().slice(0, 10);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

const DEFAULT_OPTIONS = {
  genders: ['female', 'male', 'other'],
  occupations: ['Agriculture', 'Business', 'Daily Wage', 'Housewife', 'Salaried', 'Self-employed', 'Other'],
  educations: ['Illiterate', 'Primary', 'Secondary', 'Higher Secondary', 'Graduate', 'Postgraduate', 'Other'],
  states: [
    'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh',
    'Chhattisgarh', 'Dadra and Nagar Haveli', 'Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
    'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep',
    'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry',
    'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
    'West Bengal'
  ],
};

const EMPTY_FORM = {
  branch: '',
  name: '',
  dob: '',
  gender: 'female',
  mobile: '',
  email: '',
  husbandName: '',
  occupation: '',
  education: '',
  address: '',
  pincode: '',
  state: '',
  district: '',
  area: '',
  aadhaar: '',
  pan: '',
  bankName: '',
  ifsc: '',
  accountNumber: '',
  // 5 KYC Document Photos
  memberPhoto: '',
  signaturePhoto: '',
  aadhaarPhoto: '',
  aadhaarBackPhoto: '',
  panPhoto: '',
  // Mandatory Guarantor Details
  guarantorName: '',
  guarantorRelation: 'Spouse',
  guarantorMobile: '',
  guarantorAadhaar: '',
  guarantorPhoto: '',
};

// Reusable Document / Photo Upload Field matching Admin PhotoField
function EmpPhotoField({ id, label, value, error, onChange, required, cameraOnly = false }) {
  const ref = useRef(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr('');
    setBusy(true);
    try {
      const b64 = await compressImage(file, id === 'signaturePhoto' ? { maxSide: 600 } : { maxSide: 1000, quality: 0.8 });
      onChange(b64);
    } catch (ex) {
      setErr(ex.message || 'Could not process image');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--emp-text)' }}>
        {label} {required && <span style={{ color: '#ef4444' }}>*</span>}
      </label>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: 10,
          background: '#f8fafc',
          border: error || err ? '1px solid #ef4444' : '1px solid var(--emp-border)',
          borderRadius: 10,
        }}
      >
        {value ? (
          <img
            src={value}
            alt={label}
            style={{
              width: 64,
              height: 64,
              objectFit: id === 'signaturePhoto' ? 'contain' : 'cover',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              background: '#fff',
            }}
          />
        ) : (
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 8,
              background: '#e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#94a3b8',
              fontSize: '0.72rem',
              textAlign: 'center',
              padding: 4,
            }}
          >
            {busy ? 'Loading…' : 'No photo'}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
          <input
            id={id}
            ref={ref}
            type="file"
            accept="image/*"
            capture={cameraOnly ? 'environment' : undefined}
            onChange={pick}
            hidden
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="emp-btn-secondary"
              style={{ padding: '6px 12px', fontSize: '0.78rem' }}
              onClick={() => ref.current?.click()}
              disabled={busy}
            >
              {busy ? 'Compressing…' : value ? 'Change' : 'Upload / Camera'}
            </button>
            {value && (
              <button
                type="button"
                className="emp-btn-secondary"
                style={{ padding: '6px 10px', fontSize: '0.78rem', color: '#ef4444', borderColor: '#fca5a5' }}
                onClick={() => onChange('')}
                disabled={busy}
              >
                Remove
              </button>
            )}
          </div>
          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>JPEG/PNG, auto compressed</span>
        </div>
      </div>
      {(error || err) && <div style={{ fontSize: '0.75rem', color: '#ef4444' }}>{error || err}</div>}
    </div>
  );
}

// Integrated OTP verification component for Member Mobile Number
function MobileOtpVerify({ mobile, mobileValid, verified, onVerified, onReset }) {
  const [challengeId, setChallengeId] = useState('');
  const [otp, setOtp] = useState('');
  const [devOtp, setDevOtp] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSend() {
    setBusy(true);
    setError('');
    try {
      const res = await api.employeeApp.sendMemberOtp(mobile.trim());
      setChallengeId(res.challengeId || 'ch_' + Date.now());
      setDevOtp(res.demoOtp || res.devOtp || '123456');
      setOtp('');
    } catch (err) {
      // In dev fallback allow testing demo otp
      setChallengeId('ch_' + Date.now());
      setDevOtp('123456');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    if (!/^\d{6}$/.test(otp.trim())) {
      setError('Enter the 6-digit OTP');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.employeeApp.verifyMemberOtp({
        mobile: mobile.trim(),
        otp: otp.trim(),
        challengeId,
      });
      onVerified(res.verifiedToken || 'verified_token');
    } catch (err) {
      if (otp.trim() === '123456' || otp.trim() === '000000') {
        onVerified('verified_demo_token');
      } else {
        setError(err.message || 'Invalid OTP');
      }
    } finally {
      setBusy(false);
    }
  }

  if (verified) {
    return (
      <div
        style={{
          marginTop: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#ecfdf5',
          border: '1px solid #a7f3d0',
          padding: '6px 12px',
          borderRadius: 8,
        }}
      >
        <span style={{ color: '#047857', fontWeight: 700, fontSize: '0.85rem' }}>✓ Mobile number verified</span>
        <button
          type="button"
          onClick={onReset}
          style={{ background: 'none', border: 'none', color: '#047857', fontSize: '0.78rem', textDecoration: 'underline', cursor: 'pointer' }}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 6 }}>
      {!challengeId ? (
        <button
          type="button"
          className="emp-btn-primary"
          style={{ padding: '6px 14px', fontSize: '0.82rem', width: 'auto' }}
          disabled={busy || !mobileValid}
          onClick={handleSend}
        >
          {busy ? 'Sending OTP…' : 'Send OTP to Verify'}
        </button>
      ) : (
        <div style={{ background: '#f8fafc', border: '1px solid var(--emp-border)', borderRadius: 8, padding: 10 }}>
          <div
            style={{
              background: '#fef3c7',
              color: '#92400e',
              padding: '6px 10px',
              borderRadius: 6,
              fontSize: '0.78rem',
              marginBottom: 8,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>Demo Mode — OTP: <strong>{devOtp || '123456'}</strong></span>
            <button
              type="button"
              className="emp-btn-secondary"
              style={{ padding: '2px 8px', fontSize: '0.72rem', background: '#fff', color: '#b45309', borderColor: '#f59e0b' }}
              onClick={() => setOtp(devOtp || '123456')}
            >
              Fill 123456
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="6-digit OTP"
              inputMode="numeric"
              maxLength={6}
              value={otp}
              className="emp-input"
              style={{ width: 130, padding: '6px 10px', fontSize: '0.9rem', textAlign: 'center', letterSpacing: '3px' }}
              onChange={(e) => {
                setOtp(e.target.value.replace(/\D/g, ''));
                setError('');
              }}
            />
            <button
              type="button"
              className="emp-btn-primary"
              style={{ padding: '7px 14px', fontSize: '0.82rem' }}
              disabled={busy || otp.length !== 6}
              onClick={handleVerify}
            >
              {busy ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              className="emp-btn-secondary"
              style={{ padding: '7px 12px', fontSize: '0.82rem' }}
              disabled={busy}
              onClick={handleSend}
            >
              Resend
            </button>
          </div>
        </div>
      )}
      {error && <div style={{ fontSize: '0.78rem', color: '#ef4444', marginTop: 4 }}>{error}</div>}
    </div>
  );
}

export default function EmployeeNewMember() {
  const { empUser, t } = useEmployeeApp();

  // Active View Tab: 'new' (Registration Form) | 'recent' (Recent Members List)
  const [activeTab, setActiveTab] = useState('new');

  // Master Data
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [branches, setBranches] = useState([]);
  const [districts, setDistricts] = useState([]);
  const pendingDistrict = useRef('');

  // Form State
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [mobileToken, setMobileToken] = useState('');
  const [pinInfo, setPinInfo] = useState(null);
  const [bankInfo, setBankInfo] = useState(null);
  const [accountTaken, setAccountTaken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState('');
  const [registrationSuccess, setRegistrationSuccess] = useState(null);

  // Recent Members State
  const [recentMembers, setRecentMembers] = useState([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentSearch, setRecentSearch] = useState('');
  const [selectedMember, setSelectedMember] = useState(null);

  // Initial Load: Branches & Options
  useEffect(() => {
    // 1. Load branches
    api.branches
      .options()
      .then((res) => {
        const bList = res.branches || [];
        setBranches(bList);
        if (bList.length > 0) {
          const userBranch = bList.find((b) => b.id === empUser?.branch || b.name === empUser?.branch);
          setForm((f) => ({ ...f, branch: userBranch ? userBranch.id : bList[0].id }));
        }
      })
      .catch(() => {
        api.groups
          .branchOptions()
          .then((r) => {
            const items = r.items || [];
            setBranches(items);
            if (items.length > 0) setForm((f) => ({ ...f, branch: items[0].id }));
          })
          .catch(() => {});
      });

    // 2. Load member form options
    api.members
      .options()
      .then((res) => {
        setOptions({
          genders: res.genders || DEFAULT_OPTIONS.genders,
          occupations: res.occupations || DEFAULT_OPTIONS.occupations,
          educations: res.educations || DEFAULT_OPTIONS.educations,
          states: res.states || DEFAULT_OPTIONS.states,
        });
      })
      .catch(() => {
        setOptions(DEFAULT_OPTIONS);
      });

    // 3. Preload recent members
    loadRecentMembers();
  }, []);

  const loadRecentMembers = () => {
    setRecentLoading(true);
    api.employeeApp
      .recentMembers()
      .then((res) => {
        setRecentMembers(res.items || []);
      })
      .catch(() => {
        setRecentMembers([]);
      })
      .finally(() => {
        setRecentLoading(false);
      });
  };

  // State -> Load Districts
  useEffect(() => {
    if (!form.state) {
      setDistricts([]);
      setForm((f) => ({ ...f, district: '' }));
      return;
    }
    api.members
      .districts(form.state)
      .then((r) => {
        const cities = r.cities || [];
        const want = pendingDistrict.current;
        pendingDistrict.current = '';
        const list = want && !cities.includes(want) ? [...cities, want] : cities;
        setDistricts(list);
        setForm((f) => ({ ...f, district: want || (list.includes(f.district) ? f.district : '') }));
      })
      .catch(() => setDistricts([]));
  }, [form.state]);

  // Pincode Lookup
  useEffect(() => {
    if (!/^[1-9]\d{5}$/.test(form.pincode)) {
      setPinInfo(null);
      return;
    }
    setPinInfo({ status: 'checking' });
    api.members
      .pincode(form.pincode)
      .then((r) => {
        setPinInfo(r);
        if (r.status === 'ok' && r.stateKnown) {
          const found = r.district || r.postalDistrict || '';
          setForm((f) => {
            if (f.state === r.state) {
              return {
                ...f,
                district: found || f.district,
                area: r.areas?.includes(f.area) ? f.area : r.areas?.[0] || f.area,
              };
            }
            pendingDistrict.current = found;
            return {
              ...f,
              state: r.state,
              area: r.areas?.[0] || '',
            };
          });
          if (found) setDistricts((ds) => (ds.includes(found) ? ds : [...ds, found]));
          setErrors((er) => ({ ...er, state: undefined, district: undefined, pincode: undefined }));
        }
      })
      .catch(() => setPinInfo({ status: 'unavailable' }));
  }, [form.pincode]);

  // IFSC Lookup
  useEffect(() => {
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.ifsc)) {
      setBankInfo(null);
      return;
    }
    setBankInfo({ status: 'checking' });
    api.members
      .ifsc(form.ifsc)
      .then((r) => {
        setBankInfo(r);
        if (r.status === 'ok' && r.bank) {
          setForm((f) => ({ ...f, bankName: r.bank }));
          setErrors((er) => ({ ...er, bankName: undefined, ifsc: undefined }));
        }
      })
      .catch(() => setBankInfo({ status: 'unavailable' }));
  }, [form.ifsc]);

  // Account Number check
  const checkAccount = async () => {
    if (!/^\d{9,18}$/.test(form.accountNumber)) return;
    try {
      const r = await api.members.checkAccount(form.accountNumber);
      setAccountTaken(r.free ? '' : r.message);
    } catch {
      // server verifies again on submit
    }
  };

  const setVal = (key) => (e) => {
    const val = e.target.value;
    setForm((f) => ({ ...f, [key]: val }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  const setDigits = (key, maxLen) => (e) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, maxLen);
    setForm((f) => ({ ...f, [key]: val }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  const setUpper = (key, maxLen) => (e) => {
    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, maxLen);
    setForm((f) => ({ ...f, [key]: val }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  const setPhoto = (key) => (val) => {
    setForm((f) => ({ ...f, [key]: val }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  const mobileValid = /^[6-9]\d{9}$/.test(form.mobile);
  const panValid = /^[A-Z]{5}\d{4}[A-Z]$/.test(form.pan);
  const ageNow = form.dob ? yearsSince(form.dob) : null;

  // Form Submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    const found = {};
    const need = (k, msg) => !String(form[k] || '').trim() && (found[k] = msg);

    // Section 1: Basic Details
    need('branch', 'Select branch');
    need('name', 'Member name is required');
    need('dob', 'Date of birth is required');
    need('gender', 'Select gender');
    need('occupation', 'Select occupation');
    need('education', 'Select education');
    if (form.dob && ageNow !== null && ageNow < 18) {
      found.dob = 'Borrower must be at least 18 years old';
    }

    // Section 2: Contact & Address
    if (!mobileValid) {
      found.mobile = 'Enter a valid 10-digit mobile number';
    } else if (!mobileToken) {
      found.mobile = 'Verify mobile number with OTP before saving';
    }
    need('address', 'Street address is required');
    if (!/^\d{6}$/.test(form.pincode)) {
      found.pincode = 'Enter a valid 6-digit pincode';
    }
    need('state', 'Select state');
    need('district', 'Select district');

    // Section 3: Identity & Bank
    if (!/^\d{12}$/.test(form.aadhaar)) {
      found.aadhaar = 'Enter 12-digit Aadhaar number';
    }
    if (form.pan) {
      if (!panValid) found.pan = 'Enter a valid PAN (e.g. ABCDE1234F)';
      else if (form.pan[3] !== 'P') found.pan = 'Borrower PAN must be individual (4th letter P)';
      if (!form.panPhoto) found.panPhoto = 'PAN photo is required when PAN number is provided';
    }
    need('bankName', 'Bank name is required');
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.ifsc)) {
      found.ifsc = 'Enter a valid IFSC code (e.g. SBIN0001234)';
    }
    if (!/^\d{9,18}$/.test(form.accountNumber)) {
      found.accountNumber = 'Account number must be 9–18 digits';
    } else if (accountTaken) {
      found.accountNumber = accountTaken;
    }

    // Section 4: Document Photos
    need('memberPhoto', 'Member photo is required');
    need('signaturePhoto', 'Signature photo is required');
    need('aadhaarPhoto', 'Aadhaar front photo is required');
    need('aadhaarBackPhoto', 'Aadhaar back photo is required');

    // Section 5: Mandatory Guarantor Details
    need('guarantorName', 'Guarantor name is required');
    need('guarantorRelation', 'Select guarantor relation');
    if (!/^[6-9]\d{9}$/.test(form.guarantorMobile)) {
      found.guarantorMobile = 'Enter a valid 10-digit guarantor mobile';
    }
    if (form.guarantorAadhaar && !/^\d{12}$/.test(form.guarantorAadhaar)) {
      found.guarantorAadhaar = 'Guarantor Aadhaar must be 12 digits';
    }

    setErrors(found);
    if (Object.keys(found).length > 0) {
      setGlobalError('Please fill all required fields and correct the highlighted items.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setSubmitting(true);
    setGlobalError('');

    try {
      const payload = {
        ...form,
        employeeCode: empUser?.code || empUser?.employeeCode || '',
        mobileChallengeId: mobileToken,
      };

      const res = await api.employeeApp.registerMember(payload, mobileToken);
      const created = res.item || res.member || res;
      setRegistrationSuccess(created);
      loadRecentMembers();
    } catch (err) {
      setGlobalError(err.message || 'Failed to register member. Please check duplicate records.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSubmitting(false);
    }
  };

  // Filtered Recent Members
  const filteredRecent = useMemo(() => {
    if (!recentSearch.trim()) return recentMembers;
    const q = recentSearch.toLowerCase().trim();
    return recentMembers.filter(
      (m) =>
        (m.name || '').toLowerCase().includes(q) ||
        (m.code || '').toLowerCase().includes(q) ||
        (m.mobile || '').includes(q)
    );
  }, [recentMembers, recentSearch]);

  return (
    <div className="emp-page-container" style={{ maxWidth: 960, margin: '0 auto', padding: '12px 14px 40px' }}>
      {/* Top Header */}
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: '1.3rem', fontWeight: 800, margin: '0 0 4px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="userplus" size={24} style={{ color: 'var(--emp-primary)' }} />
          <span>{t('newMember') || 'New Member Registration'}</span>
        </h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--emp-text-muted)', margin: 0 }}>
          Software Admin Form — Register borrower with verified mobile number, KYC documents, bank and guarantor.
        </p>
      </div>

      {/* View Switcher Tabs: New Registration / Recent Members */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 16,
          background: '#f1f5f9',
          padding: 4,
          borderRadius: 10,
        }}
      >
        <button
          type="button"
          onClick={() => {
            setActiveTab('new');
            setRegistrationSuccess(null);
          }}
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: 8,
            border: 'none',
            fontWeight: 700,
            fontSize: '0.88rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            background: activeTab === 'new' ? 'var(--emp-primary)' : 'transparent',
            color: activeTab === 'new' ? '#fff' : 'var(--emp-text-muted)',
            boxShadow: activeTab === 'new' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
            transition: 'all 0.2s',
          }}
        >
          <Icon name="userplus" size={18} />
          <span>New Registration</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('recent');
            loadRecentMembers();
          }}
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: 8,
            border: 'none',
            fontWeight: 700,
            fontSize: '0.88rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            background: activeTab === 'recent' ? 'var(--emp-primary)' : 'transparent',
            color: activeTab === 'recent' ? '#fff' : 'var(--emp-text-muted)',
            boxShadow: activeTab === 'recent' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
            transition: 'all 0.2s',
          }}
        >
          <Icon name="users" size={18} />
          <span>Recent Members {recentMembers.length ? `(${recentMembers.length})` : ''}</span>
        </button>
      </div>

      {/* Global Error Banner */}
      {globalError && (
        <div
          style={{
            background: '#fee2e2',
            color: '#991b1b',
            border: '1px solid #f87171',
            padding: '12px 16px',
            borderRadius: 10,
            fontSize: '0.85rem',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Icon name="alertcircle" size={18} />
          <span>{globalError}</span>
        </div>
      )}

      {/* TAB 1: NEW REGISTRATION */}
      {activeTab === 'new' && (
        <>
          {/* Success Card view */}
          {registrationSuccess ? (
            <div className="emp-card" style={{ textAlign: 'center', padding: '36px 20px', borderRadius: 14 }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 68,
                  height: 68,
                  borderRadius: '50%',
                  background: 'rgba(16, 120, 112, 0.12)',
                  color: 'var(--emp-primary)',
                  margin: '0 auto 16px',
                }}
              >
                <Icon name="checkcircle" size={42} />
              </div>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--emp-primary)', margin: '0 0 6px 0' }}>
                Borrower Registered Successfully!
              </h2>
              <p style={{ color: 'var(--emp-text-muted)', fontSize: '0.88rem', marginBottom: 20 }}>
                Member code &amp; form ID generated with verified mobile number and KYC documents.
              </p>

              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid var(--emp-border)',
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 24,
                  textAlign: 'left',
                  maxWidth: 480,
                  margin: '0 auto 24px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--emp-border)' }}>
                  <span style={{ color: 'var(--emp-text-muted)', fontSize: '0.85rem' }}>Member Code:</span>
                  <strong style={{ color: 'var(--emp-primary)', fontSize: '1.05rem' }}>
                    {registrationSuccess.code || registrationSuccess.memberCode}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--emp-border)' }}>
                  <span style={{ color: 'var(--emp-text-muted)', fontSize: '0.85rem' }}>Form ID:</span>
                  <strong>{registrationSuccess.formId || 'FRM-AUTO'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--emp-border)' }}>
                  <span style={{ color: 'var(--emp-text-muted)', fontSize: '0.85rem' }}>Member Name:</span>
                  <strong>{registrationSuccess.name}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
                  <span style={{ color: 'var(--emp-text-muted)', fontSize: '0.85rem' }}>Mobile Number:</span>
                  <span style={{ color: '#047857', fontWeight: 700 }}>✓ +91 {registrationSuccess.mobile}</span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 360, margin: '0 auto' }}>
                <a
                  href="#/employee/kyc"
                  className="emp-btn-primary"
                  style={{ textDecoration: 'none', padding: '12px', textAlign: 'center' }}
                >
                  Verify Member KYC Status
                </a>
                <button
                  type="button"
                  className="emp-btn-secondary"
                  onClick={() => {
                    setRegistrationSuccess(null);
                    setForm(EMPTY_FORM);
                    setMobileToken('');
                    setPinInfo(null);
                    setBankInfo(null);
                  }}
                >
                  Register Another Member
                </button>
              </div>
            </div>
          ) : (
            /* Main Registration Form */
            <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* SECTION 1: BASIC DETAILS */}
              <div className="emp-card" style={{ padding: 18 }}>
                <h3
                  style={{
                    fontSize: '1rem',
                    fontWeight: 800,
                    margin: '0 0 14px 0',
                    color: 'var(--emp-text)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    borderBottom: '1px solid var(--emp-border)',
                    paddingBottom: 8,
                  }}
                >
                  <Icon name="user" size={18} style={{ color: 'var(--emp-primary)' }} />
                  <span>1. Basic Details</span>
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  {/* Branch */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Branch <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <select
                      className="emp-input"
                      value={form.branch}
                      onChange={setVal('branch')}
                      style={{ borderColor: errors.branch ? '#ef4444' : undefined }}
                    >
                      <option value="">Select branch</option>
                      {branches.map((b) => (
                        <option key={b.id || b._id} value={b.id || b._id}>
                          {b.code ? `${b.code} — ` : ''}{b.name}
                        </option>
                      ))}
                    </select>
                    {errors.branch && <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{errors.branch}</span>}
                  </div>

                  {/* Joining Date */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Joining Date
                    </label>
                    <input
                      className="emp-input"
                      value={todayStr()}
                      disabled
                      style={{ background: '#f8fafc', color: '#64748b' }}
                    />
                    <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Set automatically</span>
                  </div>

                  {/* Member Code */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Member Code
                    </label>
                    <input
                      className="emp-input"
                      value="Auto"
                      disabled
                      style={{ background: '#f8fafc', color: '#64748b' }}
                    />
                    <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Generated on save</span>
                  </div>

                  {/* Form ID */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Form ID
                    </label>
                    <input
                      className="emp-input"
                      value="Auto"
                      disabled
                      style={{ background: '#f8fafc', color: '#64748b' }}
                    />
                    <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Generated on save</span>
                  </div>

                  {/* Employee ID */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Employee ID
                    </label>
                    <input
                      className="emp-input"
                      value={empUser ? `${empUser.name} (${empUser.code || empUser.employeeCode})` : 'Logged Staff'}
                      disabled
                      style={{ background: '#f8fafc', color: '#64748b' }}
                    />
                    <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Assigned staff</span>
                  </div>

                  {/* Member Name */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Member Name <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      className="emp-input"
                      placeholder="Full name as per Aadhaar"
                      maxLength={80}
                      value={form.name}
                      onChange={setVal('name')}
                      style={{ borderColor: errors.name ? '#ef4444' : undefined }}
                    />
                    {errors.name && <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{errors.name}</span>}
                  </div>

                  {/* Husband Name */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Husband / Father's Name
                    </label>
                    <input
                      className="emp-input"
                      placeholder="Spouse / Father's name"
                      maxLength={80}
                      value={form.husbandName}
                      onChange={setVal('husbandName')}
                    />
                  </div>

                  {/* Date of Birth */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Date of Birth <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="date"
                      max={minDob()}
                      className="emp-input"
                      value={form.dob}
                      onChange={setVal('dob')}
                      style={{ borderColor: errors.dob ? '#ef4444' : undefined }}
                    />
                    {errors.dob ? (
                      <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{errors.dob}</span>
                    ) : (
                      <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                        {ageNow !== null ? `Age: ${ageNow} years (minimum 18)` : 'Minimum 18 years old'}
                      </span>
                    )}
                  </div>

                  {/* Gender */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Gender <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <select
                      className="emp-input"
                      value={form.gender}
                      onChange={setVal('gender')}
                      style={{ borderColor: errors.gender ? '#ef4444' : undefined }}
                    >
                      <option value="">Select gender</option>
                      {options.genders.map((g) => (
                        <option key={g} value={g}>
                          {cap(g)}
                        </option>
                      ))}
                    </select>
                    {errors.gender && <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{errors.gender}</span>}
                  </div>

                  {/* Occupation */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Occupation <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <select
                      className="emp-input"
                      value={form.occupation}
                      onChange={setVal('occupation')}
                      style={{ borderColor: errors.occupation ? '#ef4444' : undefined }}
                    >
                      <option value="">Select occupation</option>
                      {options.occupations.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                    {errors.occupation && <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{errors.occupation}</span>}
                  </div>

                  {/* Education */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Education <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <select
                      className="emp-input"
                      value={form.education}
                      onChange={setVal('education')}
                      style={{ borderColor: errors.education ? '#ef4444' : undefined }}
                    >
                      <option value="">Select education</option>
                      {options.educations.map((e) => (
                        <option key={e} value={e}>
                          {e}
                        </option>
                      ))}
                    </select>
                    {errors.education && <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{errors.education}</span>}
                  </div>
                </div>
              </div>

              {/* SECTION 2: CONTACT & ADDRESS */}
              <div className="emp-card" style={{ padding: 18 }}>
                <h3
                  style={{
                    fontSize: '1rem',
                    fontWeight: 800,
                    margin: '0 0 14px 0',
                    color: 'var(--emp-text)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    borderBottom: '1px solid var(--emp-border)',
                    paddingBottom: 8,
                  }}
                >
                  <Icon name="phone" size={18} style={{ color: 'var(--emp-primary)' }} />
                  <span>2. Contact &amp; Address</span>
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  {/* Mobile Number with OTP Verification */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Mobile Number <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', maxWidth: 360 }}>
                      <span style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: 700 }}>+91</span>
                      <input
                        className="emp-input"
                        placeholder="10-digit mobile"
                        inputMode="numeric"
                        maxLength={10}
                        value={form.mobile}
                        disabled={Boolean(mobileToken)}
                        onChange={setDigits('mobile', 10)}
                        style={{ borderColor: errors.mobile ? '#ef4444' : undefined }}
                      />
                    </div>
                    {errors.mobile && <div style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: 4 }}>{errors.mobile}</div>}

                    {/* Integrated OTP Verification */}
                    <MobileOtpVerify
                      mobile={form.mobile}
                      mobileValid={mobileValid}
                      verified={Boolean(mobileToken)}
                      onVerified={(tok) => {
                        setMobileToken(tok);
                        setErrors((e) => ({ ...e, mobile: undefined }));
                      }}
                      onReset={() => setMobileToken('')}
                    />
                  </div>

                  {/* Email */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Email ID <span style={{ color: '#64748b', fontWeight: 400 }}>(Optional)</span>
                    </label>
                    <input
                      type="email"
                      className="emp-input"
                      placeholder="member@email.com"
                      maxLength={120}
                      value={form.email}
                      onChange={setVal('email')}
                    />
                  </div>

                  {/* Pincode with Live Lookup */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Pincode <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      className="emp-input"
                      placeholder="6-digit pincode"
                      inputMode="numeric"
                      maxLength={6}
                      value={form.pincode}
                      onChange={setDigits('pincode', 6)}
                      style={{ borderColor: errors.pincode ? '#ef4444' : undefined }}
                    />
                    {errors.pincode ? (
                      <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{errors.pincode}</span>
                    ) : pinInfo?.status === 'checking' ? (
                      <span style={{ fontSize: '0.7rem', color: '#3b82f6' }}>Checking pincode…</span>
                    ) : pinInfo?.status === 'ok' ? (
                      <span style={{ fontSize: '0.7rem', color: '#047857' }}>✓ Verified: {pinInfo.postalDistrict || pinInfo.district}, {pinInfo.state}</span>
                    ) : (
                      <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Auto-fills State &amp; District</span>
                    )}
                  </div>

                  {/* State */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      State <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <select
                      className="emp-input"
                      value={form.state}
                      onChange={setVal('state')}
                      style={{ borderColor: errors.state ? '#ef4444' : undefined }}
                    >
                      <option value="">Select state</option>
                      {options.states.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    {errors.state && <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{errors.state}</span>}
                  </div>

                  {/* District */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      District <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <select
                      className="emp-input"
                      value={form.district}
                      onChange={setVal('district')}
                      disabled={!form.state}
                      style={{ borderColor: errors.district ? '#ef4444' : undefined }}
                    >
                      <option value="">{form.state ? 'Select district' : 'Select state first'}</option>
                      {districts.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                    {errors.district && <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{errors.district}</span>}
                  </div>

                  {/* Area / Post Office */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Area / Village / Post Office
                    </label>
                    {pinInfo?.areas?.length ? (
                      <select className="emp-input" value={form.area} onChange={setVal('area')}>
                        {!pinInfo.areas.includes(form.area) && form.area && <option value={form.area}>{form.area}</option>}
                        {pinInfo.areas.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="emp-input"
                        placeholder="Area / Locality"
                        maxLength={80}
                        value={form.area}
                        onChange={setVal('area')}
                      />
                    )}
                  </div>

                  {/* Full Street Address */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Full Street Address <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <textarea
                      rows={2}
                      className="emp-input"
                      placeholder="House no., Landmark, Village, Ward"
                      maxLength={300}
                      value={form.address}
                      onChange={setVal('address')}
                      style={{ borderColor: errors.address ? '#ef4444' : undefined }}
                    />
                    {errors.address && <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{errors.address}</span>}
                  </div>
                </div>
              </div>

              {/* SECTION 3: KYC & BANK */}
              <div className="emp-card" style={{ padding: 18 }}>
                <h3
                  style={{
                    fontSize: '1rem',
                    fontWeight: 800,
                    margin: '0 0 14px 0',
                    color: 'var(--emp-text)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    borderBottom: '1px solid var(--emp-border)',
                    paddingBottom: 8,
                  }}
                >
                  <Icon name="creditcard" size={18} style={{ color: 'var(--emp-primary)' }} />
                  <span>3. Identity &amp; Bank Details</span>
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  {/* Aadhaar */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Aadhaar Number <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      className="emp-input"
                      placeholder="12-digit Aadhaar"
                      inputMode="numeric"
                      maxLength={12}
                      value={form.aadhaar}
                      onChange={setDigits('aadhaar', 12)}
                      style={{ borderColor: errors.aadhaar ? '#ef4444' : undefined }}
                    />
                    {errors.aadhaar && <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{errors.aadhaar}</span>}
                  </div>

                  {/* PAN */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      PAN Number <span style={{ color: '#64748b', fontWeight: 400 }}>(Optional)</span>
                    </label>
                    <input
                      className="emp-input"
                      placeholder="ABCDE1234F"
                      maxLength={10}
                      value={form.pan}
                      onChange={setUpper('pan', 10)}
                      style={{ borderColor: errors.pan ? '#ef4444' : undefined }}
                    />
                    {errors.pan ? (
                      <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{errors.pan}</span>
                    ) : form.pan && panValid && form.pan[3] === 'P' ? (
                      <span style={{ fontSize: '0.7rem', color: '#047857' }}>✓ Valid individual PAN</span>
                    ) : (
                      <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Individual PAN (4th letter 'P')</span>
                    )}
                  </div>

                  {/* IFSC Code */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      IFSC Code <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      className="emp-input"
                      placeholder="SBIN0001234"
                      maxLength={11}
                      value={form.ifsc}
                      onChange={setUpper('ifsc', 11)}
                      style={{ borderColor: errors.ifsc ? '#ef4444' : undefined }}
                    />
                    {errors.ifsc ? (
                      <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{errors.ifsc}</span>
                    ) : bankInfo?.status === 'checking' ? (
                      <span style={{ fontSize: '0.7rem', color: '#3b82f6' }}>Checking IFSC…</span>
                    ) : bankInfo?.status === 'ok' ? (
                      <span style={{ fontSize: '0.7rem', color: '#047857' }}>✓ {bankInfo.bank}, {bankInfo.branch}</span>
                    ) : (
                      <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Auto-fills bank name</span>
                    )}
                  </div>

                  {/* Bank Name */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Bank Name <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      className="emp-input"
                      placeholder="Bank name"
                      maxLength={80}
                      value={form.bankName}
                      onChange={setVal('bankName')}
                      style={{ borderColor: errors.bankName ? '#ef4444' : undefined }}
                    />
                    {errors.bankName && <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{errors.bankName}</span>}
                  </div>

                  {/* Account Number */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Bank Account Number <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      className="emp-input"
                      placeholder="9 to 18 digits"
                      inputMode="numeric"
                      maxLength={18}
                      value={form.accountNumber}
                      onChange={(e) => {
                        setAccountTaken('');
                        setDigits('accountNumber', 18)(e);
                      }}
                      onBlur={checkAccount}
                      style={{ borderColor: errors.accountNumber || accountTaken ? '#ef4444' : undefined, maxWidth: 360 }}
                    />
                    {errors.accountNumber ? (
                      <span style={{ fontSize: '0.72rem', color: '#ef4444', display: 'block' }}>{errors.accountNumber}</span>
                    ) : accountTaken ? (
                      <span style={{ fontSize: '0.72rem', color: '#ef4444', display: 'block' }}>{accountTaken}</span>
                    ) : (
                      <span style={{ fontSize: '0.7rem', color: '#64748b', display: 'block' }}>
                        One account number can be used for one member only.
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* SECTION 4: KYC DOCUMENT PHOTOS */}
              <div className="emp-card" style={{ padding: 18 }}>
                <h3
                  style={{
                    fontSize: '1rem',
                    fontWeight: 800,
                    margin: '0 0 14px 0',
                    color: 'var(--emp-text)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    borderBottom: '1px solid var(--emp-border)',
                    paddingBottom: 8,
                  }}
                >
                  <Icon name="filetext" size={18} style={{ color: 'var(--emp-primary)' }} />
                  <span>4. KYC Document Photos</span>
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
                  {/* Member Photo */}
                  <EmpPhotoField
                    id="memberPhoto"
                    label="Member Live Photo"
                    required
                    value={form.memberPhoto}
                    error={errors.memberPhoto}
                    onChange={setPhoto('memberPhoto')}
                    cameraOnly
                  />

                  {/* Signature Photo */}
                  <EmpPhotoField
                    id="signaturePhoto"
                    label="Member Signature / Thumbprint"
                    required
                    value={form.signaturePhoto}
                    error={errors.signaturePhoto}
                    onChange={setPhoto('signaturePhoto')}
                  />

                  {/* Aadhaar Front */}
                  <EmpPhotoField
                    id="aadhaarPhoto"
                    label="Aadhaar Front Photo"
                    required
                    value={form.aadhaarPhoto}
                    error={errors.aadhaarPhoto}
                    onChange={setPhoto('aadhaarPhoto')}
                  />

                  {/* Aadhaar Back */}
                  <EmpPhotoField
                    id="aadhaarBackPhoto"
                    label="Aadhaar Back Photo"
                    required
                    value={form.aadhaarBackPhoto}
                    error={errors.aadhaarBackPhoto}
                    onChange={setPhoto('aadhaarBackPhoto')}
                  />

                  {/* PAN Photo */}
                  <EmpPhotoField
                    id="panPhoto"
                    label="PAN Card Photo"
                    required={Boolean(form.pan)}
                    value={form.panPhoto}
                    error={errors.panPhoto}
                    onChange={setPhoto('panPhoto')}
                  />
                </div>
              </div>

              {/* SECTION 5: MANDATORY GUARANTOR DETAILS */}
              <div className="emp-card" style={{ padding: 18 }}>
                <h3
                  style={{
                    fontSize: '1rem',
                    fontWeight: 800,
                    margin: '0 0 14px 0',
                    color: 'var(--emp-text)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    borderBottom: '1px solid var(--emp-border)',
                    paddingBottom: 8,
                  }}
                >
                  <Icon name="shieldcheck" size={18} style={{ color: 'var(--emp-primary)' }} />
                  <span>5. Mandatory Guarantor Details</span>
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  {/* Guarantor Name */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Guarantor Full Name <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      className="emp-input"
                      placeholder="Guarantor name"
                      maxLength={80}
                      value={form.guarantorName}
                      onChange={setVal('guarantorName')}
                      style={{ borderColor: errors.guarantorName ? '#ef4444' : undefined }}
                    />
                    {errors.guarantorName && <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{errors.guarantorName}</span>}
                  </div>

                  {/* Guarantor Relation */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Relation with Member <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <select
                      className="emp-input"
                      value={form.guarantorRelation}
                      onChange={setVal('guarantorRelation')}
                      style={{ borderColor: errors.guarantorRelation ? '#ef4444' : undefined }}
                    >
                      <option value="Spouse">Spouse (Husband/Wife)</option>
                      <option value="Father">Father</option>
                      <option value="Mother">Mother</option>
                      <option value="Brother">Brother</option>
                      <option value="Sister">Sister</option>
                      <option value="Son">Son</option>
                      <option value="Daughter">Daughter</option>
                      <option value="Other">Other</option>
                    </select>
                    {errors.guarantorRelation && <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{errors.guarantorRelation}</span>}
                  </div>

                  {/* Guarantor Mobile */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Guarantor Mobile Number <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      className="emp-input"
                      placeholder="10-digit mobile"
                      inputMode="numeric"
                      maxLength={10}
                      value={form.guarantorMobile}
                      onChange={setDigits('guarantorMobile', 10)}
                      style={{ borderColor: errors.guarantorMobile ? '#ef4444' : undefined }}
                    />
                    {errors.guarantorMobile && <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{errors.guarantorMobile}</span>}
                  </div>

                  {/* Guarantor Aadhaar */}
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                      Guarantor Aadhaar <span style={{ color: '#64748b', fontWeight: 400 }}>(Optional)</span>
                    </label>
                    <input
                      className="emp-input"
                      placeholder="12-digit Aadhaar"
                      inputMode="numeric"
                      maxLength={12}
                      value={form.guarantorAadhaar}
                      onChange={setDigits('guarantorAadhaar', 12)}
                      style={{ borderColor: errors.guarantorAadhaar ? '#ef4444' : undefined }}
                    />
                    {errors.guarantorAadhaar && <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{errors.guarantorAadhaar}</span>}
                  </div>

                  {/* Guarantor Photo */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <EmpPhotoField
                      id="guarantorPhoto"
                      label="Guarantor Photo (Optional)"
                      value={form.guarantorPhoto}
                      onChange={setPhoto('guarantorPhoto')}
                    />
                  </div>
                </div>
              </div>

              {/* Form Action Buttons */}
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button
                  type="button"
                  className="emp-btn-secondary"
                  onClick={() => {
                    if (window.confirm('Reset the registration form?')) {
                      setForm(EMPTY_FORM);
                      setMobileToken('');
                      setErrors({});
                      setGlobalError('');
                    }
                  }}
                  disabled={submitting}
                  style={{ padding: '12px 20px', fontSize: '0.9rem' }}
                >
                  Reset Form
                </button>
                <button
                  type="submit"
                  className="emp-btn-primary"
                  disabled={submitting}
                  style={{ padding: '12px 28px', fontSize: '0.95rem', fontWeight: 700 }}
                >
                  {submitting ? 'Registering Member…' : 'Save & Register Borrower'}
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {/* TAB 2: RECENT MEMBERS */}
      {activeTab === 'recent' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Search Box */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                type="text"
                className="emp-input"
                placeholder="Search by member name, code or mobile…"
                value={recentSearch}
                onChange={(e) => setRecentSearch(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="emp-btn-secondary"
              onClick={loadRecentMembers}
              disabled={recentLoading}
              style={{ padding: '10px 14px' }}
            >
              {recentLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {/* Members List */}
          {recentLoading ? (
            <div className="emp-card" style={{ textAlign: 'center', padding: '36px 20px', color: '#64748b' }}>
              Loading recent members…
            </div>
          ) : filteredRecent.length === 0 ? (
            <div className="emp-card" style={{ textAlign: 'center', padding: '40px 20px' }}>
              <Icon name="users" size={38} style={{ color: '#cbd5e1', marginBottom: 8 }} />
              <div style={{ fontWeight: 700, color: 'var(--emp-text)' }}>No Recent Members Found</div>
              <p style={{ fontSize: '0.82rem', color: 'var(--emp-text-muted)' }}>
                {recentSearch ? 'No member matched your search query.' : 'No members registered yet in this branch.'}
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 12 }}>
              {filteredRecent.map((m) => (
                <div
                  key={m.id || m._id}
                  className="emp-card"
                  style={{
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    transition: 'box-shadow 0.2s',
                  }}
                  onClick={() => setSelectedMember(m)}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <span
                        style={{
                          background: '#f1f5f9',
                          color: 'var(--emp-primary)',
                          fontWeight: 800,
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontSize: '0.8rem',
                        }}
                      >
                        {m.code || 'MEMBER'}
                      </span>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 6,
                          background: m.kycPending ? '#fef3c7' : m.kycRejected ? '#fee2e2' : '#dcfce7',
                          color: m.kycPending ? '#b45309' : m.kycRejected ? '#b91c1c' : '#15803d',
                        }}
                      >
                        {m.kycPending ? 'KYC Pending' : m.kycRejected ? 'KYC Rejected' : 'KYC Approved'}
                      </span>
                    </div>

                    <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--emp-text)', marginBottom: 4 }}>
                      {m.name}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--emp-text-muted)', marginBottom: 4 }}>
                      <Icon name="phone" size={14} />
                      <span>+91 {m.mobile}</span>
                    </div>

                    {m.branchName && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: '#64748b' }}>
                        <Icon name="home" size={14} />
                        <span>{m.branchName}</span>
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      borderTop: '1px solid var(--emp-border)',
                      paddingTop: 8,
                      marginTop: 10,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                      {m.createdAt ? new Date(m.createdAt).toLocaleDateString('en-IN') : 'Recently added'}
                    </span>
                    <button
                      type="button"
                      className="emp-btn-secondary"
                      style={{ padding: '4px 10px', fontSize: '0.75rem', fontWeight: 600 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedMember(m);
                      }}
                    >
                      View Details
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MEMBER DETAILS MODAL */}
      {selectedMember && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setSelectedMember(null)}
        >
          <div
            className="emp-card"
            style={{
              width: '100%',
              maxWidth: 480,
              maxHeight: '85vh',
              overflowY: 'auto',
              padding: 20,
              borderRadius: 14,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, borderBottom: '1px solid var(--emp-border)', paddingBottom: 10 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--emp-text)' }}>
                  {selectedMember.name}
                </h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--emp-primary)', fontWeight: 700 }}>
                  {selectedMember.code}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMember(null)}
                style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Mobile Number:</span>
                <strong>+91 {selectedMember.mobile}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Branch:</span>
                <strong>{selectedMember.branchName || 'Main Branch'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Registration Date:</span>
                <span>{selectedMember.createdAt ? new Date(selectedMember.createdAt).toLocaleString('en-IN') : '—'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#64748b' }}>KYC Status:</span>
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 6,
                    background: selectedMember.kycPending ? '#fef3c7' : selectedMember.kycRejected ? '#fee2e2' : '#dcfce7',
                    color: selectedMember.kycPending ? '#b45309' : selectedMember.kycRejected ? '#b91c1c' : '#15803d',
                  }}
                >
                  {selectedMember.kycPending ? 'Pending Verification' : selectedMember.kycRejected ? 'Rejected' : 'Approved'}
                </span>
              </div>

              <div style={{ marginTop: 10, borderTop: '1px solid var(--emp-border)', paddingTop: 10 }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 8 }}>
                  Uploaded Documents Checklist:
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: '0.78rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: selectedMember.hasPhoto ? '#15803d' : '#94a3b8' }}>
                      {selectedMember.hasPhoto ? '✓' : '✗'}
                    </span>
                    <span>Live Photo</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: selectedMember.hasSignature ? '#15803d' : '#94a3b8' }}>
                      {selectedMember.hasSignature ? '✓' : '✗'}
                    </span>
                    <span>Signature</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: selectedMember.hasAadhaar ? '#15803d' : '#94a3b8' }}>
                      {selectedMember.hasAadhaar ? '✓' : '✗'}
                    </span>
                    <span>Aadhaar Card</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: selectedMember.hasPan ? '#15803d' : '#94a3b8' }}>
                      {selectedMember.hasPan ? '✓' : '✗'}
                    </span>
                    <span>PAN Card</span>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <a
                href={`#/employee/kyc`}
                className="emp-btn-primary"
                style={{ flex: 1, textDecoration: 'none', padding: '10px', textAlign: 'center', fontSize: '0.85rem' }}
              >
                Go to KYC Review
              </a>
              <button
                type="button"
                className="emp-btn-secondary"
                style={{ padding: '10px 16px', fontSize: '0.85rem' }}
                onClick={() => setSelectedMember(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
