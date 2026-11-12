import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import { compressImage } from '../../../utils/image.js';
import Icon from '../../../components/Icon.jsx';

export default function EmployeeMemberKyc() {
  const { t } = useEmployeeApp();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [member, setMember] = useState(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [recentMembers, setRecentMembers] = useState([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [filterTab, setFilterTab] = useState('all'); // 'all' | 'rejected' | 'pending' | 'verified' (Point 22)
  const [listSearch, setListSearch] = useState('');

  // Re-upload state
  const [reuploadingDoc, setReuploadingDoc] = useState(null);
  const [reuploadBusy, setReuploadBusy] = useState(false);

  // Reject doc modal/prompt state
  const [rejectingDoc, setRejectingDoc] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectBusy, setRejectBusy] = useState(false);

  // Phone Change OTP state
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [newMobile, setNewMobile] = useState('');
  const [phoneStep, setPhoneStep] = useState(1); // 1: input phone, 2: enter otp
  const [phoneOtp, setPhoneOtp] = useState('');
  const [phoneDevOtp, setPhoneDevOtp] = useState('');
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneError, setPhoneError] = useState('');

  // Image preview modal
  const [previewImage, setPreviewImage] = useState(null);

  const fetchRecent = async () => {
    setLoadingRecent(true);
    try {
      const res = await api.employeeApp.recentMembers();
      setRecentMembers(res.items || []);
    } catch {
      setRecentMembers([]);
    } finally {
      setLoadingRecent(false);
    }
  };

  useEffect(() => {
    fetchRecent();
    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get('code');
    if (codeParam) {
      setQuery(codeParam);
      loadMemberKyc(codeParam);
    }
  }, []);

  const loadMemberKyc = async (codeOrId) => {
    const q = String(codeOrId || '').trim();
    if (!q) return;
    setLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const data = await api.employeeApp.memberKyc(q);
      setMember(data.member || data);
    } catch (err) {
      setError(err.message || 'Member KYC not found');
      setMember(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    e?.preventDefault();
    loadMemberKyc(query);
  };

  const handleReupload = async (docType, file) => {
    if (!file || !member) return;
    setReuploadBusy(true);
    setError('');
    setSuccessMsg('');
    try {
      const fileData = await compressImage(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.8 });
      await api.employeeApp.reuploadDoc(member.id || member._id || member.code, {
        docType,
        docField: docType,
        fileData,
      });
      setSuccessMsg(`Document (${docType}) uploaded/updated successfully! Status set to Pending Review.`);
      setReuploadingDoc(null);
      loadMemberKyc(member.code || member.id || member._id);
      fetchRecent();
    } catch (err) {
      setError(err.message || 'Failed to upload document');
    } finally {
      setReuploadBusy(false);
    }
  };

  const handleRejectDoc = async (e) => {
    e?.preventDefault();
    if (!rejectingDoc || !member) return;
    setRejectBusy(true);
    setError('');
    try {
      await api.employeeApp.rejectDoc(member.id || member._id || member.code, {
        docType: rejectingDoc.type,
        docField: rejectingDoc.field || rejectingDoc.type,
        reason: rejectReason.trim() || 'Document illegible or rejected by reviewer',
      });
      setSuccessMsg(`Document (${rejectingDoc.name || rejectingDoc.type}) marked as Rejected. Re-upload is now enabled.`);
      setRejectingDoc(null);
      setRejectReason('');
      loadMemberKyc(member.code || member.id || member._id);
      fetchRecent();
    } catch (err) {
      setError(err.message || 'Failed to reject document');
    } finally {
      setRejectBusy(false);
    }
  };

  const handleSendPhoneOtp = async (e) => {
    e?.preventDefault();
    if (!/^\d{10}$/.test(newMobile.trim())) {
      setPhoneError('Please enter a valid 10-digit mobile number');
      return;
    }
    setPhoneBusy(true);
    setPhoneError('');
    try {
      const res = await api.employeeApp.sendPhoneChangeOtp(member.id || member._id || member.code, {
        newMobile: newMobile.trim(),
      });
      if (res.devOtp) setPhoneDevOtp(res.devOtp);
      setPhoneStep(2);
    } catch (err) {
      setPhoneError(err.message || 'Failed to send OTP to new number');
    } finally {
      setPhoneBusy(false);
    }
  };

  const handleVerifyPhoneOtp = async (e) => {
    e?.preventDefault();
    if (!/^\d{6}$/.test(phoneOtp.trim())) {
      setPhoneError('Enter the 6-digit OTP');
      return;
    }
    setPhoneBusy(true);
    setPhoneError('');
    try {
      await api.employeeApp.verifyPhoneChange(member.id || member._id || member.code, {
        newMobile: newMobile.trim(),
        otp: phoneOtp.trim(),
      });
      setSuccessMsg(`Mobile number successfully updated to +91 ${newMobile.trim()}!`);
      setShowPhoneModal(false);
      setPhoneStep(1);
      setNewMobile('');
      setPhoneOtp('');
      loadMemberKyc(member.code || member.id || member._id);
      fetchRecent();
    } catch (err) {
      setPhoneError(err.message || 'Invalid OTP');
    } finally {
      setPhoneBusy(false);
    }
  };

  return (
    <div className="emp-page-container">
      {/* Search Header */}
      <div className="emp-card">
        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 12px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="kyc" size={20} style={{ color: 'var(--emp-primary)' }} /> {t('memberKyc')}
        </h2>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10 }}>
          <input
            type="text"
            className="emp-input"
            placeholder="Enter Member Code, Phone, or ID..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="submit" className="emp-btn-primary" style={{ padding: '0 16px' }} disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '12px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 12 }}>
          {error}
        </div>
      )}

      {successMsg && (
        <div style={{ background: '#dcfce7', color: '#166534', padding: '12px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 12 }}>
          {successMsg}
        </div>
      )}

      {/* When no member selected, show list of members with tab filters (Point 22 & Item 9 Fix) */}
      {!member && (() => {
        const rejectedMembers = recentMembers.filter((m) => m.kycRejected || m.kycStatus === 'rejected' || m.documents?.some((d) => d.status === 'rejected'));
        const missingMembers = recentMembers.filter((m) => !m.kycRejected && m.kycStatus !== 'rejected' && (m.isMissing || m.kycStatus === 'missing' || (m.missingCount && m.missingCount > 0)));
        const pendingMembers = recentMembers.filter((m) => !m.kycRejected && !m.isMissing && m.kycStatus !== 'missing' && (m.kycPending || m.kycStatus === 'pending'));
        const verifiedMembers = recentMembers.filter((m) => !m.kycRejected && !m.isMissing && !m.kycPending && (m.isVerified || m.kycStatus === 'verified'));

        const displayedMembers = filterTab === 'rejected'
          ? rejectedMembers
          : filterTab === 'missing'
          ? missingMembers
          : filterTab === 'pending'
          ? pendingMembers
          : filterTab === 'verified'
          ? verifiedMembers
          : recentMembers;

        const searchedMembers = listSearch.trim()
          ? displayedMembers.filter((m) =>
              (m.name || '').toLowerCase().includes(listSearch.toLowerCase()) ||
              (m.code || '').toLowerCase().includes(listSearch.toLowerCase()) ||
              (m.mobile || '').includes(listSearch)
            )
          : displayedMembers;

        return (
          <div className="emp-card">
            {/* Filter Tabs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, marginBottom: 10 }}>
              {[
                { id: 'all', label: `All (${recentMembers.length})`, color: 'var(--emp-text)' },
                { id: 'rejected', label: `⚠️ Rejected (${rejectedMembers.length})`, color: '#dc2626', bg: '#fee2e2' },
                { id: 'missing', label: `⚠️ Missing (${missingMembers.length})`, color: '#b45309', bg: '#fef3c7' },
                { id: 'pending', label: `⏳ Pending (${pendingMembers.length})`, color: '#d97706', bg: '#fffbeb' },
                { id: 'verified', label: `✓ Verified (${verifiedMembers.length})`, color: '#16a34a', bg: '#dcfce7' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterTab(tab.id)}
                  style={{
                    padding: '8px 2px',
                    fontSize: '0.68rem',
                    fontWeight: filterTab === tab.id ? 800 : 600,
                    borderRadius: 6,
                    border: filterTab === tab.id ? `2px solid ${tab.color}` : '1px solid var(--emp-border)',
                    background: filterTab === tab.id ? (tab.bg || 'var(--emp-primary-soft, #eef2ff)') : 'var(--emp-card-bg)',
                    color: filterTab === tab.id ? tab.color : 'var(--emp-text-muted)',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    textAlign: 'center',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Quick List Search Bar */}
            <div style={{ marginBottom: 12 }}>
              <input
                type="text"
                className="emp-input"
                style={{ fontSize: '0.82rem', padding: '6px 10px' }}
                placeholder="Filter by member name, code, or phone number..."
                value={listSearch}
                onChange={(e) => setListSearch(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ fontSize: '0.92rem', fontWeight: 700, margin: 0, color: 'var(--emp-text)' }}>
                {filterTab === 'rejected'
                  ? 'Rejected KYC Members (Re-Upload Required)'
                  : filterTab === 'missing'
                  ? 'Incomplete / Missing Documents'
                  : filterTab === 'pending'
                  ? 'Pending Verification'
                  : filterTab === 'verified'
                  ? 'Verified KYC Members'
                  : 'Branch Members'} ({searchedMembers.length})
              </h3>
              <span style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Tap member to view/re-upload</span>
            </div>

            {loadingRecent ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--emp-text-muted)' }}>Loading members...</div>
            ) : searchedMembers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--emp-text-muted)', fontSize: '0.85rem' }}>
                {listSearch.trim()
                  ? `No members match "${listSearch}" in this filter.`
                  : filterTab === 'rejected'
                  ? '✓ No rejected KYC members found.'
                  : filterTab === 'missing'
                  ? '✓ No members with missing documents.'
                  : 'No members found in this tab. Search above to check any member.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {searchedMembers.map((m) => {
                  const isRej = Boolean(m.kycRejected || m.kycStatus === 'rejected');
                  const isMiss = Boolean(!isRej && (m.isMissing || m.kycStatus === 'missing' || (m.missingCount && m.missingCount > 0)));
                  const isPend = Boolean(!isRej && !isMiss && (m.kycPending || m.kycStatus === 'pending'));

                  return (
                    <div
                      key={m.id || m.code}
                      onClick={() => {
                        setQuery(m.code);
                        loadMemberKyc(m.code);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: isRej ? '1.5px solid #f87171' : isMiss ? '1.5px solid #f59e0b' : '1px solid var(--emp-border)',
                        cursor: 'pointer',
                        background: isRej ? '#fef2f2' : isMiss ? '#fffbeb' : 'var(--emp-card-bg)',
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: '0.9rem', color: isRej ? '#991b1b' : isMiss ? '#92400e' : 'var(--emp-text)', display: 'block' }}>
                          {m.name}
                        </strong>
                        <span style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)' }}>
                          Code: {m.code} • {m.mobile}
                        </span>
                      </div>
                      <div>
                        {isRej ? (
                          <span className="emp-badge emp-badge-danger" style={{ fontSize: '0.72rem', fontWeight: 800 }}>⚠️ Rejected • Tap to Re-Upload</span>
                        ) : isMiss ? (
                          <span className="emp-badge emp-badge-warning" style={{ fontSize: '0.72rem', fontWeight: 800, background: '#fef3c7', color: '#b45309', border: '1px solid #f59e0b' }}>
                            ⚠️ {m.missingCount ? `${m.missingCount} Missing Docs` : 'Incomplete Docs'}
                          </span>
                        ) : isPend ? (
                          <span className="emp-badge emp-badge-warning" style={{ fontSize: '0.72rem' }}>⏳ Pending</span>
                        ) : (
                          <span className="emp-badge emp-badge-success" style={{ fontSize: '0.72rem' }}>✓ Verified</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {member && (
        <>
          <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              type="button"
              className="emp-btn-secondary"
              style={{ padding: '6px 12px', fontSize: '0.8rem' }}
              onClick={() => { setMember(null); setQuery(''); }}
            >
              ← Back to Members
            </button>
            <span style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)' }}>
              KYC Document Audit & Verification
            </span>
          </div>

          {/* Member Profile Overview Card */}
          <div className="emp-card">
            {/* Point 5: Mandatory Phone OTP Banner */}
            {!member.mobileVerified && (
              <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="alerttriangle" size={18} />
                  <span><strong>Mandatory:</strong> Member phone number must be verified via OTP!</span>
                </div>
                <button
                  type="button"
                  className="emp-btn-primary"
                  style={{ padding: '4px 10px', fontSize: '0.75rem', background: '#dc2626' }}
                  onClick={() => {
                    setPhoneStep(1);
                    setNewMobile(member.mobile || '');
                    setPhoneOtp('');
                    setPhoneError('');
                    setPhoneDevOtp('');
                    setShowPhoneModal(true);
                  }}
                >
                  Verify Phone Now
                </button>
              </div>
            )}

            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: 'var(--emp-primary)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.3rem',
                  fontWeight: 700,
                  overflow: 'hidden',
                }}
              >
                {member.photo || member.memberPhoto ? (
                  <img src={member.photo || member.memberPhoto} alt={member.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  member.name?.charAt(0) || 'M'
                )}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: 'var(--emp-text)' }}>
                    {member.name}
                  </h3>
                  {member.mobileVerified && (
                    <span className="emp-verified-badge" title="Phone verified via OTP">
                      ✓
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                  Code: <strong>{member.code}</strong> • Branch: {member.branchName || (typeof member.branch === 'object' ? (member.branch?.name || member.branch?.code) : member.branch)}
                </div>
              </div>
            </div>

            {/* Verification Status Pills */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--emp-border)' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)' }}>Mobile Number</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{member.mobile}</span>
                  {member.mobileVerified ? (
                    <span className="emp-verified-badge" style={{ fontSize: '0.75rem', padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Icon name="checkcircle" size={12} /> Verified
                    </span>
                  ) : (
                    <span className="emp-badge emp-badge-warning" style={{ fontSize: '0.75rem' }}>Unverified</span>
                  )}
                </div>
                {/* Point 5: Once verified, phone number change is strictly blocked! */}
                <div style={{ marginTop: 6 }}>
                  {member.mobileVerified ? (
                    <span style={{ fontSize: '0.72rem', color: '#166534', background: '#dcfce7', padding: '3px 8px', borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700 }}>
                      <Icon name="lock" size={12} /> Number Verified &amp; Locked
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="emp-btn-primary"
                      style={{ fontSize: '0.72rem', padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: 4, background: '#dc2626' }}
                      onClick={() => {
                        setPhoneStep(1);
                        setNewMobile(member.mobile || '');
                        setPhoneOtp('');
                        setPhoneError('');
                        setPhoneDevOtp('');
                        setShowPhoneModal(true);
                      }}
                    >
                      <Icon name="phone" size={12} /> Verify Number (OTP Required)
                    </button>
                  )}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)' }}>Aadhaar Number</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{member.aadhaar ? `•••• •••• ${String(member.aadhaar).slice(-4)}` : 'N/A'}</span>
                  {member.aadhaarVerified ? (
                    <span className="emp-verified-badge" style={{ fontSize: '0.75rem', padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Icon name="checkcircle" size={12} /> Verified
                    </span>
                  ) : (
                    <span className="emp-badge emp-badge-warning" style={{ fontSize: '0.75rem' }}>Pending</span>
                  )}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--emp-text-muted)', marginTop: 4 }}>
                  KYC Status: <strong style={{ color: member.overallKycStatus === 'rejected' || member.kycRejected ? '#dc2626' : (member.overallKycStatus === 'missing' || member.missingCount > 0) ? '#d97706' : member.overallKycStatus === 'pending' || member.kycPending ? '#2563eb' : '#16a34a' }}>
                    {member.overallKycLabel || (member.kycRejected ? '⚠️ Rejected' : (member.missingCount > 0 ? `⚠️ Incomplete (${member.missingCount} Missing)` : member.kycPending ? '⏳ Pending Review' : '✓ Verified'))}
                  </strong>
                </div>
              </div>
            </div>

            {/* Incomplete / Missing Documents Alert Banner (Item 9 Fix) */}
            {(member.missingCount > 0 || member.overallKycStatus === 'missing') && (
              <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: '#fffbeb', border: '1.5px solid #f59e0b', color: '#92400e', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="alerttriangle" size={18} style={{ color: '#d97706', flexShrink: 0 }} />
                <div>
                  <strong>Mandatory Documents Missing:</strong> Member has {member.missingCount || 1} required document(s) missing.
                  <div style={{ fontSize: '0.72rem', marginTop: 2, color: '#b45309' }}>
                    Status is marked <strong>Incomplete</strong>. Member will NOT be verified until all mandatory documents are uploaded and approved.
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Documents Section */}
          <div className="emp-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--emp-text)' }}>
                KYC Documents (5 Standard Docs)
              </h3>
              <span style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>
                Upload enabled for missing / rejected (approved docs locked)
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {member.documents?.map((doc) => {
                const isRejected = doc.status === 'rejected';
                const isApproved = doc.status === 'approved';
                const isMissing = doc.status === 'missing' || !doc.image;
                const isPending = !isApproved && !isRejected && !isMissing;
                const docFieldKey = doc.field || doc.type;

                return (
                  <div
                    key={doc.type}
                    style={{
                      border: '1px solid var(--emp-border)',
                      borderRadius: 10,
                      padding: 12,
                      background: isRejected ? '#fef2f2' : isApproved ? '#f0fdf4' : isMissing ? '#fffbeb' : 'var(--emp-card-bg)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        {doc.image ? (
                          <img
                            src={doc.image}
                            alt={doc.name}
                            onClick={() => setPreviewImage(doc.image)}
                            style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--emp-border)', cursor: 'pointer' }}
                            title="Click to view full photo"
                          />
                        ) : (
                          <div
                            style={{
                              width: 48,
                              height: 48,
                              borderRadius: 6,
                              background: '#e2e8f0',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '0.7rem',
                              color: '#64748b',
                              textAlign: 'center',
                            }}
                          >
                            No Doc
                          </div>
                        )}
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--emp-text)' }}>
                            {doc.name || doc.type}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                            {doc.uploadedAt ? `Uploaded: ${new Date(doc.uploadedAt).toLocaleDateString()}` : 'Not yet uploaded'}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                        {isApproved && (
                          <span className="emp-badge emp-badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem' }}>
                            <Icon name="checkcircle" size={11} /> Approved
                          </span>
                        )}
                        {isRejected && (
                          <span className="emp-badge emp-badge-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem' }}>
                            <Icon name="cross" size={11} /> Rejected
                          </span>
                        )}
                        {isMissing && (
                          <span className="emp-badge emp-badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem' }}>
                            <Icon name="alerttriangle" size={11} /> Missing
                          </span>
                        )}
                        {isPending && (
                          <span className="emp-badge emp-badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem' }}>
                            <Icon name="clock" size={11} /> Pending
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Rejection reason banner */}
                    {isRejected && (
                      <div style={{ marginTop: 8, padding: '6px 10px', background: '#fee2e2', borderRadius: 6, fontSize: '0.78rem', color: '#991b1b' }}>
                        <strong>Rejection Reason:</strong> {doc.rejectReason || 'Document illegible or mismatched details.'}
                      </div>
                    )}

                    {/* Action buttons: Reject KYC Doc & Upload / Re-Upload */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--emp-border)', flexWrap: 'wrap' }}>
                      <input
                        type="file"
                        id={`file-${doc.type}`}
                        accept="image/*,.pdf"
                        style={{ display: 'none' }}
                        onChange={(e) => handleReupload(docFieldKey, e.target.files?.[0])}
                      />

                      {/* Point 5: If approved, upload option is locked and hidden */}
                      {isApproved ? (
                        <span style={{ fontSize: '0.78rem', color: '#166534', background: '#dcfce7', padding: '6px 12px', borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                          <Icon name="checkcircle" size={13} /> ✓ Document Approved (Upload Locked)
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={isRejected ? 'emp-btn-primary' : 'emp-btn-secondary'}
                            style={{
                              padding: '6px 12px',
                              fontSize: '0.78rem',
                              background: isRejected ? '#dc2626' : undefined,
                              color: isRejected ? '#fff' : undefined,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                            onClick={() => document.getElementById(`file-${doc.type}`).click()}
                            disabled={reuploadBusy}
                          >
                            <Icon name="upload" size={13} />
                            {reuploadBusy
                              ? 'Uploading...'
                              : isRejected
                              ? 'Re-Upload Document'
                              : isMissing
                              ? 'Upload Missing Doc'
                              : 'Update / Re-Upload Doc'}
                          </button>

                          {!isRejected && (
                            <button
                              type="button"
                              className="emp-btn-secondary"
                              style={{
                                padding: '6px 12px',
                                fontSize: '0.78rem',
                                color: '#dc2626',
                                borderColor: '#fca5a5',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                              }}
                              onClick={() => {
                                setRejectingDoc(doc);
                                setRejectReason('');
                              }}
                            >
                              <Icon name="cross" size={12} /> Reject KYC
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Reject Doc Reason Modal */}
      {rejectingDoc && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, maxWidth: 420, width: '100%', boxShadow: '0 8px 30px rgba(0,0,0,0.2)' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, margin: '0 0 8px 0', color: '#991b1b', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="alerttriangle" size={20} /> Reject {rejectingDoc.name || rejectingDoc.type}
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--emp-text-muted)', margin: '0 0 14px 0' }}>
              Rejecting this document will notify the member and enable the re-upload option.
            </p>

            <form onSubmit={handleRejectDoc} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Reason for Rejection *
                </label>
                <textarea
                  className="emp-input"
                  rows="3"
                  placeholder="e.g. Photo blur, Name mismatch, Expired document..."
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  className="emp-btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => { setRejectingDoc(null); setRejectReason(''); }}
                  disabled={rejectBusy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="emp-btn-primary"
                  style={{ flex: 1, background: '#dc2626' }}
                  disabled={rejectBusy || !rejectReason.trim()}
                >
                  {rejectBusy ? 'Rejecting...' : 'Confirm Reject'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Mobile Number Change OTP Modal */}
      {showPhoneModal && member && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, maxWidth: 420, width: '100%', boxShadow: '0 8px 30px rgba(0,0,0,0.2)' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, margin: '0 0 8px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="phone" size={18} style={{ color: 'var(--emp-primary)' }} /> Change Mobile Number (OTP)
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--emp-text-muted)', margin: '0 0 14px 0' }}>
              Current Number: <strong>+91 {member.mobile}</strong>
            </p>

            {phoneError && (
              <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 6, fontSize: '0.82rem', marginBottom: 12 }}>
                {phoneError}
              </div>
            )}

            {phoneDevOtp && (
              <div style={{ background: '#fef3c7', color: '#92400e', padding: '8px 12px', borderRadius: 6, fontSize: '0.82rem', marginBottom: 12, border: '1px dashed #f59e0b' }}>
                Dev OTP: <strong>{phoneDevOtp}</strong>
              </div>
            )}

            {phoneStep === 1 ? (
              <form onSubmit={handleSendPhoneOtp} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    New Mobile Number (10 Digits) *
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 10, top: 9, fontSize: '0.9rem', color: 'var(--emp-text-muted)', fontWeight: 600 }}>+91</span>
                    <input
                      type="tel"
                      className="emp-input"
                      style={{ paddingLeft: 46 }}
                      placeholder="9876543210"
                      maxLength="10"
                      value={newMobile}
                      onChange={(e) => setNewMobile(e.target.value.replace(/\D/g, ''))}
                      required
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button
                    type="button"
                    className="emp-btn-secondary"
                    style={{ flex: 1 }}
                    onClick={() => setShowPhoneModal(false)}
                    disabled={phoneBusy}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="emp-btn-primary"
                    style={{ flex: 1 }}
                    disabled={phoneBusy || newMobile.length !== 10}
                  >
                    {phoneBusy ? 'Sending OTP...' : 'Send OTP'}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleVerifyPhoneOtp} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Enter 6-Digit OTP sent to +91 {newMobile}
                  </label>
                  <input
                    type="text"
                    className="emp-input"
                    style={{ textAlign: 'center', fontSize: '1.2rem', letterSpacing: '4px', fontWeight: 700 }}
                    maxLength="6"
                    placeholder="••••••"
                    value={phoneOtp}
                    onChange={(e) => setPhoneOtp(e.target.value.replace(/\D/g, ''))}
                    required
                  />
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button
                    type="button"
                    className="emp-btn-secondary"
                    style={{ flex: 1 }}
                    onClick={() => setPhoneStep(1)}
                    disabled={phoneBusy}
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    className="emp-btn-primary"
                    style={{ flex: 1 }}
                    disabled={phoneBusy || phoneOtp.length !== 6}
                  >
                    {phoneBusy ? 'Verifying...' : 'Verify & Update'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
            <img src={previewImage} alt="Document Preview" style={{ maxWidth: '100%', maxHeight: '85vh', objectFit: 'contain', borderRadius: 8 }} />
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              style={{ position: 'absolute', top: -36, right: 0, background: 'transparent', border: 'none', color: '#fff', fontSize: '1.2rem', cursor: 'pointer' }}
            >
              ✕ Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
