import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import { compressImage } from '../../../utils/image.js';
import Icon from '../../../components/Icon.jsx';

export default function EmployeeNewMember() {
  const { t } = useEmployeeApp();

  // Step 1: Phone verification state
  const [step, setStep] = useState(1); // 1: Phone Input, 2: OTP Verification, 3: Full Registration Form
  const [phone, setPhone] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [otp, setOtp] = useState('');
  const [devOtp, setDevOtp] = useState('');
  const [verifiedToken, setVerifiedToken] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [stepError, setStepError] = useState('');

  // Step 2: Member Form State
  const [options, setOptions] = useState(null);
  const [branches, setBranches] = useState([]);
  const [groups, setGroups] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [registrationSuccess, setRegistrationSuccess] = useState(null);

  const [form, setForm] = useState({
    branch: '',
    group: '',
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
    // 5 Standard Documents
    memberPhoto: '',
    signaturePhoto: '',
    aadhaarPhoto: '',
    aadhaarBackPhoto: '',
    panPhoto: '',
    // Guarantor Details (Optional)
    hasGuarantor: false,
    guarantorName: '',
    guarantorRelation: 'Spouse',
    guarantorMobile: '',
    guarantorAadhaar: '',
    guarantorPhoto: '',
    guarantorJointPhoto: '',
  });

  useEffect(() => {
    // Load branches & groups options
    api.members.options()
      .then((res) => {
        setOptions(res);
        setBranches(res.branches || []);
        if (res.branches && res.branches.length > 0) {
          setForm((f) => ({ ...f, branch: res.branches[0].id || res.branches[0].name }));
        }
      })
      .catch((err) => console.error('Failed to load member options:', err));
  }, []);

  // Update groups when branch changes
  useEffect(() => {
    if (form.branch) {
      api.groups.list({ branch: form.branch, limit: 100 })
        .then((res) => setGroups(res.items || []))
        .catch(() => setGroups([]));
    }
  }, [form.branch]);

  // Handle Send OTP
  const handleSendOtp = async (e) => {
    e.preventDefault();
    if (!/^\d{10}$/.test(phone.trim())) {
      setStepError('Please enter a valid 10-digit mobile number');
      return;
    }
    setSendingOtp(true);
    setStepError('');
    try {
      const res = await api.employeeApp.sendMemberOtp(phone.trim());
      setChallengeId(res.challengeId);
      if (res.devOtp) setDevOtp(res.devOtp);
      setStep(2);
    } catch (err) {
      setStepError(err.message || 'Failed to send OTP');
    } finally {
      setSendingOtp(false);
    }
  };

  // Handle Verify OTP
  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp.trim())) {
      setStepError('Enter the 6-digit OTP');
      return;
    }
    setVerifyingOtp(true);
    setStepError('');
    try {
      const res = await api.employeeApp.verifyMemberOtp({
        mobile: phone.trim(),
        otp: otp.trim(),
        challengeId,
      });
      setVerifiedToken(res.verifiedToken);
      setForm((f) => ({ ...f, mobile: phone.trim(), guarantorMobile: phone.trim() }));
      setStep(3);
    } catch (err) {
      setStepError(err.message || 'Invalid OTP');
    } finally {
      setVerifyingOtp(false);
    }
  };

  // Pincode lookup
  const handlePincodeChange = async (val) => {
    setForm((f) => ({ ...f, pincode: val }));
    if (/^\d{6}$/.test(val)) {
      try {
        const info = await api.members.pincode(val);
        if (info) {
          setForm((f) => ({
            ...f,
            state: info.state || f.state,
            district: info.district || f.district,
            area: info.area || f.area,
          }));
        }
      } catch (e) {
        // silent fail
      }
    }
  };

  // IFSC lookup
  const handleIfscChange = async (val) => {
    const code = val.toUpperCase();
    setForm((f) => ({ ...f, ifsc: code }));
    if (code.length === 11) {
      try {
        const info = await api.members.ifsc(code);
        if (info && info.bank) {
          setForm((f) => ({ ...f, bankName: info.bank }));
        }
      } catch (e) {
        // silent fail
      }
    }
  };

  // Image upload handler
  const handleFile = (key) => async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const b64 = await compressImage(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.8 });
      setForm((f) => ({ ...f, [key]: b64 }));
    } catch (err) {
      alert('Failed to process image');
    }
  };

  // Final Form Submission
  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setFormError('Please enter member name');
    if (!form.branch) return setFormError('Please select a branch');
    if (!form.aadhaar || !/^\d{12}$/.test(form.aadhaar.replace(/\s/g, ''))) {
      return setFormError('Enter a valid 12-digit Aadhaar number');
    }

    setSubmitting(true);
    setFormError('');
    try {
      const payload = {
        ...form,
        guarantorName: form.hasGuarantor ? form.guarantorName : '',
        guarantorRelation: form.hasGuarantor ? form.guarantorRelation : '',
        guarantorMobile: form.hasGuarantor ? form.guarantorMobile : '',
        guarantorAadhaar: form.hasGuarantor ? form.guarantorAadhaar : '',
        guarantorPhoto: form.hasGuarantor ? form.guarantorPhoto : '',
        jointPhoto: form.hasGuarantor ? form.guarantorJointPhoto : '',
      };
      const res = await api.employeeApp.registerMember(payload, verifiedToken);
      setRegistrationSuccess(res);
    } catch (err) {
      setFormError(err.message || 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (registrationSuccess) {
    return (
      <div className="emp-page-container">
        <div className="emp-card" style={{ textAlign: 'center', padding: '36px 20px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 64, height: 64, borderRadius: '50%', background: 'rgba(16, 120, 112, 0.12)', color: 'var(--emp-primary)', margin: '0 auto 16px' }}>
            <Icon name="checkcircle" size={38} />
          </div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--emp-primary)', margin: '0 0 8px 0' }}>
            Member Registered Successfully!
          </h2>
          <p style={{ color: 'var(--emp-text-muted)', fontSize: '0.9rem', marginBottom: 20 }}>
            Member code generated with verified mobile number.
          </p>

          <div style={{ background: 'var(--emp-card-bg)', border: '1px solid var(--emp-border)', borderRadius: 12, padding: 16, marginBottom: 24, textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--emp-border)' }}>
              <span style={{ color: 'var(--emp-text-muted)', fontSize: '0.85rem' }}>Member Code:</span>
              <strong style={{ color: 'var(--emp-primary)', fontSize: '1rem' }}>{registrationSuccess.code || registrationSuccess.memberCode}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--emp-border)' }}>
              <span style={{ color: 'var(--emp-text-muted)', fontSize: '0.85rem' }}>Name:</span>
              <strong>{registrationSuccess.name}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
              <span style={{ color: 'var(--emp-text-muted)', fontSize: '0.85rem' }}>Mobile:</span>
              <span className="emp-verified-badge">✓ {registrationSuccess.mobile}</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <a href={`#/employee/kyc`} className="emp-btn-primary" style={{ textDecoration: 'none', padding: '12px' }}>
              Verify Member KYC Documents
            </a>
            <button
              type="button"
              className="emp-btn-secondary"
              onClick={() => {
                setRegistrationSuccess(null);
                setStep(1);
                setPhone('');
                setOtp('');
                setVerifiedToken('');
              }}
            >
              Register Another Member
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="emp-page-container">
      {/* Step 1: Pre-verification Phone Input */}
      {step === 1 && (
        <div className="emp-card">
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 8px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="userplus" size={22} style={{ color: 'var(--emp-primary)' }} /> {t('newMember')}
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--emp-text-muted)', margin: '0 0 20px 0' }}>
            As per security policy, please verify the member's mobile number via OTP before opening the registration form.
          </p>

          {stepError && (
            <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 14 }}>
              {stepError}
            </div>
          )}

          <form onSubmit={handleSendOtp} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 6 }}>
                Member Mobile Number (10 Digits) *
              </label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: 11, fontSize: '0.95rem', color: 'var(--emp-text-muted)', fontWeight: 600 }}>+91</span>
                <input
                  type="tel"
                  className="emp-input"
                  style={{ paddingLeft: 52 }}
                  placeholder="9876543210"
                  maxLength="10"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              className="emp-btn-primary"
              disabled={sendingOtp || phone.length !== 10}
              style={{ marginTop: 8 }}
            >
              {sendingOtp ? 'Sending OTP...' : 'Send OTP to Verify Number'}
            </button>
          </form>
        </div>
      )}

      {/* Step 2: OTP Verification */}
      {step === 2 && (
        <div className="emp-card">
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 8px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="shieldcheck" size={22} style={{ color: 'var(--emp-primary)' }} /> Verify OTP
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--emp-text-muted)', margin: '0 0 16px 0' }}>
            Enter the 6-digit verification code sent to <strong>+91 {phone}</strong>
          </p>

          {devOtp && (
            <div style={{ background: '#fef3c7', color: '#92400e', padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 14, border: '1px dashed #f59e0b', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="key" size={16} /> <span><strong>Dev Mode OTP:</strong> {devOtp}</span>
            </div>
          )}

          {stepError && (
            <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 14 }}>
              {stepError}
            </div>
          )}

          <form onSubmit={handleVerifyOtp} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 6 }}>
                Enter 6-Digit OTP
              </label>
              <input
                type="text"
                className="emp-input"
                style={{ textAlign: 'center', fontSize: '1.3rem', letterSpacing: '6px', fontWeight: 700 }}
                maxLength="6"
                placeholder="••••••"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                required
              />
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button
                type="button"
                className="emp-btn-secondary"
                style={{ flex: 1 }}
                onClick={() => setStep(1)}
              >
                Change Number
              </button>
              <button
                type="submit"
                className="emp-btn-primary"
                style={{ flex: 1 }}
                disabled={verifyingOtp || otp.length !== 6}
              >
                {verifyingOtp ? 'Verifying...' : 'Verify & Continue'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Step 3: Full Member Registration Form */}
      {step === 3 && (
        <form onSubmit={handleRegisterSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Verified Phone Banner */}
          <div className="emp-card" style={{ background: '#ecfdf5', border: '1px solid #a7f3d0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span className="emp-verified-badge" style={{ fontSize: '0.82rem', padding: '4px 10px' }}>
                  ✓ Mobile Number Verified
                </span>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: 4, color: '#065f46' }}>
                  +91 {form.mobile}
                </div>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#047857', textAlign: 'right', maxWidth: 160 }}>
                Verified by OTP.
              </div>
            </div>
          </div>

          {formError && (
            <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem' }}>
              {formError}
            </div>
          )}

          {/* Section: Basic Details */}
          <div className="emp-card">
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 12px 0', color: 'var(--emp-text)' }}>
              1. Basic Information
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  Full Name *
                </label>
                <input
                  type="text"
                  className="emp-input"
                  placeholder="Enter full name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                    Gender *
                  </label>
                  <select className="emp-input" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                    Date of Birth *
                  </label>
                  <input
                    type="date"
                    className="emp-input"
                    value={form.dob}
                    onChange={(e) => setForm({ ...form, dob: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  Husband / Father's Name
                </label>
                <input
                  type="text"
                  className="emp-input"
                  placeholder="Enter spouse/parent name"
                  value={form.husbandName}
                  onChange={(e) => setForm({ ...form, husbandName: e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                    Occupation
                  </label>
                  <input
                    type="text"
                    className="emp-input"
                    placeholder="e.g. Tailor, Farmer"
                    value={form.occupation}
                    onChange={(e) => setForm({ ...form, occupation: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                    Education
                  </label>
                  <input
                    type="text"
                    className="emp-input"
                    placeholder="e.g. 10th Pass"
                    value={form.education}
                    onChange={(e) => setForm({ ...form, education: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                    Branch *
                  </label>
                  <select
                    className="emp-input"
                    value={form.branch}
                    onChange={(e) => setForm({ ...form, branch: e.target.value })}
                    required
                  >
                    <option value="">Select Branch</option>
                    {branches.map((b) => (
                      <option key={b.id || b._id} value={b.id || b.name}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                    Group (Optional)
                  </label>
                  <select
                    className="emp-input"
                    value={form.group}
                    onChange={(e) => setForm({ ...form, group: e.target.value })}
                  >
                    <option value="">No Group</option>
                    {groups.map((g) => (
                      <option key={g.id || g._id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Section: Address Details */}
          <div className="emp-card">
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 12px 0', color: 'var(--emp-text)' }}>
              2. Address Details
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                    Pincode *
                  </label>
                  <input
                    type="text"
                    className="emp-input"
                    maxLength="6"
                    placeholder="6 digits"
                    value={form.pincode}
                    onChange={(e) => handlePincodeChange(e.target.value.replace(/\D/g, ''))}
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                    State
                  </label>
                  <input
                    type="text"
                    className="emp-input"
                    value={form.state}
                    onChange={(e) => setForm({ ...form, state: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                    District
                  </label>
                  <input
                    type="text"
                    className="emp-input"
                    value={form.district}
                    onChange={(e) => setForm({ ...form, district: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                    Area / Village
                  </label>
                  <input
                    type="text"
                    className="emp-input"
                    value={form.area}
                    onChange={(e) => setForm({ ...form, area: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  Full Street Address
                </label>
                <textarea
                  className="emp-input"
                  rows="2"
                  placeholder="House no., landmark, street"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* Section: KYC & Bank */}
          <div className="emp-card">
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 12px 0', color: 'var(--emp-text)' }}>
              3. Identity & Bank Details
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  Aadhaar Number (12 Digits) *
                </label>
                <input
                  type="text"
                  className="emp-input"
                  maxLength="14"
                  placeholder="xxxx xxxx xxxx"
                  value={form.aadhaar}
                  onChange={(e) => setForm({ ...form, aadhaar: e.target.value })}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  PAN Card Number (Optional)
                </label>
                <input
                  type="text"
                  className="emp-input"
                  maxLength="10"
                  placeholder="ABCDE1234F"
                  value={form.pan}
                  onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                    IFSC Code
                  </label>
                  <input
                    type="text"
                    className="emp-input"
                    maxLength="11"
                    placeholder="SBIN0001234"
                    value={form.ifsc}
                    onChange={(e) => handleIfscChange(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                    Bank Name
                  </label>
                  <input
                    type="text"
                    className="emp-input"
                    placeholder="Bank name"
                    value={form.bankName}
                    onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  Account Number
                </label>
                <input
                  type="text"
                  className="emp-input"
                  placeholder="Bank account number"
                  value={form.accountNumber}
                  onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/* Section: Guarantor Details (Optional) */}
          <div className="emp-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--emp-text)' }}>
                4. Guarantor Details (Optional)
              </h3>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={form.hasGuarantor}
                  onChange={(e) => setForm({ ...form, hasGuarantor: e.target.checked })}
                />
                Add Guarantor
              </label>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', margin: '0 0 10px 0' }}>
              Note: If details or phone number are the same as member, guarantor is optional. Joint photo is optional.
            </p>

            {form.hasGuarantor && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 10, borderTop: '1px solid var(--emp-border)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      Guarantor Name
                    </label>
                    <input
                      type="text"
                      className="emp-input"
                      placeholder="Enter name"
                      value={form.guarantorName}
                      onChange={(e) => setForm({ ...form, guarantorName: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      Relationship
                    </label>
                    <select
                      className="emp-input"
                      value={form.guarantorRelation}
                      onChange={(e) => setForm({ ...form, guarantorRelation: e.target.value })}
                    >
                      <option value="Spouse">Spouse</option>
                      <option value="Father">Father</option>
                      <option value="Mother">Mother</option>
                      <option value="Brother">Brother</option>
                      <option value="Sister">Sister</option>
                      <option value="Son">Son</option>
                      <option value="Daughter">Daughter</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      Guarantor Mobile (Same allowed)
                    </label>
                    <input
                      type="tel"
                      className="emp-input"
                      maxLength="10"
                      placeholder="10 digits"
                      value={form.guarantorMobile}
                      onChange={(e) => setForm({ ...form, guarantorMobile: e.target.value.replace(/\D/g, '') })}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      Guarantor Aadhaar (Optional)
                    </label>
                    <input
                      type="text"
                      className="emp-input"
                      maxLength="12"
                      placeholder="12 digits"
                      value={form.guarantorAadhaar}
                      onChange={(e) => setForm({ ...form, guarantorAadhaar: e.target.value.replace(/\D/g, '') })}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      Guarantor Photo (Optional)
                    </label>
                    <input type="file" accept="image/*" onChange={handleFile('guarantorPhoto')} style={{ fontSize: '0.75rem', width: '100%' }} />
                    {form.guarantorPhoto && <img src={form.guarantorPhoto} alt="Guarantor" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, marginTop: 4 }} />}
                  </div>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      Joint Photo with Member (Optional)
                    </label>
                    <input type="file" accept="image/*" onChange={handleFile('guarantorJointPhoto')} style={{ fontSize: '0.75rem', width: '100%' }} />
                    {form.guarantorJointPhoto && <img src={form.guarantorJointPhoto} alt="Joint" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, marginTop: 4 }} />}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section: Standard 5 Document Uploads */}
          <div className="emp-card">
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 12px 0', color: 'var(--emp-text)' }}>
              5. Standard Documents (5 Photos)
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', margin: '0 0 10px 0' }}>
              Standard documents required for KYC approval:
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  1) Member Photo *
                </label>
                <input type="file" accept="image/*" onChange={handleFile('memberPhoto')} style={{ fontSize: '0.8rem', width: '100%' }} />
                {form.memberPhoto && <img src={form.memberPhoto} alt="Member preview" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, marginTop: 4 }} />}
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  2) Aadhaar Front *
                </label>
                <input type="file" accept="image/*" onChange={handleFile('aadhaarPhoto')} style={{ fontSize: '0.8rem', width: '100%' }} />
                {form.aadhaarPhoto && <img src={form.aadhaarPhoto} alt="Aadhaar Front preview" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, marginTop: 4 }} />}
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  3) Aadhaar Back *
                </label>
                <input type="file" accept="image/*" onChange={handleFile('aadhaarBackPhoto')} style={{ fontSize: '0.8rem', width: '100%' }} />
                {form.aadhaarBackPhoto && <img src={form.aadhaarBackPhoto} alt="Aadhaar Back preview" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, marginTop: 4 }} />}
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  4) PAN Card Photo (Optional)
                </label>
                <input type="file" accept="image/*" onChange={handleFile('panPhoto')} style={{ fontSize: '0.8rem', width: '100%' }} />
                {form.panPhoto && <img src={form.panPhoto} alt="PAN preview" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, marginTop: 4 }} />}
              </div>

              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  5) Member Signature Photo *
                </label>
                <input type="file" accept="image/*" onChange={handleFile('signaturePhoto')} style={{ fontSize: '0.8rem', width: '100%' }} />
                {form.signaturePhoto && <img src={form.signaturePhoto} alt="Signature preview" style={{ width: 120, height: 50, objectFit: 'contain', border: '1px solid var(--emp-border)', borderRadius: 6, marginTop: 4, background: '#fff' }} />}
              </div>
            </div>
          </div>

          <button
            type="submit"
            className="emp-btn-primary"
            style={{ padding: '14px', fontSize: '1rem', fontWeight: 700, margin: '6px 0 20px 0' }}
            disabled={submitting}
          >
            {submitting ? 'Registering Member...' : 'Submit & Register Member'}
          </button>
        </form>
      )}
    </div>
  );
}
