import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function MemberKyc() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Upload modal/form state
  const [showUpload, setShowUpload] = useState(false);
  const [docType, setDocType] = useState('aadhaar');
  const [docNumber, setDocNumber] = useState('');
  const [docFileUrl, setDocFileUrl] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    loadKyc();
  }, []);

  async function loadKyc() {
    setLoading(true);
    setError('');
    try {
      const res = await api.memberApp.kycReport();
      setData(res);
    } catch (err) {
      setError(err.message || 'Failed to load KYC verification report');
    } finally {
      setLoading(false);
    }
  }

  async function handleReupload(e) {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!docNumber.trim() && !docFileUrl.trim()) {
      setError('Please provide document number or uploaded file link');
      return;
    }

    setUploading(true);
    try {
      const res = await api.memberApp.reuploadKycDoc({
        docType,
        docNumber: docNumber.trim(),
        docFileUrl: docFileUrl.trim(),
      });
      setSuccessMsg(res.message || 'KYC document submitted for verification successfully!');
      setShowUpload(false);
      setDocNumber('');
      setDocFileUrl('');
      await loadKyc();
    } catch (err) {
      setError(err.message || 'Failed to upload document');
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--mem-text-muted)' }}>
        <Icon name="loader" size={26} className="spin" />
        <p style={{ marginTop: 8, fontSize: '0.85rem' }}>Loading KYC verification report…</p>
      </div>
    );
  }

  const overall = data?.overallStatus || 'pending';
  const docs = data?.documents || [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0 }}>KYC Status & Report</h2>
        <span
          className={`mem-badge ${overall === 'approved' ? 'completed' : overall === 'rejected' ? 'rejected' : 'pending'}`}
        >
          {overall.toUpperCase()}
        </span>
      </div>

      {error && (
        <div className="mem-alert danger">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="mem-alert success">
          <Icon name="checkcircle" size={16} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Overall KYC Banner */}
      <div
        className="mem-card"
        style={{
          background:
            overall === 'approved'
              ? 'linear-gradient(135deg, #ecfdf5, #d1fae5)'
              : overall === 'rejected'
              ? 'linear-gradient(135deg, #fee2e2, #fecaca)'
              : 'linear-gradient(135deg, #fffbeb, #fef3c7)',
          borderLeft: `5px solid ${overall === 'approved' ? '#10b981' : overall === 'rejected' ? '#ef4444' : '#f59e0b'}`,
          borderColor: overall === 'approved' ? '#a7f3d0' : overall === 'rejected' ? '#fca5a5' : '#fde68a',
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon
            name={overall === 'approved' ? 'checkcircle' : 'alert'}
            size={24}
            style={{ color: overall === 'approved' ? '#059669' : overall === 'rejected' ? '#dc2626' : '#d97706' }}
          />
          <div>
            <div style={{ fontWeight: 800, fontSize: '0.96rem', color: overall === 'approved' ? '#065f46' : overall === 'rejected' ? '#991b1b' : '#92400e' }}>
              {overall === 'approved'
                ? 'KYC Fully Verified & Active'
                : overall === 'rejected'
                ? 'KYC Rejected - Action Required'
                : 'KYC Verification Pending'}
            </div>
            <div style={{ fontSize: '0.76rem', color: overall === 'approved' ? '#047857' : overall === 'rejected' ? '#b91c1c' : '#b45309', marginTop: 2 }}>
              {overall === 'approved'
                ? 'All mandatory identity and address documents have been approved by branch.'
                : overall === 'rejected'
                ? 'One or more documents require re-upload due to verification issues.'
                : 'Your documents are currently being verified by the operations team.'}
            </div>
          </div>
        </div>
      </div>

      {/* Re-upload Action Form */}
      <div style={{ marginBottom: 16 }}>
        {!showUpload ? (
          <button
            type="button"
            className="mem-btn"
            onClick={() => setShowUpload(true)}
            style={{ background: 'linear-gradient(135deg, #059669, #047857)' }}
          >
            <Icon name="plus" size={18} />
            <span>Submit / Update KYC Document</span>
          </button>
        ) : (
          <div className="mem-card" style={{ borderTop: '4px solid var(--mem-primary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontWeight: 800, fontSize: '0.96rem' }}>Re-upload KYC Document</span>
              <button
                type="button"
                className="mem-btn sm secondary"
                style={{ width: 'auto', padding: '2px 8px', fontSize: '0.72rem' }}
                onClick={() => setShowUpload(false)}
              >
                Cancel
              </button>
            </div>

            <form onSubmit={handleReupload}>
              <div className="mem-input-group">
                <label className="mem-label">Document Type *</label>
                <select
                  className="mem-select"
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                >
                  <option value="aadhaar">Aadhaar Card</option>
                  <option value="pan">PAN Card</option>
                  <option value="photo">Passport Photograph</option>
                  <option value="signature">Specimen Signature</option>
                  <option value="bank_passbook">Bank Passbook / Cheque</option>
                </select>
              </div>

              <div className="mem-input-group">
                <label className="mem-label">Document / ID Number (Optional)</label>
                <input
                  type="text"
                  className="mem-input"
                  placeholder="e.g. Aadhaar 12-digit or PAN 10-char"
                  value={docNumber}
                  onChange={(e) => setDocNumber(e.target.value)}
                />
              </div>

              <div className="mem-input-group">
                <label className="mem-label">Document Image / URL *</label>
                <input
                  type="text"
                  className="mem-input"
                  placeholder="Document image URL or upload link"
                  value={docFileUrl}
                  onChange={(e) => setDocFileUrl(e.target.value)}
                  required
                />
                <span style={{ fontSize: '0.7rem', color: 'var(--mem-text-muted)', marginTop: 4, display: 'block' }}>
                  Paste a direct link or photo reference of your original ID document.
                </span>
              </div>

              <button type="submit" className="mem-btn" disabled={uploading}>
                {uploading ? 'Submitting Document…' : 'Submit for Verification'}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Document verification status list */}
      <div className="mem-card">
        <div className="mem-card-title">
          <span>Verification Checklist ({docs.length})</span>
        </div>

        <div>
          {docs.map((d, idx) => {
            const st = d.status?.toLowerCase() || 'pending';
            const badgeClass = st === 'approved' ? 'completed' : st === 'rejected' ? 'rejected' : 'pending';
            return (
              <div
                key={idx}
                style={{
                  padding: '12px 0',
                  borderBottom: idx !== docs.length - 1 ? '1px solid var(--mem-border)' : 'none',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>{d.title}</div>
                    {d.docNumber && (
                      <div style={{ fontSize: '0.74rem', color: 'var(--mem-text-muted)', fontFamily: 'monospace' }}>
                        ID: {d.docNumber}
                      </div>
                    )}
                  </div>
                  <span className={`mem-badge ${badgeClass}`} style={{ textTransform: 'capitalize' }}>
                    {d.status || 'Pending'}
                  </span>
                </div>

                {d.reason && (
                  <div
                    style={{
                      background: '#fee2e2',
                      borderLeft: '3px solid #ef4444',
                      padding: '6px 10px',
                      borderRadius: 6,
                      fontSize: '0.74rem',
                      color: '#991b1b',
                      marginTop: 6,
                    }}
                  >
                    <strong>Reason for Rejection:</strong> {d.reason}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
