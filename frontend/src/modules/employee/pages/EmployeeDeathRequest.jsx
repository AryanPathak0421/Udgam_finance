import { useState, useEffect, useRef } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';
import { compressImage } from '../../../utils/image.js';

export default function EmployeeDeathRequest() {
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

  // 1 Staff house visit photo
  const [houseVisitPhoto, setHouseVisitPhoto] = useState('');

  // 1 Death certificate
  const [deathCertificate, setDeathCertificate] = useState('');

  // In-app Live Camera state (prevents Android WebView / PWA crash on photo click - Point 22)
  const [showCamera, setShowCamera] = useState(false);
  const [facingMode, setFacingMode] = useState('environment');
  const [stream, setStream] = useState(null);
  const videoRef = useRef(null);
  const hvpInputRef = useRef(null);

  const startLiveCamera = async (mode = facingMode) => {
    try {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      setStream(s);
      setShowCamera(true);
    } catch {
      // Fallback: If camera access fails, use safe file picker without forcing aggressive OS capture intent
      hvpInputRef.current?.click();
    }
  };

  const stopLiveCamera = () => {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
    setShowCamera(false);
  };

  const captureLivePhoto = () => {
    if (!videoRef.current) return;
    try {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const b64 = canvas.toDataURL('image/jpeg', 0.8);
      stopLiveCamera();
      setHouseVisitPhoto(b64);
    } catch {
      alert('Capture failed. Please select photo.');
      stopLiveCamera();
      hvpInputRef.current?.click();
    }
  };

  const switchCamera = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
    startLiveCamera(nextMode);
  };

  useEffect(() => {
    if (showCamera && stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
    return () => {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [showCamera, stream]);

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
      const res = await api.employeeApp.memberSynopsis(searchQuery.trim());
      if (res && res.member) {
        setSelectedMember(res.member);
        setGuarantorName(res.member.guarantor?.name || '');
      } else {
        setError('No member found with this code or mobile number.');
      }
    } catch (err) {
      setError(err.message || 'Member search failed');
    } finally {
      setSearching(false);
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
      alert('Image compression failed');
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
    if (!houseVisitPhoto) return setError('Staff house visit photo is required');
    if (!deathCertificate) return setError('Death certificate is required');

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const deathPhotos = [deathPhoto1, deathPhoto2, deathPhoto3].filter(Boolean);
      const res = await api.employeeApp.submitDeathRequest({
        memberId: selectedMember._id || selectedMember.id,
        targetType,
        guarantorName: targetType === 'guarantor' ? guarantorName : undefined,
        deathDate,
        deathReason: deathReason.trim(),
        deathPhotos,
        houseVisitPhoto,
        deathCertificate,
      });

      setSuccess(`Death Request submitted successfully! Receipt No: ${res.receiptNo}`);
      // Reset form
      setSelectedMember(null);
      setDeathReason('');
      setDeathPhoto1('');
      setDeathPhoto2('');
      setDeathPhoto3('');
      setHouseVisitPhoto('');
      setDeathCertificate('');
      fetchRequests();
    } catch (err) {
      setError(err.message || 'Failed to submit death request');
    } finally {
      setSubmitting(false);
    }
  };

  const fetchRequests = async () => {
    setLoadingList(true);
    try {
      const res = await api.employeeApp.deathRequests();
      setRequests(res.items || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'list') {
      fetchRequests();
    }
  }, [activeTab]);

  return (
    <div className="emp-page-container">
      {/* Header Banner */}
      <div className="emp-card" style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 6px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="file-text" size={22} style={{ color: 'var(--emp-primary)' }} />
          <span>Death Request Process</span>
        </h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', margin: 0 }}>
          Submit death claim request with mandatory 3 death photos, staff house visit photo, and death certificate for administrative review.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button
          type="button"
          className={activeTab === 'new' ? 'emp-btn-primary' : 'emp-btn-secondary'}
          style={{ flex: 1, padding: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          onClick={() => setActiveTab('new')}
        >
          <Icon name="plus-circle" size={16} />
          <span>New Death Request</span>
        </button>
        <button
          type="button"
          className={activeTab === 'list' ? 'emp-btn-primary' : 'emp-btn-secondary'}
          style={{ flex: 1, padding: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          onClick={() => setActiveTab('list')}
        >
          <Icon name="list" size={16} />
          <span>Submitted Requests</span>
        </button>
      </div>

      {activeTab === 'new' && (
        <>
          {/* Member Search */}
          <div className="emp-card" style={{ marginBottom: 14 }}>
            <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 6 }}>
              Select / Search Member *
            </label>
            <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder="Enter Member Code or Mobile..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="emp-input"
                style={{ flex: 1 }}
              />
              <button type="submit" className="emp-btn-primary" disabled={searching} style={{ padding: '0 16px' }}>
                {searching ? 'Searching...' : 'Search'}
              </button>
            </form>

            {selectedMember && (
              <div style={{ marginTop: 12, padding: 12, background: 'var(--emp-card-bg)', border: '1px solid var(--emp-border)', borderRadius: 8 }}>
                <div style={{ fontWeight: 800, color: 'var(--emp-text)', fontSize: '0.95rem' }}>{selectedMember.name}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                  Member Code: {selectedMember.code} • Mobile: {selectedMember.mobile || '—'}
                </div>
                {selectedMember.guarantor?.name && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                    Guarantor on Record: <strong>{selectedMember.guarantor.name}</strong> ({selectedMember.guarantor.relation || 'Relation'})
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Form */}
          <div className="emp-card">
            {error && (
              <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 12 }}>
                {error}
              </div>
            )}
            {success && (
              <div style={{ background: '#dcfce7', color: '#166534', padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 12 }}>
                {success}
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Target Type Selector */}
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 6 }}>
                  Deceased Person * (मृत व्यक्ति चुनें)
                </label>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      padding: '12px',
                      fontSize: '0.88rem',
                      fontWeight: 800,
                      borderRadius: 8,
                      border: targetType === 'member' ? '2px solid #ef4444' : '1px solid #cbd5e1',
                      background: targetType === 'member' ? '#fee2e2' : '#f8fafc',
                      color: targetType === 'member' ? '#991b1b' : '#64748b',
                      boxShadow: targetType === 'member' ? '0 0 0 3px rgba(239, 68, 68, 0.25)' : 'none',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onClick={() => setTargetType('member')}
                  >
                    {targetType === 'member' ? '✓ ' : ''}Member (कर्जदार)
                  </button>
                  <button
                    type="button"
                    style={{
                      flex: 1,
                      padding: '12px',
                      fontSize: '0.88rem',
                      fontWeight: 800,
                      borderRadius: 8,
                      border: targetType === 'guarantor' ? '2px solid #8b5cf6' : '1px solid #cbd5e1',
                      background: targetType === 'guarantor' ? '#ede9fe' : '#f8fafc',
                      color: targetType === 'guarantor' ? '#5b21b6' : '#64748b',
                      boxShadow: targetType === 'guarantor' ? '0 0 0 3px rgba(139, 92, 246, 0.25)' : 'none',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onClick={() => setTargetType('guarantor')}
                  >
                    {targetType === 'guarantor' ? '✓ ' : ''}Guarantor (जमानतदार)
                  </button>
                </div>

                {/* Highlighted Selected Deceased Person Banner (Point 20) */}
                <div style={{
                  marginTop: 12,
                  padding: '12px 16px',
                  borderRadius: 10,
                  background: targetType === 'member' ? '#fef2f2' : '#f5f3ff',
                  border: targetType === 'member' ? '2px solid #ef4444' : '2px solid #8b5cf6',
                  boxShadow: targetType === 'member' ? '0 2px 8px rgba(239, 68, 68, 0.15)' : '0 2px 8px rgba(139, 92, 246, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}>
                  <div style={{
                    width: 42,
                    height: 42,
                    borderRadius: '50%',
                    background: targetType === 'member' ? '#fee2e2' : '#ede9fe',
                    color: targetType === 'member' ? '#dc2626' : '#7c3aed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 900,
                    fontSize: '1.1rem',
                    border: targetType === 'member' ? '2px solid #dc2626' : '2px solid #7c3aed',
                    flexShrink: 0,
                  }}>
                    {targetType === 'member' ? 'M' : 'G'}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.92rem', fontWeight: 800, color: targetType === 'member' ? '#991b1b' : '#5b21b6' }}>
                      Selected Deceased: {targetType === 'member' ? `Member (Borrower) — ${selectedMember?.name || 'Selected'} (${selectedMember?.code || 'Member'})` : `Guarantor (जमानतदार) — ${guarantorName || selectedMember?.guarantor?.name || 'Guarantor'}`}
                    </div>
                    <div style={{ fontSize: '0.76rem', color: targetType === 'member' ? '#b91c1c' : '#6d28d9', marginTop: 2, fontWeight: 600 }}>
                      {targetType === 'member'
                        ? '⚠️ Death settlement request will be registered directly in Dead Settlement (मृत्यु सेटलमेंट) section for Admin closure.'
                        : '⚠️ Guarantor demise will be officially recorded in software Guarantor Deaths section.'}
                    </div>
                  </div>
                  <span style={{
                    background: targetType === 'member' ? '#dc2626' : '#7c3aed',
                    color: '#fff',
                    padding: '3px 8px',
                    borderRadius: 6,
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                  }}>
                    {targetType === 'member' ? 'Deceased Member' : 'Deceased Guarantor'}
                  </span>
                </div>
              </div>

              {targetType === 'guarantor' && (
                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                    Guarantor Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={guarantorName}
                    onChange={(e) => setGuarantorName(e.target.value)}
                    placeholder="Enter Guarantor full name"
                    className="emp-input"
                    style={{ width: '100%' }}
                  />
                </div>
              )}

              {/* Dates */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                    Request Date (Non-editable)
                  </label>
                  <input
                    type="text"
                    disabled
                    value={new Date().toISOString().slice(0, 10)}
                    className="emp-input"
                    style={{ width: '100%', background: '#f1f5f9', cursor: 'not-allowed', color: '#64748b' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                    Death Date * (Editable)
                  </label>
                  <input
                    type="date"
                    required
                    value={deathDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setDeathDate(e.target.value)}
                    className="emp-input"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              {/* Death Reason */}
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                  Death Reason / Cause *
                </label>
                <textarea
                  required
                  rows={2}
                  value={deathReason}
                  onChange={(e) => setDeathReason(e.target.value)}
                  placeholder="Explain cause of death and verification notes..."
                  className="emp-input"
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>

              {/* 3 Death Photos */}
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                  Upload Death Photos (Up to 3 Photos) *
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  {/* Photo 1 */}
                  <div>
                    <input type="file" accept="image/*" id="dp1" style={{ display: 'none' }} onChange={(e) => handleImageFile(e, setDeathPhoto1)} />
                    <button
                      type="button"
                      className="emp-btn-secondary"
                      style={{ width: '100%', padding: '10px 4px', fontSize: '0.72rem', border: '1px dashed var(--emp-primary)' }}
                      onClick={() => document.getElementById('dp1').click()}
                    >
                      {deathPhoto1 ? '✓ Photo 1 Added' : '+ Death Photo 1'}
                    </button>
                    {deathPhoto1 && <img src={deathPhoto1} alt="DP1" style={{ width: '100%', height: 60, objectFit: 'cover', borderRadius: 4, marginTop: 4 }} />}
                  </div>

                  {/* Photo 2 */}
                  <div>
                    <input type="file" accept="image/*" id="dp2" style={{ display: 'none' }} onChange={(e) => handleImageFile(e, setDeathPhoto2)} />
                    <button
                      type="button"
                      className="emp-btn-secondary"
                      style={{ width: '100%', padding: '10px 4px', fontSize: '0.72rem', border: '1px dashed var(--emp-primary)' }}
                      onClick={() => document.getElementById('dp2').click()}
                    >
                      {deathPhoto2 ? '✓ Photo 2 Added' : '+ Death Photo 2'}
                    </button>
                    {deathPhoto2 && <img src={deathPhoto2} alt="DP2" style={{ width: '100%', height: 60, objectFit: 'cover', borderRadius: 4, marginTop: 4 }} />}
                  </div>

                  {/* Photo 3 */}
                  <div>
                    <input type="file" accept="image/*" id="dp3" style={{ display: 'none' }} onChange={(e) => handleImageFile(e, setDeathPhoto3)} />
                    <button
                      type="button"
                      className="emp-btn-secondary"
                      style={{ width: '100%', padding: '10px 4px', fontSize: '0.72rem', border: '1px dashed var(--emp-primary)' }}
                      onClick={() => document.getElementById('dp3').click()}
                    >
                      {deathPhoto3 ? '✓ Photo 3 Added' : '+ Death Photo 3'}
                    </button>
                    {deathPhoto3 && <img src={deathPhoto3} alt="DP3" style={{ width: '100%', height: 60, objectFit: 'cover', borderRadius: 4, marginTop: 4 }} />}
                  </div>
                </div>
              </div>

              {/* 1 Staff House Visit Photo (In-app Live Camera Modal to prevent mobile WebView crash - Point 22) */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--emp-text)' }}>
                    Staff House Visit Photo *
                  </label>
                  <span style={{ fontSize: '0.72rem', background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
                    Live Verification
                  </span>
                </div>
                <input
                  ref={hvpInputRef}
                  type="file"
                  accept="image/*"
                  id="hvp"
                  style={{ display: 'none' }}
                  onChange={(e) => handleImageFile(e, setHouseVisitPhoto)}
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button
                    type="button"
                    className="emp-btn-primary"
                    style={{
                      padding: '12px 8px',
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                    onClick={() => startLiveCamera('environment')}
                  >
                    <Icon name="camera" size={16} />
                    <span>{houseVisitPhoto ? 'Retake via Camera' : 'Live Camera'}</span>
                  </button>
                  <button
                    type="button"
                    className="emp-btn-secondary"
                    style={{
                      padding: '12px 8px',
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                    onClick={() => hvpInputRef.current?.click()}
                  >
                    <Icon name="upload" size={16} />
                    <span>Upload File</span>
                  </button>
                </div>
                {houseVisitPhoto && (
                  <div style={{ marginTop: 8, textAlign: 'center' }}>
                    <img src={houseVisitPhoto} alt="Visit Photo" style={{ width: '100%', maxHeight: 150, objectFit: 'cover', borderRadius: 8, border: '2px solid #059669' }} />
                    <div style={{ fontSize: '0.72rem', color: '#059669', fontWeight: 700, marginTop: 4 }}>
                      ✓ House Visit Photo Captured
                    </div>
                  </div>
                )}
              </div>

              {/* In-App Live Camera Modal for House Visit (Point 22) */}
              {showCamera && (
                <div
                  style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 9999,
                    background: 'rgba(0,0,0,0.92)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    padding: 16,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff' }}>
                    <strong style={{ fontSize: '1rem' }}>Staff House Visit Live Camera</strong>
                    <button
                      type="button"
                      onClick={stopLiveCamera}
                      style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '1.4rem', cursor: 'pointer' }}
                    >
                      ✕
                    </button>
                  </div>

                  <div style={{ position: 'relative', width: '100%', maxHeight: '65vh', borderRadius: 12, overflow: 'hidden', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      style={{ width: '100%', maxHeight: '65vh', objectFit: 'cover' }}
                    />
                    <div style={{ position: 'absolute', bottom: 10, left: 10, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '4px 8px', borderRadius: 4, fontSize: '0.72rem' }}>
                      House Visit Verification · {new Date().toLocaleTimeString()}
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', paddingBottom: 20 }}>
                    <button
                      type="button"
                      onClick={switchCamera}
                      style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', borderRadius: '50%', width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      title="Flip camera"
                    >
                      <Icon name="refresh" size={20} />
                    </button>
                    <button
                      type="button"
                      onClick={captureLivePhoto}
                      style={{
                        width: 68,
                        height: 68,
                        borderRadius: '50%',
                        background: '#fff',
                        border: '4px solid #10b981',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <div style={{ width: 50, height: 50, borderRadius: '50%', background: '#10b981' }} />
                    </button>
                    <button
                      type="button"
                      onClick={stopLiveCamera}
                      style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 12px', fontSize: '0.8rem' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Death Certificate */}
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                  Death Certificate *
                </label>
                <input type="file" accept="image/*" id="dc" style={{ display: 'none' }} onChange={(e) => handleImageFile(e, setDeathCertificate)} />
                <button
                  type="button"
                  className="emp-btn-secondary"
                  style={{ width: '100%', padding: '12px', border: '1px dashed var(--emp-primary)', color: 'var(--emp-primary)', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  onClick={() => document.getElementById('dc').click()}
                >
                  <Icon name="upload" size={18} />
                  <span>{deathCertificate ? '✓ Death Certificate Uploaded (Click to change)' : 'Upload Death Certificate'}</span>
                </button>
                {deathCertificate && (
                  <div style={{ marginTop: 8, textAlign: 'center' }}>
                    <img src={deathCertificate} alt="Certificate" style={{ width: '100%', maxHeight: 150, objectFit: 'contain', borderRadius: 8, background: '#000' }} />
                  </div>
                )}
              </div>

              <button
                type="submit"
                className="emp-btn-primary"
                style={{ padding: '14px', fontSize: '1rem', fontWeight: 800, marginTop: 4 }}
                disabled={submitting}
              >
                {submitting ? 'Submitting Death Request...' : 'Submit Death Request'}
              </button>
            </form>
          </div>
        </>
      )}

      {/* List Tab */}
      {activeTab === 'list' && (
        <div className="emp-card">
          <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 12px 0', color: 'var(--emp-text)' }}>
            Death Requests ({requests.length})
          </h3>
          {loadingList ? (
            <p style={{ fontSize: '0.85rem', color: 'var(--emp-text-muted)' }}>Loading requests...</p>
          ) : requests.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--emp-text-muted)', fontSize: '0.85rem' }}>
              No death requests submitted yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {requests.map((r) => (
                <div key={r._id || r.id} style={{ padding: 12, border: '1px solid var(--emp-border)', borderRadius: 8, background: 'var(--emp-card-bg)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--emp-text)' }}>{r.receiptNo}</div>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: 12,
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        textTransform: 'uppercase',
                        background: r.status === 'approved' ? '#dcfce7' : r.status === 'rejected' ? '#fee2e2' : '#fef3c7',
                        color: r.status === 'approved' ? '#166534' : r.status === 'rejected' ? '#991b1b' : '#92400e',
                      }}
                    >
                      {r.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--emp-text)', marginTop: 4 }}>
                    <strong>{r.memberName}</strong> ({r.memberCode}) • Deceased: {r.targetType === 'guarantor' ? `Guarantor (${r.guarantorName || '—'})` : 'Member'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                    Death Date: {r.deathDateStr} • Request Date: {r.requestDateStr}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                    Reason: {r.deathReason}
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
