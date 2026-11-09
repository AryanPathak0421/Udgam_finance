import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

const RELATIONS = ['Spouse', 'Husband', 'Wife', 'Father', 'Mother', 'Son', 'Daughter', 'Brother', 'Sister', 'Uncle', 'Aunt', 'Other'];

// Helper to compress image
async function compressImageFile(file, maxWidth = 900, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const elem = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        elem.width = width;
        elem.height = height;
        const ctx = elem.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(elem.toDataURL('image/jpeg', quality));
      };
      img.onerror = (e) => reject(e);
    };
    reader.onerror = (e) => reject(e);
  });
}

export default function EmployeeGuarantorNominee() {
  const { t } = useEmployeeApp();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('code') || searchParams.get('query') || '');
  const [member, setMember] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('guarantor'); // 'guarantor' | 'nominee' | 'history'
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Editing state
  const [isEditingGuarantor, setIsEditingGuarantor] = useState(false);
  const [isEditingNominee, setIsEditingNominee] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Guarantor Form Fields
  const [gName, setGName] = useState('');
  const [gRelation, setGRelation] = useState('Spouse');
  const [gMobile, setGMobile] = useState('');
  const [gAadhaar, setGAadhaar] = useState('');
  const [gPan, setGPan] = useState('');
  const [gAddress, setGAddress] = useState('');
  const [gReason, setGReason] = useState('');
  const [gPhoto, setGPhoto] = useState('');
  const [gSignature, setGSignature] = useState('');
  const [gAadhaarPhoto, setGAadhaarPhoto] = useState('');
  const [gAadhaarBackPhoto, setGAadhaarBackPhoto] = useState('');
  const [gPanPhoto, setGPanPhoto] = useState('');
  const [gJointPhoto, setGJointPhoto] = useState('');

  // Guarantor OTP verification
  const [gOtpVerified, setGOtpVerified] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [showOtpField, setShowOtpField] = useState(false);
  const [gOtp, setGOtp] = useState('');
  const [gChallengeId, setGChallengeId] = useState('');
  const [gDevOtp, setGDevOtp] = useState('');
  const [otpError, setOtpError] = useState('');

  // Nominee Form Fields
  const [sameAsGuarantor, setSameAsGuarantor] = useState(false);
  const [nName, setNName] = useState('');
  const [nRelation, setNRelation] = useState('Spouse');
  const [nMobile, setNMobile] = useState('');
  const [nAadhaar, setNAadhaar] = useState('');
  const [nPan, setNPan] = useState('');
  const [nAge, setNAge] = useState('');
  const [nPhoto, setNPhoto] = useState('');
  const [nSignature, setNSignature] = useState('');
  const [nAadhaarPhoto, setNAadhaarPhoto] = useState('');
  const [nAadhaarBackPhoto, setNAadhaarBackPhoto] = useState('');

  // File Inputs
  const gPhotoRef = useRef(null);
  const gSigRef = useRef(null);
  const gAadhaarFrontRef = useRef(null);
  const gAadhaarBackRef = useRef(null);
  const gPanRef = useRef(null);
  const gJointRef = useRef(null);

  const nPhotoRef = useRef(null);
  const nSigRef = useRef(null);
  const nAadhaarFrontRef = useRef(null);
  const nAadhaarBackRef = useRef(null);

  const handleSearch = async (codeToSearch) => {
    const q = (codeToSearch || query).trim();
    if (!q) return;
    setSearchLoading(true);
    setError('');
    setSuccess('');
    try {
      const data = await api.employeeApp.getGuarantorNominee(q);
      const m = data.member || data;
      setMember(m);
      populateFormFromMember(m);
    } catch (err) {
      // Fallback to memberSynopsis
      try {
        const syn = await api.employeeApp.memberSynopsis(q);
        const m = syn.member || syn;
        setMember(m);
        populateFormFromMember(m);
      } catch (e2) {
        setError(err.message || e2.message || 'Member not found');
        setMember(null);
      }
    } finally {
      setSearchLoading(false);
    }
  };

  const populateFormFromMember = (m) => {
    const g = m.guarantor || {};
    setGName(g.name || '');
    setGRelation(g.relation || 'Spouse');
    setGMobile(g.mobile || '');
    setGAadhaar(g.aadhaar || '');
    setGPan(g.pan || '');
    setGAddress(g.address || '');
    setGPhoto(g.photo || '');
    setGSignature(g.signature || '');
    setGAadhaarPhoto(g.aadhaarPhoto || '');
    setGAadhaarBackPhoto(g.aadhaarBackPhoto || '');
    setGPanPhoto(g.panPhoto || '');
    setGJointPhoto(g.jointPhoto || '');
    setGOtpVerified(Boolean(g.mobileVerifiedAt || (g.mobile && g.name)));
    setIsEditingGuarantor(!g.name);

    const n = m.nominee || {};
    setSameAsGuarantor(Boolean(n.sameAsGuarantor));
    setNName(n.name || '');
    setNRelation(n.relation || 'Spouse');
    setNMobile(n.mobile || '');
    setNAadhaar(n.aadhaar || '');
    setNPan(n.pan || '');
    setNAge(n.age || '');
    setNPhoto(n.photo || '');
    setNSignature(n.signature || '');
    setNAadhaarPhoto(n.aadhaarPhoto || '');
    setNAadhaarBackPhoto(n.aadhaarBackPhoto || '');
    setIsEditingNominee(!n.name);
  };

  useEffect(() => {
    if (query.trim()) {
      handleSearch(query.trim());
    }
  }, []);

  const handleSendGuarantorOtp = async () => {
    if (!/^\d{10}$/.test(gMobile.replace(/\D/g, ''))) {
      setOtpError('Please enter a valid 10-digit mobile number first');
      return;
    }
    setSendingOtp(true);
    setOtpError('');
    try {
      const res = await api.employeeApp.sendGuarantorOtp({ mobile: gMobile.replace(/\D/g, '').slice(-10) });
      setGChallengeId(res.challengeId);
      if (res.devOtp) setGDevOtp(res.devOtp);
      setShowOtpField(true);
    } catch (err) {
      setOtpError(err.message || 'Failed to send OTP');
    } finally {
      setSendingOtp(false);
    }
  };

  const handleVerifyGuarantorOtp = async () => {
    if (!/^\d{6}$/.test(gOtp.trim())) {
      setOtpError('Enter 6-digit OTP');
      return;
    }
    setVerifyingOtp(true);
    setOtpError('');
    try {
      await api.employeeApp.verifyGuarantorOtp({
        mobile: gMobile.replace(/\D/g, '').slice(-10),
        otp: gOtp.trim(),
        challengeId: gChallengeId,
      });
      setGOtpVerified(true);
      setShowOtpField(false);
    } catch (err) {
      setOtpError(err.message || 'Invalid OTP');
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handleFileUpload = async (e, setter) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file, 900, 0.75);
      setter(compressed);
    } catch (err) {
      setError(`Failed to read image: ${err.message}`);
    }
  };

  const handleSameAsGuarantorToggle = (checked) => {
    setSameAsGuarantor(checked);
    if (checked) {
      setNName(gName);
      setNRelation(gRelation);
      setNMobile(gMobile);
      setNAadhaar(gAadhaar);
      setNPan(gPan);
      setNPhoto(gPhoto);
      setNSignature(gSignature);
      setNAadhaarPhoto(gAadhaarPhoto);
      setNAadhaarBackPhoto(gAadhaarBackPhoto);
    }
  };

  const handleSaveGuarantor = async (e) => {
    e?.preventDefault();
    if (!member) return;
    if (!gName.trim()) return setError('Please enter Guarantor full name');
    if (!gRelation) return setError('Please select relation with member');

    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      await api.employeeApp.saveGuarantorNominee({
        memberId: member.id || member._id,
        memberCode: member.code,
        guarantor: {
          name: gName.trim(),
          relation: gRelation,
          mobile: gMobile.replace(/\D/g, '').slice(-10),
          aadhaar: gAadhaar.replace(/\D/g, ''),
          pan: gPan.trim().toUpperCase(),
          address: gAddress.trim(),
          reason: gReason.trim(),
          photo: gPhoto,
          signature: gSignature,
          aadhaarPhoto: gAadhaarPhoto,
          aadhaarBackPhoto: gAadhaarBackPhoto,
          panPhoto: gPanPhoto,
          jointPhoto: gJointPhoto,
        },
      });

      setSuccess('✓ Guarantor details updated successfully!');
      setIsEditingGuarantor(false);
      handleSearch(member.code);
    } catch (err) {
      setError(err.message || 'Failed to update guarantor details');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveNominee = async (e) => {
    e?.preventDefault();
    if (!member) return;
    if (!sameAsGuarantor && !nName.trim()) return setError('Please enter Nominee full name');

    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      await api.employeeApp.saveGuarantorNominee({
        memberId: member.id || member._id,
        memberCode: member.code,
        nominee: {
          sameAsGuarantor,
          name: sameAsGuarantor ? gName.trim() : nName.trim(),
          relation: sameAsGuarantor ? gRelation : nRelation,
          mobile: sameAsGuarantor ? gMobile.replace(/\D/g, '').slice(-10) : nMobile.replace(/\D/g, '').slice(-10),
          aadhaar: sameAsGuarantor ? gAadhaar.replace(/\D/g, '') : nAadhaar.replace(/\D/g, ''),
          pan: sameAsGuarantor ? gPan.trim().toUpperCase() : nPan.trim().toUpperCase(),
          age: nAge ? Number(nAge) : undefined,
          photo: sameAsGuarantor ? gPhoto : nPhoto,
          signature: sameAsGuarantor ? gSignature : nSignature,
          aadhaarPhoto: sameAsGuarantor ? gAadhaarPhoto : nAadhaarPhoto,
          aadhaarBackPhoto: sameAsGuarantor ? gAadhaarBackPhoto : nAadhaarBackPhoto,
        },
      });

      setSuccess('✓ Nominee details updated successfully!');
      setIsEditingNominee(false);
      handleSearch(member.code);
    } catch (err) {
      setError(err.message || 'Failed to update nominee details');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="emp-page-container">
      {/* Search Header */}
      <div className="emp-card" style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 4px', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="shieldcheck" size={22} style={{ color: 'var(--emp-primary)' }} />
          <span>Guarantor &amp; Nominee Module</span>
        </h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', margin: '0 0 12px' }}>
          Search any member to view, add, or update Guarantor and Nominee information with KYC photos.
        </p>

        <form onSubmit={(e) => { e.preventDefault(); handleSearch(); }} style={{ display: 'flex', gap: 8 }}>
          <input
            type="search"
            className="emp-input"
            placeholder="Search Member Code / Mobile / Name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="submit" className="emp-btn-primary" disabled={searchLoading} style={{ padding: '0 16px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="search" size={16} />
            <span>{searchLoading ? 'Searching…' : 'Search'}</span>
          </button>
        </form>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', border: '1.5px solid #ef4444', color: '#991b1b', padding: '10px 14px', borderRadius: 8, fontSize: '0.82rem', marginBottom: 12, fontWeight: 700 }}>
          ⚠️ {error}
        </div>
      )}

      {success && (
        <div style={{ background: '#dcfce7', border: '1.5px solid #22c55e', color: '#166534', padding: '10px 14px', borderRadius: 8, fontSize: '0.82rem', marginBottom: 12, fontWeight: 700 }}>
          {success}
        </div>
      )}

      {member && (
        <>
          {/* Member Summary Header Card */}
          <div className="emp-card" style={{ marginBottom: 12, borderLeft: '4px solid var(--emp-primary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0, color: 'var(--emp-text)' }}>
                  {member.name}
                </h3>
                <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                  Code: <strong>{member.code}</strong> • Mobile: <strong>{member.mobile || 'N/A'}</strong>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                  Branch: {member.branchName || member.branch || 'Main Branch'}
                </div>
              </div>
              <span className="emp-badge emp-badge-info" style={{ fontWeight: 800 }}>
                Member
              </span>
            </div>

            {/* Navigation Tabs */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 14 }}>
              <button
                type="button"
                className={activeTab === 'guarantor' ? 'emp-btn-primary' : 'emp-btn-secondary'}
                style={{ padding: '8px 4px', fontSize: '0.78rem', fontWeight: 700 }}
                onClick={() => setActiveTab('guarantor')}
              >
                Guarantor Details
              </button>
              <button
                type="button"
                className={activeTab === 'nominee' ? 'emp-btn-primary' : 'emp-btn-secondary'}
                style={{ padding: '8px 4px', fontSize: '0.78rem', fontWeight: 700 }}
                onClick={() => setActiveTab('nominee')}
              >
                Nominee Details
              </button>
              <button
                type="button"
                className={activeTab === 'history' ? 'emp-btn-primary' : 'emp-btn-secondary'}
                style={{ padding: '8px 4px', fontSize: '0.78rem', fontWeight: 700 }}
                onClick={() => setActiveTab('history')}
              >
                Change History
              </button>
            </div>
          </div>

          {/* TAB 1: GUARANTOR DETAILS */}
          {activeTab === 'guarantor' && (
            <div className="emp-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 800, margin: 0, color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="shieldcheck" size={16} style={{ color: 'var(--emp-primary)' }} />
                  <span>Guarantor Information</span>
                </h3>
                {member.guarantor?.name && !isEditingGuarantor && (
                  <button
                    type="button"
                    className="emp-btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                    onClick={() => setIsEditingGuarantor(true)}
                  >
                    ✏️ Edit / Change Guarantor
                  </button>
                )}
              </div>

              {!isEditingGuarantor && member.guarantor?.name ? (
                /* View Mode */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, background: '#f8fafc', padding: 12, borderRadius: 8 }}>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Guarantor Name</div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{member.guarantor.name}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Relation</div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{member.guarantor.relation || 'Spouse'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Mobile Number</div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{member.guarantor.mobile || 'Not set'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Aadhaar Number</div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{member.guarantor.aadhaar ? `•••• •••• ${String(member.guarantor.aadhaar).slice(-4)}` : 'Not set'}</div>
                    </div>
                    {member.guarantor.pan && (
                      <div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>PAN Number</div>
                        <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{member.guarantor.pan}</div>
                      </div>
                    )}
                  </div>

                  {/* Photo Thumbnails */}
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, marginBottom: 8, color: 'var(--emp-text)' }}>Guarantor Documents &amp; Photos:</div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {[
                        { label: 'Photo', src: member.guarantor.photo },
                        { label: 'Signature', src: member.guarantor.signature },
                        { label: 'Aadhaar Front', src: member.guarantor.aadhaarPhoto },
                        { label: 'Aadhaar Back', src: member.guarantor.aadhaarBackPhoto },
                        { label: 'Joint Photo', src: member.guarantor.jointPhoto },
                      ].map((item, idx) => (
                        <div key={idx} style={{ textAlign: 'center' }}>
                          {item.src ? (
                            <img src={item.src} alt={item.label} style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--emp-border)' }} />
                          ) : (
                            <div style={{ width: 60, height: 60, borderRadius: 6, background: '#f1f5f9', border: '1px dashed #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', color: '#94a3b8' }}>
                              Missing
                            </div>
                          )}
                          <div style={{ fontSize: '0.68rem', marginTop: 2, color: 'var(--emp-text-muted)' }}>{item.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                /* Edit / Add Mode */
                <form onSubmit={handleSaveGuarantor}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div>
                      <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Guarantor Full Name *
                      </label>
                      <input
                        type="text"
                        className="emp-input"
                        placeholder="Full Name"
                        value={gName}
                        onChange={(e) => setGName(e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Relation *
                      </label>
                      <select
                        className="emp-input"
                        value={gRelation}
                        onChange={(e) => setGRelation(e.target.value)}
                      >
                        {RELATIONS.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div>
                      <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Mobile Number
                      </label>
                      <input
                        type="tel"
                        className="emp-input"
                        placeholder="10-digit mobile"
                        value={gMobile}
                        onChange={(e) => setGMobile(e.target.value)}
                        maxLength={10}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Aadhaar Number
                      </label>
                      <input
                        type="text"
                        className="emp-input"
                        placeholder="12-digit Aadhaar"
                        value={gAadhaar}
                        onChange={(e) => setGAadhaar(e.target.value)}
                        maxLength={12}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div>
                      <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        PAN Number (Optional)
                      </label>
                      <input
                        type="text"
                        className="emp-input"
                        placeholder="ABCDE1234F"
                        value={gPan}
                        onChange={(e) => setGPan(e.target.value.toUpperCase())}
                        maxLength={10}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Address
                      </label>
                      <input
                        type="text"
                        className="emp-input"
                        placeholder="Village / Post / District"
                        value={gAddress}
                        onChange={(e) => setGAddress(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Document & Photo Uploads */}
                  <div style={{ borderTop: '1px solid var(--emp-border)', paddingTop: 10, marginTop: 10 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 8 }}>Guarantor Photos &amp; KYC:</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
                      <div style={{ textAlign: 'center' }}>
                        <input type="file" accept="image/*" ref={gPhotoRef} style={{ display: 'none' }} onChange={(e) => handleFileUpload(e, setGPhoto)} />
                        <div onClick={() => gPhotoRef.current?.click()} style={{ border: '1px dashed var(--emp-border)', borderRadius: 8, padding: 8, cursor: 'pointer', background: '#f8fafc' }}>
                          {gPhoto ? <img src={gPhoto} alt="Photo" style={{ width: '100%', height: 60, objectFit: 'cover', borderRadius: 4 }} /> : <div style={{ fontSize: '0.68rem', color: '#64748b', padding: '14px 0' }}>📷 Photo</div>}
                        </div>
                        <div style={{ fontSize: '0.68rem', marginTop: 2, fontWeight: 600 }}>Photo</div>
                      </div>

                      <div style={{ textAlign: 'center' }}>
                        <input type="file" accept="image/*" ref={gSigRef} style={{ display: 'none' }} onChange={(e) => handleFileUpload(e, setGSignature)} />
                        <div onClick={() => gSigRef.current?.click()} style={{ border: '1px dashed var(--emp-border)', borderRadius: 8, padding: 8, cursor: 'pointer', background: '#f8fafc' }}>
                          {gSignature ? <img src={gSignature} alt="Signature" style={{ width: '100%', height: 60, objectFit: 'contain', borderRadius: 4 }} /> : <div style={{ fontSize: '0.68rem', color: '#64748b', padding: '14px 0' }}>✍️ Sign</div>}
                        </div>
                        <div style={{ fontSize: '0.68rem', marginTop: 2, fontWeight: 600 }}>Signature</div>
                      </div>

                      <div style={{ textAlign: 'center' }}>
                        <input type="file" accept="image/*" ref={gAadhaarFrontRef} style={{ display: 'none' }} onChange={(e) => handleFileUpload(e, setGAadhaarPhoto)} />
                        <div onClick={() => gAadhaarFrontRef.current?.click()} style={{ border: '1px dashed var(--emp-border)', borderRadius: 8, padding: 8, cursor: 'pointer', background: '#f8fafc' }}>
                          {gAadhaarPhoto ? <img src={gAadhaarPhoto} alt="Aadhaar Front" style={{ width: '100%', height: 60, objectFit: 'cover', borderRadius: 4 }} /> : <div style={{ fontSize: '0.68rem', color: '#64748b', padding: '14px 0' }}>🪪 Aadhaar Front</div>}
                        </div>
                        <div style={{ fontSize: '0.68rem', marginTop: 2, fontWeight: 600 }}>Aadhaar Front</div>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
                      <div style={{ textAlign: 'center' }}>
                        <input type="file" accept="image/*" ref={gAadhaarBackRef} style={{ display: 'none' }} onChange={(e) => handleFileUpload(e, setGAadhaarBackPhoto)} />
                        <div onClick={() => gAadhaarBackRef.current?.click()} style={{ border: '1px dashed var(--emp-border)', borderRadius: 8, padding: 8, cursor: 'pointer', background: '#f8fafc' }}>
                          {gAadhaarBackPhoto ? <img src={gAadhaarBackPhoto} alt="Aadhaar Back" style={{ width: '100%', height: 60, objectFit: 'cover', borderRadius: 4 }} /> : <div style={{ fontSize: '0.68rem', color: '#64748b', padding: '14px 0' }}>🪪 Aadhaar Back</div>}
                        </div>
                        <div style={{ fontSize: '0.68rem', marginTop: 2, fontWeight: 600 }}>Aadhaar Back</div>
                      </div>

                      <div style={{ textAlign: 'center' }}>
                        <input type="file" accept="image/*" ref={gPanRef} style={{ display: 'none' }} onChange={(e) => handleFileUpload(e, setGPanPhoto)} />
                        <div onClick={() => gPanRef.current?.click()} style={{ border: '1px dashed var(--emp-border)', borderRadius: 8, padding: 8, cursor: 'pointer', background: '#f8fafc' }}>
                          {gPanPhoto ? <img src={gPanPhoto} alt="PAN Photo" style={{ width: '100%', height: 60, objectFit: 'cover', borderRadius: 4 }} /> : <div style={{ fontSize: '0.68rem', color: '#64748b', padding: '14px 0' }}>💳 PAN Photo</div>}
                        </div>
                        <div style={{ fontSize: '0.68rem', marginTop: 2, fontWeight: 600 }}>PAN Card</div>
                      </div>

                      <div style={{ textAlign: 'center' }}>
                        <input type="file" accept="image/*" ref={gJointRef} style={{ display: 'none' }} onChange={(e) => handleFileUpload(e, setGJointPhoto)} />
                        <div onClick={() => gJointRef.current?.click()} style={{ border: '1px dashed var(--emp-border)', borderRadius: 8, padding: 8, cursor: 'pointer', background: '#f8fafc' }}>
                          {gJointPhoto ? <img src={gJointPhoto} alt="Joint Photo" style={{ width: '100%', height: 60, objectFit: 'cover', borderRadius: 4 }} /> : <div style={{ fontSize: '0.68rem', color: '#64748b', padding: '14px 0' }}>👥 Joint Photo</div>}
                        </div>
                        <div style={{ fontSize: '0.68rem', marginTop: 2, fontWeight: 600 }}>Joint Photo</div>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    {member.guarantor?.name && (
                      <button
                        type="button"
                        className="emp-btn-secondary"
                        style={{ flex: 1 }}
                        onClick={() => setIsEditingGuarantor(false)}
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="submit"
                      className="emp-btn-primary"
                      disabled={submitting}
                      style={{ flex: 2 }}
                    >
                      {submitting ? 'Saving Guarantor…' : 'Save Guarantor Details'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* TAB 2: NOMINEE DETAILS */}
          {activeTab === 'nominee' && (
            <div className="emp-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 800, margin: 0, color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="userplus" size={16} style={{ color: 'var(--emp-primary)' }} />
                  <span>Nominee Information</span>
                </h3>
                {member.nominee?.name && !isEditingNominee && (
                  <button
                    type="button"
                    className="emp-btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                    onClick={() => setIsEditingNominee(true)}
                  >
                    ✏️ Edit Nominee Details
                  </button>
                )}
              </div>

              {!isEditingNominee && member.nominee?.name ? (
                /* View Mode */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, background: '#f8fafc', padding: 12, borderRadius: 8 }}>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Nominee Name</div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{member.nominee.name}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Relation</div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{member.nominee.relation || 'Nominee'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Mobile Number</div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{member.nominee.mobile || 'Not set'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Aadhaar Number</div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{member.nominee.aadhaar ? `•••• •••• ${String(member.nominee.aadhaar).slice(-4)}` : 'Not set'}</div>
                    </div>
                    {member.nominee.sameAsGuarantor && (
                      <div style={{ gridColumn: 'span 2' }}>
                        <span style={{ fontSize: '0.72rem', background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
                          ✓ Nominee is same person as Guarantor
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Edit / Add Nominee Mode */
                <form onSubmit={handleSaveNominee}>
                  <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 8, marginBottom: 12, border: '1px solid var(--emp-border)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700 }}>
                      <input
                        type="checkbox"
                        checked={sameAsGuarantor}
                        onChange={(e) => handleSameAsGuarantorToggle(e.target.checked)}
                      />
                      <span>Nominee is same person as Guarantor</span>
                    </label>
                    <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)', marginLeft: 24, marginTop: 2 }}>
                      Copies full name, mobile, Aadhaar, and photos directly from the Guarantor.
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div>
                      <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Nominee Full Name *
                      </label>
                      <input
                        type="text"
                        className="emp-input"
                        placeholder="Full Name"
                        value={nName}
                        onChange={(e) => setNName(e.target.value)}
                        disabled={sameAsGuarantor}
                        required={!sameAsGuarantor}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Relation *
                      </label>
                      <select
                        className="emp-input"
                        value={nRelation}
                        onChange={(e) => setNRelation(e.target.value)}
                      >
                        {RELATIONS.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div>
                      <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Mobile Number
                      </label>
                      <input
                        type="tel"
                        className="emp-input"
                        placeholder="10-digit mobile"
                        value={nMobile}
                        onChange={(e) => setNMobile(e.target.value)}
                        disabled={sameAsGuarantor}
                        maxLength={10}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Aadhaar Number
                      </label>
                      <input
                        type="text"
                        className="emp-input"
                        placeholder="12-digit Aadhaar"
                        value={nAadhaar}
                        onChange={(e) => setNAadhaar(e.target.value)}
                        disabled={sameAsGuarantor}
                        maxLength={12}
                      />
                    </div>
                  </div>

                  {!sameAsGuarantor && (
                    <div style={{ borderTop: '1px solid var(--emp-border)', paddingTop: 10, marginTop: 10 }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 8 }}>Nominee Photos (Optional):</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
                        <div style={{ textAlign: 'center' }}>
                          <input type="file" accept="image/*" ref={nPhotoRef} style={{ display: 'none' }} onChange={(e) => handleFileUpload(e, setNPhoto)} />
                          <div onClick={() => nPhotoRef.current?.click()} style={{ border: '1px dashed var(--emp-border)', borderRadius: 8, padding: 8, cursor: 'pointer', background: '#f8fafc' }}>
                            {nPhoto ? <img src={nPhoto} alt="Photo" style={{ width: '100%', height: 60, objectFit: 'cover', borderRadius: 4 }} /> : <div style={{ fontSize: '0.68rem', color: '#64748b', padding: '14px 0' }}>📷 Photo</div>}
                          </div>
                          <div style={{ fontSize: '0.68rem', marginTop: 2, fontWeight: 600 }}>Photo</div>
                        </div>

                        <div style={{ textAlign: 'center' }}>
                          <input type="file" accept="image/*" ref={nSigRef} style={{ display: 'none' }} onChange={(e) => handleFileUpload(e, setNSignature)} />
                          <div onClick={() => nSigRef.current?.click()} style={{ border: '1px dashed var(--emp-border)', borderRadius: 8, padding: 8, cursor: 'pointer', background: '#f8fafc' }}>
                            {nSignature ? <img src={nSignature} alt="Signature" style={{ width: '100%', height: 60, objectFit: 'contain', borderRadius: 4 }} /> : <div style={{ fontSize: '0.68rem', color: '#64748b', padding: '14px 0' }}>✍️ Sign</div>}
                          </div>
                          <div style={{ fontSize: '0.68rem', marginTop: 2, fontWeight: 600 }}>Signature</div>
                        </div>

                        <div style={{ textAlign: 'center' }}>
                          <input type="file" accept="image/*" ref={nAadhaarFrontRef} style={{ display: 'none' }} onChange={(e) => handleFileUpload(e, setNAadhaarPhoto)} />
                          <div onClick={() => nAadhaarFrontRef.current?.click()} style={{ border: '1px dashed var(--emp-border)', borderRadius: 8, padding: 8, cursor: 'pointer', background: '#f8fafc' }}>
                            {nAadhaarPhoto ? <img src={nAadhaarPhoto} alt="Aadhaar Front" style={{ width: '100%', height: 60, objectFit: 'cover', borderRadius: 4 }} /> : <div style={{ fontSize: '0.68rem', color: '#64748b', padding: '14px 0' }}>🪪 Aadhaar Front</div>}
                          </div>
                          <div style={{ fontSize: '0.68rem', marginTop: 2, fontWeight: 600 }}>Aadhaar Front</div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    {member.nominee?.name && (
                      <button
                        type="button"
                        className="emp-btn-secondary"
                        style={{ flex: 1 }}
                        onClick={() => setIsEditingNominee(false)}
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="submit"
                      className="emp-btn-primary"
                      disabled={submitting}
                      style={{ flex: 2 }}
                    >
                      {submitting ? 'Saving Nominee…' : 'Save Nominee Details'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* TAB 3: CHANGE HISTORY */}
          {activeTab === 'history' && (
            <div className="emp-card">
              <h3 style={{ fontSize: '0.95rem', fontWeight: 800, margin: '0 0 10px', color: 'var(--emp-text)' }}>
                Guarantor Replacement &amp; Audit History
              </h3>
              {(!member.guarantorHistory || member.guarantorHistory.length === 0) ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--emp-text-muted)', fontSize: '0.85rem' }}>
                  No previous guarantor replacement records on file for this member.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {member.guarantorHistory.map((h, i) => (
                    <div key={i} style={{ border: '1px solid var(--emp-border)', borderRadius: 8, padding: 10, background: '#f8fafc' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong>{h.name} ({h.relation || 'Guarantor'})</strong>
                        <span style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>
                          Replaced: {h.replacedAt ? new Date(h.replacedAt).toLocaleDateString() : 'N/A'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                        Mobile: {h.mobile || 'N/A'} • Aadhaar: {h.aadhaar ? `•••• ${String(h.aadhaar).slice(-4)}` : 'N/A'}
                      </div>
                      {h.reason && (
                        <div style={{ fontSize: '0.75rem', color: '#92400e', marginTop: 4, background: '#fef3c7', padding: '4px 8px', borderRadius: 4 }}>
                          Reason: {h.reason}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
