import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';
import { compressImage } from '../../../utils/image.js';

const OCCUPATIONS = ['Agriculture', 'Business', 'Daily Wage', 'Housewife', 'Salaried', 'Self-employed', 'Other'];
const EDUCATIONS = ['Illiterate', 'Primary', 'Secondary', 'Higher Secondary', 'Graduate', 'Postgraduate', 'Other'];
const GENDERS = [
  { id: 'female', label: 'Female' },
  { id: 'male', label: 'Male' },
  { id: 'other', label: 'Other' },
];

const RELATIONS = ['Spouse', 'Father', 'Mother', 'Son', 'Daughter', 'Brother', 'Sister', 'Other'];

export default function SupervisorNewMember() {
  const navigate = useNavigate();

  // Reference data
  const [branches, setBranches] = useState([]);
  const [staffList, setStaffList] = useState([]);

  // Form State
  const [form, setForm] = useState({
    branch: '',
    employeeCode: '',
    name: '',
    dob: '',
    gender: 'female',
    husbandName: '',
    fatherName: '',
    occupation: 'Self-employed',
    education: 'Secondary',
    mobile: '',
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
    // KYC Photos
    memberPhoto: '',
    aadhaarPhoto: '',
    aadhaarBackPhoto: '',
    signaturePhoto: '',
    panPhoto: '',
    // Guarantor
    guarantorName: '',
    guarantorRelation: 'Spouse',
    guarantorMobile: '',
    guarantorAadhaar: '',
    guarantorPhoto: '',
  });

  // OTP State
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [devOtp, setDevOtp] = useState('');
  const [mobileVerified, setMobileVerified] = useState(false);
  const [verifiedToken, setVerifiedToken] = useState('');

  // UI State
  const [pinLoading, setPinLoading] = useState(false);
  const [ifscLoading, setIfscLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [step, setStep] = useState(1); // 1: Personal & Branch, 2: Address & Bank, 3: KYC & Guarantor

  useEffect(() => {
    loadMetadata();
  }, []);

  async function loadMetadata() {
    try {
      const res = await api.supervisorApp.dashboard();
      if (res.branches?.length) {
        setBranches(res.branches);
        setForm((f) => ({ ...f, branch: res.branches[0]._id || res.branches[0].id }));
      }
      if (res.staffMembers?.length) {
        setStaffList(res.staffMembers);
        setForm((f) => ({ ...f, employeeCode: res.staffMembers[0].employeeCode || '' }));
      }
    } catch {
      // ignore
    }
  }

  // Pincode auto-lookup
  useEffect(() => {
    if (!/^\d{6}$/.test(form.pincode)) return;
    let active = true;
    setPinLoading(true);
    api.members
      .pincode(form.pincode)
      .then((r) => {
        if (!active) return;
        if (r && r.status === 'ok') {
          setForm((f) => ({
            ...f,
            state: r.state || f.state,
            district: r.district || r.postalDistrict || f.district,
            area: r.areas?.[0] || f.area,
          }));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setPinLoading(false);
      });
    return () => {
      active = false;
    };
  }, [form.pincode]);

  // IFSC auto-lookup
  useEffect(() => {
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.ifsc.toUpperCase())) return;
    let active = true;
    setIfscLoading(true);
    api.members
      .ifsc(form.ifsc.toUpperCase())
      .then((r) => {
        if (!active) return;
        if (r && r.status === 'ok' && r.bank) {
          setForm((f) => ({ ...f, bankName: r.bank }));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setIfscLoading(false);
      });
    return () => {
      active = false;
    };
  }, [form.ifsc]);

  const handlePhotoUpload = async (e, field) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const b64 = await compressImage(file, field === 'signaturePhoto' ? { maxSide: 600 } : { maxSide: 1000, quality: 0.8 });
      setForm((f) => ({ ...f, [field]: b64 }));
    } catch {
      alert('Photo compression failed');
    }
  };

  async function handleSendOtp(e) {
    e.preventDefault();
    if (!/^\d{10}$/.test(form.mobile)) {
      setError('Please enter a valid 10-digit mobile number');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.supervisorApp.sendMemberOtp(form.mobile);
      setOtpSent(true);
      setDevOtp(res.devOtp || '');
      setSuccess(res.message || 'OTP sent successfully to member mobile');
    } catch (err) {
      setError(err.message || 'Failed to send OTP');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(e) {
    e.preventDefault();
    if (!/^\d{4,6}$/.test(otp)) {
      setError('Please enter the OTP');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.supervisorApp.verifyMemberOtp({ mobile: form.mobile, otp });
      setVerifiedToken(res.token || 'verified');
      setMobileVerified(true);
      setSuccess('✓ Mobile verified successfully!');
    } catch (err) {
      setError(err.message || 'Invalid or expired OTP');
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    // Validations
    if (!form.name.trim()) return setError('Member full name is required');
    if (!form.branch) return setError('Please select a branch');
    if (!/^\d{10}$/.test(form.mobile)) return setError('Valid 10-digit mobile number is required');
    if (!mobileVerified && !verifiedToken) return setError('Please verify member mobile number with OTP');
    if (!form.dob) return setError('Date of birth is required');
    if (!/^\d{12}$/.test(form.aadhaar.replace(/\D/g, ''))) return setError('12-digit Aadhaar number is required');
    if (!form.memberPhoto) return setError('Member photo is required');
    if (!form.aadhaarPhoto) return setError('Aadhaar front photo is required');
    if (!form.aadhaarBackPhoto) return setError('Aadhaar back photo is required');
    if (!form.signaturePhoto) return setError('Member signature photo is required');

    setBusy(true);
    try {
      const payload = {
        ...form,
        aadhaar: form.aadhaar.replace(/\D/g, ''),
        pan: form.pan.trim().toUpperCase(),
        ifsc: form.ifsc.trim().toUpperCase(),
        accountNumber: form.accountNumber.trim(),
      };

      const res = await api.supervisorApp.registerMember(payload, verifiedToken);
      setSuccess(`✓ Member onboarded successfully! Member Code: ${res.member?.code || 'Generated'}`);
      setTimeout(() => navigate('/supervisor/new-member-report'), 1500);
    } catch (err) {
      setError(err.message || 'Failed to register member');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>New Member Onboarding</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>
          Complete System-Aligned Registration (Borrower KYC & Guarantor)
        </div>
      </div>

      {/* Stepper Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <button
          type="button"
          className={`sup-btn sm ${step === 1 ? 'primary' : 'secondary'}`}
          style={{ flex: 1, padding: '8px 4px', fontSize: '0.78rem' }}
          onClick={() => setStep(1)}
        >
          1. Basic Details
        </button>
        <button
          type="button"
          className={`sup-btn sm ${step === 2 ? 'primary' : 'secondary'}`}
          style={{ flex: 1, padding: '8px 4px', fontSize: '0.78rem' }}
          onClick={() => setStep(2)}
        >
          2. Address & Bank
        </button>
        <button
          type="button"
          className={`sup-btn sm ${step === 3 ? 'primary' : 'secondary'}`}
          style={{ flex: 1, padding: '8px 4px', fontSize: '0.78rem' }}
          onClick={() => setStep(3)}
        >
          3. KYC & Guarantor
        </button>
      </div>

      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            background: 'var(--sup-danger-light)',
            color: 'var(--sup-danger)',
            borderRadius: 10,
            fontSize: '0.85rem',
            marginBottom: 14,
          }}
        >
          <Icon name="alertcircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            background: 'var(--sup-success-light)',
            color: 'var(--sup-success)',
            borderRadius: 10,
            fontSize: '0.85rem',
            marginBottom: 14,
          }}
        >
          <Icon name="checkcircle" size={16} />
          <span>{success}</span>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* STEP 1: Basic Details & Verification */}
        {step === 1 && (
          <div className="sup-card" style={{ borderTop: '4px solid var(--sup-primary)' }}>
            <strong style={{ fontSize: '0.95rem', display: 'block', marginBottom: 12 }}>
              1. Branch, Staff & Personal Information
            </strong>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="sup-input-group">
                <label className="sup-label">Branch *</label>
                <select
                  className="sup-select"
                  value={form.branch}
                  onChange={(e) => setForm({ ...form, branch: e.target.value })}
                >
                  {branches.map((b) => (
                    <option key={b._id || b.id} value={b._id || b.id}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sup-input-group">
                <label className="sup-label">Assigned Staff Code</label>
                <select
                  className="sup-select"
                  value={form.employeeCode}
                  onChange={(e) => setForm({ ...form, employeeCode: e.target.value })}
                >
                  <option value="">Select Staff</option>
                  {staffList.map((s) => (
                    <option key={s.employeeCode} value={s.employeeCode}>
                      {s.employeeCode} — {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="sup-input-group">
              <label className="sup-label">Member Full Name (As per Aadhaar) *</label>
              <input
                type="text"
                required
                className="sup-input"
                placeholder="e.g. Sunita Devi"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="sup-input-group">
                <label className="sup-label">Date of Birth *</label>
                <input
                  type="date"
                  required
                  className="sup-input"
                  value={form.dob}
                  onChange={(e) => setForm({ ...form, dob: e.target.value })}
                />
              </div>

              <div className="sup-input-group">
                <label className="sup-label">Gender *</label>
                <select
                  className="sup-select"
                  value={form.gender}
                  onChange={(e) => setForm({ ...form, gender: e.target.value })}
                >
                  {GENDERS.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="sup-input-group">
                <label className="sup-label">Husband / Father Name</label>
                <input
                  type="text"
                  className="sup-input"
                  placeholder="Spouse or Father name"
                  value={form.husbandName || form.fatherName}
                  onChange={(e) => setForm({ ...form, husbandName: e.target.value, fatherName: e.target.value })}
                />
              </div>

              <div className="sup-input-group">
                <label className="sup-label">Occupation</label>
                <select
                  className="sup-select"
                  value={form.occupation}
                  onChange={(e) => setForm({ ...form, occupation: e.target.value })}
                >
                  {OCCUPATIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Mobile OTP Section */}
            <div style={{ marginTop: 10, padding: 12, background: 'var(--sup-bg)', borderRadius: 10, border: '1px solid var(--sup-border)' }}>
              <label className="sup-label">Mobile Number (Must be OTP Verified) *</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  className="sup-input"
                  placeholder="10-digit mobile"
                  value={form.mobile}
                  disabled={mobileVerified}
                  onChange={(e) => setForm({ ...form, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                />
                {!mobileVerified && (
                  <button
                    type="button"
                    className="sup-btn sm primary"
                    style={{ width: 'auto', whiteSpace: 'nowrap' }}
                    onClick={handleSendOtp}
                    disabled={busy || form.mobile.length !== 10}
                  >
                    {busy ? 'Sending…' : otpSent ? 'Resend OTP' : 'Send OTP'}
                  </button>
                )}
              </div>

              {otpSent && !mobileVerified && (
                <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="tel"
                    maxLength={6}
                    className="sup-input"
                    placeholder="Enter 6-digit OTP"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    style={{ maxWidth: 150 }}
                  />
                  <button
                    type="button"
                    className="sup-btn sm"
                    style={{ width: 'auto' }}
                    onClick={handleVerifyOtp}
                    disabled={busy || otp.length < 4}
                  >
                    Verify OTP
                  </button>
                  {devOtp && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>
                      Dev OTP: <strong>{devOtp}</strong>
                    </span>
                  )}
                </div>
              )}

              {mobileVerified && (
                <div style={{ fontSize: '0.78rem', color: 'var(--sup-success)', fontWeight: 700, marginTop: 6 }}>
                  ✓ Mobile number verified
                </div>
              )}
            </div>

            <button
              type="button"
              className="sup-btn primary"
              style={{ marginTop: 16 }}
              onClick={() => setStep(2)}
            >
              Next: Address & Bank Details →
            </button>
          </div>
        )}

        {/* STEP 2: Address & Bank Details */}
        {step === 2 && (
          <div className="sup-card" style={{ borderTop: '4px solid var(--sup-primary)' }}>
            <strong style={{ fontSize: '0.95rem', display: 'block', marginBottom: 12 }}>
              2. Address & Bank Account Details
            </strong>

            <div className="sup-input-group">
              <label className="sup-label">Address Line (Village / Street) *</label>
              <textarea
                rows={2}
                className="sup-textarea"
                placeholder="House No, Ward, Village or Road"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="sup-input-group">
                <label className="sup-label">Pincode (Auto-lookup) *</label>
                <input
                  type="tel"
                  maxLength={6}
                  className="sup-input"
                  placeholder="6-digit Pincode"
                  value={form.pincode}
                  onChange={(e) => setForm({ ...form, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                />
                {pinLoading && <div style={{ fontSize: '0.7rem', color: 'var(--sup-primary)' }}>Looking up pincode…</div>}
              </div>

              <div className="sup-input-group">
                <label className="sup-label">State *</label>
                <input
                  type="text"
                  className="sup-input"
                  placeholder="State"
                  value={form.state}
                  onChange={(e) => setForm({ ...form, state: e.target.value })}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="sup-input-group">
                <label className="sup-label">District *</label>
                <input
                  type="text"
                  className="sup-input"
                  placeholder="District"
                  value={form.district}
                  onChange={(e) => setForm({ ...form, district: e.target.value })}
                />
              </div>

              <div className="sup-input-group">
                <label className="sup-label">Area / Locality</label>
                <input
                  type="text"
                  className="sup-input"
                  placeholder="Area"
                  value={form.area}
                  onChange={(e) => setForm({ ...form, area: e.target.value })}
                />
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--sup-border)', margin: '14px 0 10px 0', paddingTop: 10 }}>
              <strong style={{ fontSize: '0.88rem', color: 'var(--sup-text-muted)' }}>BANK ACCOUNT DETAILS</strong>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="sup-input-group">
                <label className="sup-label">IFSC Code (Auto-lookup) *</label>
                <input
                  type="text"
                  maxLength={11}
                  className="sup-input"
                  placeholder="e.g. SBIN0000001"
                  value={form.ifsc}
                  onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })}
                />
                {ifscLoading && <div style={{ fontSize: '0.7rem', color: 'var(--sup-primary)' }}>Verifying IFSC…</div>}
              </div>

              <div className="sup-input-group">
                <label className="sup-label">Bank Name *</label>
                <input
                  type="text"
                  className="sup-input"
                  placeholder="Bank Name"
                  value={form.bankName}
                  onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                />
              </div>
            </div>

            <div className="sup-input-group">
              <label className="sup-label">Account Number (9–18 Digits) *</label>
              <input
                type="tel"
                maxLength={18}
                className="sup-input"
                placeholder="Bank Account Number"
                value={form.accountNumber}
                onChange={(e) => setForm({ ...form, accountNumber: e.target.value.replace(/\D/g, '').slice(0, 18) })}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button
                type="button"
                className="sup-btn secondary"
                style={{ flex: 1 }}
                onClick={() => setStep(1)}
              >
                ← Back
              </button>
              <button
                type="button"
                className="sup-btn primary"
                style={{ flex: 1 }}
                onClick={() => setStep(3)}
              >
                Next: KYC & Photos →
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: KYC Photos & Guarantor */}
        {step === 3 && (
          <div className="sup-card" style={{ borderTop: '4px solid var(--sup-primary)' }}>
            <strong style={{ fontSize: '0.95rem', display: 'block', marginBottom: 12 }}>
              3. Identity, KYC Document Photos & Guarantor
            </strong>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="sup-input-group">
                <label className="sup-label">Aadhaar Number (12 Digits) *</label>
                <input
                  type="tel"
                  maxLength={12}
                  className="sup-input"
                  placeholder="•••• •••• ••••"
                  value={form.aadhaar}
                  onChange={(e) => setForm({ ...form, aadhaar: e.target.value.replace(/\D/g, '').slice(0, 12) })}
                />
              </div>

              <div className="sup-input-group">
                <label className="sup-label">PAN Number (Optional)</label>
                <input
                  type="text"
                  maxLength={10}
                  className="sup-input"
                  placeholder="ABCDE1234F"
                  value={form.pan}
                  onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })}
                />
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--sup-border)', margin: '14px 0 10px 0', paddingTop: 10 }}>
              <strong style={{ fontSize: '0.88rem', color: 'var(--sup-text-muted)' }}>MANDATORY KYC PHOTOS (CAMERA / UPLOAD)</strong>
            </div>

            {/* Photo Upload Grids */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <label className="sup-label">Member Photo *</label>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sup-input"
                  style={{ padding: '6px', fontSize: '0.75rem' }}
                  onChange={(e) => handlePhotoUpload(e, 'memberPhoto')}
                />
                {form.memberPhoto && (
                  <img src={form.memberPhoto} alt="Member" style={{ width: '100%', height: 90, objectFit: 'cover', borderRadius: 8, marginTop: 4 }} />
                )}
              </div>

              <div>
                <label className="sup-label">Signature Photo *</label>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sup-input"
                  style={{ padding: '6px', fontSize: '0.75rem' }}
                  onChange={(e) => handlePhotoUpload(e, 'signaturePhoto')}
                />
                {form.signaturePhoto && (
                  <img src={form.signaturePhoto} alt="Signature" style={{ width: '100%', height: 90, objectFit: 'contain', background: '#fff', borderRadius: 8, marginTop: 4 }} />
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <label className="sup-label">Aadhaar Front Photo *</label>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sup-input"
                  style={{ padding: '6px', fontSize: '0.75rem' }}
                  onChange={(e) => handlePhotoUpload(e, 'aadhaarPhoto')}
                />
                {form.aadhaarPhoto && (
                  <img src={form.aadhaarPhoto} alt="Aadhaar Front" style={{ width: '100%', height: 90, objectFit: 'cover', borderRadius: 8, marginTop: 4 }} />
                )}
              </div>

              <div>
                <label className="sup-label">Aadhaar Back Photo *</label>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sup-input"
                  style={{ padding: '6px', fontSize: '0.75rem' }}
                  onChange={(e) => handlePhotoUpload(e, 'aadhaarBackPhoto')}
                />
                {form.aadhaarBackPhoto && (
                  <img src={form.aadhaarBackPhoto} alt="Aadhaar Back" style={{ width: '100%', height: 90, objectFit: 'cover', borderRadius: 8, marginTop: 4 }} />
                )}
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--sup-border)', margin: '14px 0 10px 0', paddingTop: 10 }}>
              <strong style={{ fontSize: '0.88rem', color: 'var(--sup-text-muted)' }}>GUARANTOR / NOMINEE DETAILS</strong>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="sup-input-group">
                <label className="sup-label">Guarantor Name</label>
                <input
                  type="text"
                  className="sup-input"
                  placeholder="Guarantor Name"
                  value={form.guarantorName}
                  onChange={(e) => setForm({ ...form, guarantorName: e.target.value })}
                />
              </div>

              <div className="sup-input-group">
                <label className="sup-label">Relation</label>
                <select
                  className="sup-select"
                  value={form.guarantorRelation}
                  onChange={(e) => setForm({ ...form, guarantorRelation: e.target.value })}
                >
                  {RELATIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="sup-input-group">
                <label className="sup-label">Guarantor Mobile</label>
                <input
                  type="tel"
                  maxLength={10}
                  className="sup-input"
                  placeholder="10-digit mobile"
                  value={form.guarantorMobile}
                  onChange={(e) => setForm({ ...form, guarantorMobile: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                />
              </div>

              <div className="sup-input-group">
                <label className="sup-label">Guarantor Aadhaar</label>
                <input
                  type="tel"
                  maxLength={12}
                  className="sup-input"
                  placeholder="12-digit Aadhaar"
                  value={form.guarantorAadhaar}
                  onChange={(e) => setForm({ ...form, guarantorAadhaar: e.target.value.replace(/\D/g, '').slice(0, 12) })}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button
                type="button"
                className="sup-btn secondary"
                style={{ flex: 1 }}
                onClick={() => setStep(2)}
              >
                ← Back
              </button>
              <button
                type="submit"
                className="sup-btn primary"
                style={{ flex: 2 }}
                disabled={busy}
              >
                {busy ? 'Registering Borrower…' : '✓ Complete Member Onboarding'}
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
