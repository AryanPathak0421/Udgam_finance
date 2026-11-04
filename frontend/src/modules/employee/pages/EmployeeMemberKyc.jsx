import { useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import { compressImage } from '../../../utils/image.js';

export default function EmployeeMemberKyc() {
  const { t } = useEmployeeApp();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [member, setMember] = useState(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Re-upload state
  const [reuploadingDoc, setReuploadingDoc] = useState(null);
  const [reuploadBusy, setReuploadBusy] = useState(false);

  const handleSearch = async (e) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const data = await api.employeeApp.memberKyc(query.trim());
      setMember(data);
    } catch (err) {
      setError(err.message || 'Member KYC not found');
      setMember(null);
    } finally {
      setLoading(false);
    }
  };

  const handleReupload = async (docType, file) => {
    if (!file || !member) return;
    setReuploadBusy(true);
    setError('');
    setSuccessMsg('');
    try {
      const fileData = await compressImage(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.8 });
      await api.employeeApp.reuploadDoc(member.id || member._id, {
        docType,
        fileData,
      });
      setSuccessMsg(`Document (${docType}) re-uploaded successfully! Status changed to Pending Review.`);
      setReuploadingDoc(null);
      // Refresh kyc
      handleSearch();
    } catch (err) {
      setError(err.message || 'Failed to re-upload document');
    } finally {
      setReuploadBusy(false);
    }
  };

  return (
    <div className="emp-page-container">
      {/* Search Header */}
      <div className="emp-card">
        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 12px 0', color: 'var(--emp-text)' }}>
          🔍 {t('memberKyc')}
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
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '12px 14px', borderRadius: 8, fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {successMsg && (
        <div style={{ background: '#dcfce7', color: '#166534', padding: '12px 14px', borderRadius: 8, fontSize: '0.85rem' }}>
          {successMsg}
        </div>
      )}

      {member && (
        <>
          {/* Member Profile Overview Card */}
          <div className="emp-card">
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
                {member.photo ? (
                  <img src={member.photo} alt={member.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
                  Code: <strong>{member.code}</strong> • Branch: {member.branchName || member.branch}
                </div>
              </div>
            </div>

            {/* Verification Status Pills */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--emp-border)' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)' }}>Mobile Number</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{member.mobile}</span>
                  {member.mobileVerified ? (
                    <span className="emp-verified-badge" style={{ fontSize: '0.75rem', padding: '2px 6px' }}>
                      ✓ Verified
                    </span>
                  ) : (
                    <span className="emp-badge emp-badge-warning" style={{ fontSize: '0.75rem' }}>Unverified</span>
                  )}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                  {member.mobileVerified ? '🔒 Locked (Admin only edit)' : 'Verification pending'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)' }}>Aadhaar Number</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{member.aadhaar ? `•••• •••• ${member.aadhaar.slice(-4)}` : 'N/A'}</span>
                  {member.aadhaarVerified ? (
                    <span className="emp-verified-badge" style={{ fontSize: '0.75rem', padding: '2px 6px' }}>
                      ✓ Verified
                    </span>
                  ) : (
                    <span className="emp-badge emp-badge-warning" style={{ fontSize: '0.75rem' }}>Pending</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Documents Section */}
          <div className="emp-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--emp-text)' }}>
                KYC Documents Status
              </h3>
              <div
                style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                title="Documents pending review for over 7 days are subject to automatic rejection."
              >
                <span>ℹ️ 7-Day Policy</span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {member.documents?.map((doc) => {
                const isRejected = doc.status === 'rejected';
                const isApproved = doc.status === 'approved';

                return (
                  <div
                    key={doc.type}
                    style={{
                      border: '1px solid var(--emp-border)',
                      borderRadius: 10,
                      padding: 12,
                      background: isRejected ? '#fef2f2' : isApproved ? '#f0fdf4' : 'var(--emp-card-bg)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', textTransform: 'capitalize' }}>
                          {doc.name || doc.type.replace(/_/g, ' ')}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                          Uploaded: {doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString() : 'N/A'}
                        </div>
                      </div>

                      <div>
                        {isApproved && <span className="emp-badge emp-badge-success">✓ Approved</span>}
                        {isRejected && <span className="emp-badge emp-badge-danger">✕ Rejected</span>}
                        {!isApproved && !isRejected && <span className="emp-badge emp-badge-warning">⏳ Pending</span>}
                      </div>
                    </div>

                    {/* Rejection reason & Re-upload action */}
                    {isRejected && (
                      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed #fca5a5' }}>
                        <div style={{ fontSize: '0.78rem', color: '#991b1b', marginBottom: 8 }}>
                          <strong>Reason:</strong> {doc.rejectReason || 'Document illegible or mismatched details.'}
                        </div>

                        <div>
                          <input
                            type="file"
                            id={`file-${doc.type}`}
                            accept="image/*,.pdf"
                            style={{ display: 'none' }}
                            onChange={(e) => handleReupload(doc.type, e.target.files?.[0])}
                          />
                          <button
                            type="button"
                            className="emp-btn-primary"
                            style={{ padding: '6px 14px', fontSize: '0.8rem', background: '#dc2626' }}
                            onClick={() => document.getElementById(`file-${doc.type}`).click()}
                            disabled={reuploadBusy}
                          >
                            {reuploadBusy ? 'Uploading...' : '🔄 Re-Upload Document'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

