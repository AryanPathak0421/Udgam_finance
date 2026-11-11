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
      });

      setSuccess(`Death Settlement Request submitted successfully! Receipt No: ${res.receiptNo}`);
      // Reset form
      setSelectedMember(null);
      setSearchQuery('');
      setDeathReason('');
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
    </div>
  );
}
