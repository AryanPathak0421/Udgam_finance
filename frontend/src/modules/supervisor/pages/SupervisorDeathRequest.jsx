import { useState, useEffect } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';
import { compressImage } from '../../../utils/image.js';

export default function SupervisorDeathRequest() {
  const [activeTab, setActiveTab] = useState('new'); // 'new' | 'list'

  // Member search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);

  // Form state
  const [targetType, setTargetType] = useState('member'); // 'member' | 'guarantor'
  const [guarantorName, setGuarantorName] = useState('');
  const [deathDate, setDeathDate] = useState(new Date().toISOString().slice(0, 10));
  const [deathReason, setDeathReason] = useState('');

  // 3 Death photos
  const [deathPhoto1, setDeathPhoto1] = useState('');
  const [deathPhoto2, setDeathPhoto2] = useState('');
  const [deathPhoto3, setDeathPhoto3] = useState('');

  // 1 House visit photo
  const [houseVisitPhoto, setHouseVisitPhoto] = useState('');

  // 1 Death certificate
  const [deathCertificate, setDeathCertificate] = useState('');

  // Claimant / Nominee state
  const [claimantName, setClaimantName] = useState('');
  const [claimantRelation, setClaimantRelation] = useState('Nominee');
  const [claimantAadhaar, setClaimantAadhaar] = useState('');
  const [claimantPan, setClaimantPan] = useState('');
  const [claimantAadhaarVerified, setClaimantAadhaarVerified] = useState(false);
  const [claimantPanVerified, setClaimantPanVerified] = useState(false);
  const [verifyingClaimant, setVerifyingClaimant] = useState({ pan: false, aadhaar: false, okycOtp: false });
  const [claimantOkycSession, setClaimantOkycSession] = useState({ open: false, sessionId: '', otp: '' });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // List state
  const [requests, setRequests] = useState([]);
  const [loadingList, setLoadingList] = useState(false);

  // Handle member search
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setError('');
    try {
      const res = await api.supervisorApp.memberSynopsis(searchQuery.trim());
      if (res && res.member) {
        setSelectedMember(res.member);
        setGuarantorName(res.member.guarantor?.name || '');
        if (res.member.nominee?.name) {
          setClaimantName(res.member.nominee.name);
          setClaimantRelation(res.member.nominee.relation || 'Nominee');
          if (res.member.nominee.aadhaar) setClaimantAadhaar(res.member.nominee.aadhaar);
        }
      } else {
        setError('No member found with this code or mobile number.');
      }
    } catch (err) {
      setError(err.message || 'Member search failed');
    } finally {
      setSearching(false);
    }
  };

  const handleVerifyClaimantPan = async () => {
    const cleanPan = (claimantPan || '').trim().toUpperCase();
    if (!cleanPan || !/^[A-Z]{5}\d{4}[A-Z]$/.test(cleanPan)) {
      setError('Enter a valid 10-character PAN');
      return;
    }
    setVerifyingClaimant((prev) => ({ ...prev, pan: true }));
    setError('');
    try {
      const res = await api.verify.pan(cleanPan, true);
      if (res.success || res.status === 'VERIFIED') {
        setClaimantPanVerified(true);
        if (res.data?.name && !claimantName) {
          setClaimantName(res.data.name);
        }
        setSuccess(`✓ Claimant PAN verified: ${res.data?.name || cleanPan}`);
      } else {
        setError(res.message || 'Claimant PAN verification failed');
      }
    } catch (err) {
      setError(err.message || 'PAN verification error');
    } finally {
      setVerifyingClaimant((prev) => ({ ...prev, pan: false }));
    }
  };

  const handleInitiateClaimantOkyc = async () => {
    const cleanAadhaar = (claimantAadhaar || '').replace(/\D/g, '');
    if (cleanAadhaar.length !== 12) {
      setError('Enter a valid 12-digit Aadhaar number');
      return;
    }
    setVerifyingClaimant((prev) => ({ ...prev, aadhaar: true }));
    setError('');
    try {
      const res = await api.verify.initiateOkyc(cleanAadhaar, true);
      if (res.success || res.status === 'OTP_SENT') {
        const sid = res.data?.sessionId || res.sessionId;
        setClaimantOkycSession({ open: true, sessionId: sid, otp: '' });
      } else {
        setError(res.message || 'Failed to initiate Aadhaar verification');
      }
    } catch (err) {
      setError(err.message || 'Aadhaar initiation error');
    } finally {
      setVerifyingClaimant((prev) => ({ ...prev, aadhaar: false }));
    }
  };

  const handleVerifyClaimantOtp = async () => {
    if (!claimantOkycSession.otp || claimantOkycSession.otp.length < 6) {
      setError('Enter 6-digit Aadhaar OTP');
      return;
    }
    setVerifyingClaimant((prev) => ({ ...prev, okycOtp: true }));
    setError('');
    try {
      const res = await api.verify.verifyOkyc({
        sessionId: claimantOkycSession.sessionId,
        otp: claimantOkycSession.otp,
        aadhaarNumber: claimantAadhaar,
      });
      if (res.success || res.status === 'VERIFIED') {
        setClaimantAadhaarVerified(true);
        setClaimantOkycSession({ open: false, sessionId: '', otp: '' });
        if (res.data?.name && !claimantName) {
          setClaimantName(res.data.name);
        }
        setSuccess(`✓ Claimant Aadhaar verified: ${res.data?.name || claimantName}`);
      } else {
        setError(res.message || 'Aadhaar OTP verification failed');
      }
    } catch (err) {
      setError(err.message || 'Aadhaar verification error');
    } finally {
      setVerifyingClaimant((prev) => ({ ...prev, okycOtp: false }));
    }
  };

  // Helper for image upload
  const handleImageFile = async (e, setter) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const b64 = await compressImage(file, { maxWidth: 1000, maxHeight: 1000, quality: 0.8 });
      setter(b64);
    } catch {
      setError('Image compression failed');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedMember) return setError('Please search and select a member first');
    if (!deathDate) return setError('Death date is required');
    if (!deathReason.trim()) return setError('Please provide the death reason');
    if (!deathPhoto1 && !deathPhoto2 && !deathPhoto3) {
      return setError('Please upload at least 1 death photo (up to 3 photos)');
    }
    if (!houseVisitPhoto) return setError('Visit verification photo is required');
    if (!deathCertificate) return setError('Death certificate is required');

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const deathPhotos = [deathPhoto1, deathPhoto2, deathPhoto3].filter(Boolean);
      const res = await api.supervisorApp.submitDeathRequest({
        memberId: selectedMember._id || selectedMember.id,
        targetType,
        guarantorName: targetType === 'guarantor' ? guarantorName : undefined,
        deathDate,
        deathReason: deathReason.trim(),
        deathPhotos,
        houseVisitPhoto,
        deathCertificate,
        claimantName: claimantName.trim(),
        claimantRelation: claimantRelation.trim(),
        claimantAadhaar: claimantAadhaar.trim(),
        claimantPan: claimantPan.trim().toUpperCase(),
        claimantAadhaarVerified,
        claimantPanVerified,
      });

      setSuccess(`Death Settlement Request submitted successfully! Receipt No: ${res.receiptNo}`);
      // Reset form
      setSelectedMember(null);
      setSearchQuery('');
      setDeathReason('');
      setClaimantName('');
      setClaimantRelation('Nominee');
      setClaimantAadhaar('');
      setClaimantPan('');
      setClaimantAadhaarVerified(false);
      setClaimantPanVerified(false);
      setDeathPhoto1('');
      setDeathPhoto2('');
      setDeathPhoto3('');
      setHouseVisitPhoto('');
      setDeathCertificate('');
      setActiveTab('list');
      loadRequests();
    } catch (err) {
      setError(err.message || 'Failed to submit death request');
    } finally {
      setSubmitting(false);
    }
  };

  const loadRequests = async () => {
    setLoadingList(true);
    try {
      const res = await api.supervisorApp.deathRequests();
      setRequests(res?.items || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'list') {
      loadRequests();
    }
  }, [activeTab]);

  return (
    <div className="sup-page-container">
      {/* Header */}
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Death Settlement Request</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>
          Member &amp; Guarantor Death Claim &amp; Settlement Filing
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', background: 'var(--sup-border)', borderRadius: 10, padding: 3, marginBottom: 14 }}>
        <button
          type="button"
          style={{
            flex: 1,
            padding: '8px 0',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.82rem',
            background: activeTab === 'new' ? 'var(--sup-card-bg)' : 'transparent',
            color: activeTab === 'new' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            cursor: 'pointer',
          }}
          onClick={() => setActiveTab('new')}
        >
          New Claim Request
        </button>
        <button
          type="button"
          style={{
            flex: 1,
            padding: '8px 0',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.82rem',
            background: activeTab === 'list' ? 'var(--sup-card-bg)' : 'transparent',
            color: activeTab === 'list' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            cursor: 'pointer',
          }}
          onClick={() => setActiveTab('list')}
        >
          Settlement List ({requests.length})
        </button>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--sup-danger-light)', color: 'var(--sup-danger)', borderRadius: 10, fontSize: '0.85rem', marginBottom: 14 }}>
          <Icon name="alertcircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--sup-success-light)', color: 'var(--sup-success)', borderRadius: 10, fontSize: '0.85rem', marginBottom: 14 }}>
          <Icon name="checkcircle" size={16} />
          <span>{success}</span>
        </div>
      )}

      {activeTab === 'new' ? (
        <div>
          {/* Member Search Card */}
          <div className="sup-card" style={{ marginBottom: 14 }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '0.95rem', fontWeight: 700 }}>
              1. Search Member (Borrower / Client)
            </h4>
            <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                className="sup-input"
                placeholder="Enter Member Code, Mobile or Aadhaar"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="submit" className="sup-btn" style={{ width: 'auto', padding: '0 16px' }} disabled={searching}>
                {searching ? 'Searching…' : 'Search'}
              </button>
            </form>

            {selectedMember && (
              <div style={{ marginTop: 12, padding: 12, background: 'var(--sup-primary-light)', borderRadius: 8, border: '1px solid var(--sup-primary)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <strong style={{ fontSize: '1rem', color: 'var(--sup-primary)' }}>{selectedMember.name}</strong>
                    <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>
                      Code: <strong>{selectedMember.code}</strong> • Mobile: {selectedMember.mobile || '—'}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--sup-text-muted)' }}>
                      Branch: {selectedMember.branch?.name || '—'} • Hub: {selectedMember.center?.name || '—'}
                    </div>
                    {selectedMember.guarantor?.name && (
                      <div style={{ fontSize: '0.78rem', marginTop: 4 }}>
                        Guarantor: <strong>{selectedMember.guarantor.name}</strong> ({selectedMember.guarantor.relation || 'Guarantor'})
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    style={{ background: 'transparent', border: 'none', color: 'var(--sup-danger)', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}
                    onClick={() => setSelectedMember(null)}
                  >
                    Change
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Claim Form */}
          {selectedMember && (
            <div className="sup-card">
              <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: 700 }}>
                2. Death Claim Details &amp; Documents
              </h4>
              <form onSubmit={handleSubmit}>
                {/* Target Type */}
                <div className="sup-input-group">
                  <label className="sup-label">Deceased Person (Who passed away?) *</label>
                  <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="targetType"
                        value="member"
                        checked={targetType === 'member'}
                        onChange={() => setTargetType('member')}
                      />
                      <span>Member ({selectedMember.name})</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="targetType"
                        value="guarantor"
                        checked={targetType === 'guarantor'}
                        onChange={() => setTargetType('guarantor')}
                      />
                      <span>Guarantor ({selectedMember.guarantor?.name || 'Guarantor'})</span>
                    </label>
                  </div>
                </div>

                {targetType === 'guarantor' && (
                  <div className="sup-input-group">
                    <label className="sup-label">Guarantor Name *</label>
                    <input
                      type="text"
                      className="sup-input"
                      value={guarantorName}
                      onChange={(e) => setGuarantorName(e.target.value)}
                      placeholder="Enter deceased guarantor full name"
                      required
                    />
                  </div>
                )}

                {/* Legal Heir / Claimant Verification Section */}
                <div style={{ background: '#f8fafc', border: '1px solid var(--sup-border)', borderRadius: 10, padding: 12, marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <strong style={{ fontSize: '0.85rem', color: 'var(--sup-primary)' }}>
                      Claimant / Nominee Verification (Legal Heir)
                    </strong>
                    <span style={{ fontSize: '0.7rem', color: 'var(--sup-text-muted)' }}>
                      KYC Compliance for Claim Payout
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div>
                      <label className="sup-label">Claimant Full Name *</label>
                      <input
                        type="text"
                        className="sup-input"
                        placeholder="Legal Heir Name"
                        value={claimantName}
                        onChange={(e) => setClaimantName(e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label className="sup-label">Relationship with Deceased</label>
                      <input
                        type="text"
                        className="sup-input"
                        placeholder="e.g. Spouse / Son / Mother"
                        value={claimantRelation}
                        onChange={(e) => setClaimantRelation(e.target.value)}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <label className="sup-label" style={{ margin: 0 }}>Claimant Aadhaar</label>
                        {claimantAadhaarVerified && (
                          <span style={{ fontSize: '0.68rem', color: 'var(--sup-success)', fontWeight: 700 }}>
                            ✓ OKYC Verified
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          type="tel"
                          maxLength={12}
                          className="sup-input"
                          placeholder="12-digit Aadhaar"
                          value={claimantAadhaar}
                          onChange={(e) => {
                            setClaimantAadhaarVerified(false);
                            setClaimantAadhaar(e.target.value.replace(/\D/g, '').slice(0, 12));
                          }}
                          style={{ flex: 1, borderColor: claimantAadhaarVerified ? '#10b981' : undefined }}
                        />
                        <button
                          type="button"
                          className="sup-btn sm"
                          style={{
                            width: 'auto',
                            padding: '4px 8px',
                            fontSize: '0.7rem',
                            whiteSpace: 'nowrap',
                            background: claimantAadhaarVerified ? '#dcfce7' : undefined,
                            color: claimantAadhaarVerified ? '#166534' : undefined,
                            border: claimantAadhaarVerified ? '1px solid #86efac' : undefined,
                          }}
                          disabled={verifyingClaimant.aadhaar || claimantAadhaar.length !== 12}
                          onClick={handleInitiateClaimantOkyc}
                        >
                          {verifyingClaimant.aadhaar ? '…' : claimantAadhaarVerified ? '✓ OKYC' : 'Verify OKYC'}
                        </button>
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <label className="sup-label" style={{ margin: 0 }}>Claimant PAN (Optional)</label>
                        {claimantPanVerified && (
                          <span style={{ fontSize: '0.68rem', color: 'var(--sup-success)', fontWeight: 700 }}>
                            ✓ Verified
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          type="text"
                          maxLength={10}
                          className="sup-input"
                          placeholder="ABCDE1234F"
                          value={claimantPan}
                          onChange={(e) => {
                            setClaimantPanVerified(false);
                            setClaimantPan(e.target.value.toUpperCase());
                          }}
                          style={{ flex: 1, borderColor: claimantPanVerified ? '#10b981' : undefined }}
                        />
                        {claimantPan.length === 10 && (
                          <button
                            type="button"
                            className="sup-btn sm"
                            style={{
                              width: 'auto',
                              padding: '4px 8px',
                              fontSize: '0.7rem',
                              whiteSpace: 'nowrap',
                              background: claimantPanVerified ? '#dcfce7' : undefined,
                              color: claimantPanVerified ? '#166534' : undefined,
                              border: claimantPanVerified ? '1px solid #86efac' : undefined,
                            }}
                            disabled={verifyingClaimant.pan}
                            onClick={handleVerifyClaimantPan}
                          >
                            {verifyingClaimant.pan ? '…' : claimantPanVerified ? '✓ Verified' : 'Verify'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Death Date */}
                <div className="sup-input-group">
                  <label className="sup-label">Date of Death *</label>
                  <input
                    type="date"
                    className="sup-input"
                    value={deathDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setDeathDate(e.target.value)}
                    required
                  />
                </div>

                {/* Death Reason */}
                <div className="sup-input-group">
                  <label className="sup-label">Cause / Reason of Death *</label>
                  <textarea
                    rows={2}
                    className="sup-textarea"
                    value={deathReason}
                    onChange={(e) => setDeathReason(e.target.value)}
                    placeholder="Illness, accident, hospital details, etc."
                    required
                  />
                </div>

                {/* Death Photos (up to 3) */}
                <div className="sup-input-group">
                  <label className="sup-label">Photos of Deceased (Upload 1 to 3 Photos) *</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 4 }}>
                    <div>
                      <input
                        type="file"
                        accept="image/*"
                        id="dPhoto1"
                        style={{ display: 'none' }}
                        onChange={(e) => handleImageFile(e, setDeathPhoto1)}
                      />
                      <label
                        htmlFor="dPhoto1"
                        style={{
                          display: 'block',
                          height: 75,
                          border: '2px dashed var(--sup-border)',
                          borderRadius: 8,
                          textAlign: 'center',
                          padding: 4,
                          cursor: 'pointer',
                          background: deathPhoto1 ? `url(${deathPhoto1}) center/cover no-repeat` : 'var(--sup-bg)',
                        }}
                      >
                        {!deathPhoto1 && <span style={{ fontSize: '0.68rem', color: 'var(--sup-text-muted)' }}>+ Photo 1 *</span>}
                      </label>
                      {deathPhoto1 && (
                        <button
                          type="button"
                          style={{ fontSize: '0.68rem', color: '#ef4444', border: 'none', background: 'none', cursor: 'pointer', marginTop: 2 }}
                          onClick={() => setDeathPhoto1('')}
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    <div>
                      <input
                        type="file"
                        accept="image/*"
                        id="dPhoto2"
                        style={{ display: 'none' }}
                        onChange={(e) => handleImageFile(e, setDeathPhoto2)}
                      />
                      <label
                        htmlFor="dPhoto2"
                        style={{
                          display: 'block',
                          height: 75,
                          border: '2px dashed var(--sup-border)',
                          borderRadius: 8,
                          textAlign: 'center',
                          padding: 4,
                          cursor: 'pointer',
                          background: deathPhoto2 ? `url(${deathPhoto2}) center/cover no-repeat` : 'var(--sup-bg)',
                        }}
                      >
                        {!deathPhoto2 && <span style={{ fontSize: '0.68rem', color: 'var(--sup-text-muted)' }}>+ Photo 2</span>}
                      </label>
                      {deathPhoto2 && (
                        <button
                          type="button"
                          style={{ fontSize: '0.68rem', color: '#ef4444', border: 'none', background: 'none', cursor: 'pointer', marginTop: 2 }}
                          onClick={() => setDeathPhoto2('')}
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    <div>
                      <input
                        type="file"
                        accept="image/*"
                        id="dPhoto3"
                        style={{ display: 'none' }}
                        onChange={(e) => handleImageFile(e, setDeathPhoto3)}
                      />
                      <label
                        htmlFor="dPhoto3"
                        style={{
                          display: 'block',
                          height: 75,
                          border: '2px dashed var(--sup-border)',
                          borderRadius: 8,
                          textAlign: 'center',
                          padding: 4,
                          cursor: 'pointer',
                          background: deathPhoto3 ? `url(${deathPhoto3}) center/cover no-repeat` : 'var(--sup-bg)',
                        }}
                      >
                        {!deathPhoto3 && <span style={{ fontSize: '0.68rem', color: 'var(--sup-text-muted)' }}>+ Photo 3</span>}
                      </label>
                      {deathPhoto3 && (
                        <button
                          type="button"
                          style={{ fontSize: '0.68rem', color: '#ef4444', border: 'none', background: 'none', cursor: 'pointer', marginTop: 2 }}
                          onClick={() => setDeathPhoto3('')}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* House Visit Photo */}
                <div className="sup-input-group">
                  <label className="sup-label">Verification / House Visit Photo *</label>
                  <input
                    type="file"
                    accept="image/*"
                    className="sup-input"
                    onChange={(e) => handleImageFile(e, setHouseVisitPhoto)}
                  />
                  {houseVisitPhoto && (
                    <div style={{ position: 'relative', marginTop: 6, display: 'inline-block' }}>
                      <img src={houseVisitPhoto} alt="Visit Verification" style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 6 }} />
                      <button
                        type="button"
                        style={{ position: 'absolute', top: -5, right: -5, background: '#ef4444', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: 11 }}
                        onClick={() => setHouseVisitPhoto('')}
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>

                {/* Death Certificate */}
                <div className="sup-input-group">
                  <label className="sup-label">Death Certificate / Doctor Slips *</label>
                  <input
                    type="file"
                    accept="image/*"
                    className="sup-input"
                    onChange={(e) => handleImageFile(e, setDeathCertificate)}
                  />
                  {deathCertificate && (
                    <div style={{ position: 'relative', marginTop: 6, display: 'inline-block' }}>
                      <img src={deathCertificate} alt="Death Certificate" style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 6 }} />
                      <button
                        type="button"
                        style={{ position: 'absolute', top: -5, right: -5, background: '#ef4444', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: 11 }}
                        onClick={() => setDeathCertificate('')}
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>

                <button type="submit" className="sup-btn" style={{ marginTop: 10 }} disabled={submitting}>
                  {submitting ? 'Submitting Death Request…' : 'Submit Death Claim Request'}
                </button>
              </form>
            </div>
          )}
        </div>
      ) : (
        /* Requests List Tab */
        <div>
          {loadingList ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
              Loading settlement requests…
            </div>
          ) : requests.length === 0 ? (
            <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
              No death settlement requests filed under your supervised branches
            </div>
          ) : (
            requests.map((r) => {
              const isApproved = r.status === 'approved';
              const isRejected = r.status === 'rejected';
              return (
                <div key={r._id || r.id} className="sup-card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <strong style={{ fontSize: '0.95rem' }}>{r.receiptNo || 'DRQ'}</strong>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, marginTop: 2 }}>
                        {r.memberName} ({r.memberCode})
                      </div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--sup-text-muted)' }}>
                        Target: <strong style={{ textTransform: 'capitalize' }}>{r.targetType}</strong>
                        {r.targetType === 'guarantor' && r.guarantorName ? ` (${r.guarantorName})` : ''}
                      </div>
                    </div>
                    <span
                      style={{
                        background: isApproved ? 'var(--sup-success-light)' : isRejected ? 'var(--sup-danger-light)' : 'var(--sup-warning-light)',
                        color: isApproved ? 'var(--sup-success)' : isRejected ? 'var(--sup-danger)' : 'var(--sup-warning)',
                        padding: '2px 8px',
                        borderRadius: 10,
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                      }}
                    >
                      {r.status || 'Pending'}
                    </span>
                  </div>

                  <div style={{ marginTop: 8, fontSize: '0.8rem', padding: '8px 10px', background: 'var(--sup-bg)', borderRadius: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ color: 'var(--sup-text-muted)' }}>Date of Death:</span>
                      <strong>{r.deathDateStr || (r.deathDate ? new Date(r.deathDate).toLocaleDateString() : '—')}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ color: 'var(--sup-text-muted)' }}>Cause:</span>
                      <span>{r.deathReason || '—'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--sup-text-muted)' }}>Requested On:</span>
                      <span>{r.requestDateStr || (r.requestDate ? new Date(r.requestDate).toLocaleDateString() : '—')}</span>
                    </div>
                  </div>

                  {/* Thumbnail Previews */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, overflowX: 'auto', paddingBottom: 4 }}>
                    {(r.deathPhotos || []).map((img, idx) => (
                      <a key={idx} href={img} target="_blank" rel="noreferrer">
                        <img src={img} alt={`Deceased ${idx}`} style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--sup-border)' }} />
                      </a>
                    ))}
                    {r.houseVisitPhoto && (
                      <a href={r.houseVisitPhoto} target="_blank" rel="noreferrer">
                        <img src={r.houseVisitPhoto} alt="House Visit" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--sup-border)' }} />
                      </a>
                    )}
                    {r.deathCertificate && (
                      <a href={r.deathCertificate} target="_blank" rel="noreferrer">
                        <img src={r.deathCertificate} alt="Death Cert" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--sup-border)' }} />
                      </a>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Claimant Aadhaar OKYC OTP Modal */}
      {claimantOkycSession.open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 14,
              padding: '20px 18px',
              maxWidth: 380,
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
            }}
          >
            <h4 style={{ margin: '0 0 6px 0', fontSize: '1rem', fontWeight: 800, color: 'var(--sup-text)' }}>
              Verify Claimant Aadhaar OTP (CGPey OKYC)
            </h4>
            <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 14px 0' }}>
              Enter the 6-digit OTP sent to the mobile linked with Aadhaar <strong>XXXX XXXX {claimantAadhaar.slice(-4)}</strong>.
            </p>
            <input
              type="text"
              placeholder="Enter 6-digit OTP"
              value={claimantOkycSession.otp}
              onChange={(e) => setClaimantOkycSession((prev) => ({ ...prev, otp: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
              maxLength={6}
              style={{
                width: '100%',
                fontSize: '1.25rem',
                textAlign: 'center',
                letterSpacing: '4px',
                padding: '10px',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                boxSizing: 'border-box',
                outline: 'none',
              }}
              autoFocus
            />
            <span style={{ display: 'block', fontSize: '0.72rem', color: '#94a3b8', textAlign: 'center', marginTop: 4 }}>
              (Dev bypass OTP: 123456)
            </span>
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button
                type="button"
                className="sup-btn secondary"
                style={{ flex: 1, padding: 10, fontSize: '0.84rem' }}
                onClick={() => setClaimantOkycSession({ open: false, sessionId: '', otp: '' })}
                disabled={verifyingClaimant.okycOtp}
              >
                Cancel
              </button>
              <button
                type="button"
                className="sup-btn primary"
                style={{ flex: 1, padding: 10, fontSize: '0.84rem' }}
                onClick={handleVerifyClaimantOtp}
                disabled={verifyingClaimant.okycOtp || claimantOkycSession.otp.length < 6}
              >
                {verifyingClaimant.okycOtp ? 'Verifying…' : 'Submit OTP'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
