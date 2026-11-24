import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function MemberKyc() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Live Digital Verification State (CGPey)
  const [aadhaarInput, setAadhaarInput] = useState('');
  const [panInput, setPanInput] = useState('');
  const [aadhaarVerified, setAadhaarVerified] = useState(false);
  const [panVerified, setPanVerified] = useState(false);
  const [verifying, setVerifying] = useState({ pan: false, aadhaar: false, okycOtp: false });
  const [okycSession, setOkycSession] = useState({ open: false, sessionId: '', otp: '' });

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
      const rep = res?.kycReport || {};
      if (rep.rawAadhaar) setAadhaarInput(rep.rawAadhaar);
      if (rep.rawPan) setPanInput(rep.rawPan);
      if (rep.aadhaarVerified) setAadhaarVerified(true);
      if (rep.panVerified) setPanVerified(true);
    } catch (err) {
      setError(err.message || 'Failed to load KYC verification report');
    } finally {
      setLoading(false);
    }
  }

  const handleVerifyPan = async () => {
    const cleanPan = (panInput || '').trim().toUpperCase();
    if (!cleanPan || !/^[A-Z]{5}\d{4}[A-Z]$/.test(cleanPan)) {
      setError('Please enter a valid 10-character PAN (e.g. ABCDE1234F)');
      return;
    }
    setVerifying((prev) => ({ ...prev, pan: true }));
    setError('');
    try {
      const res = await api.verify.pan(cleanPan, false);
      if (res.success || res.status === 'VERIFIED') {
        setPanVerified(true);
        setSuccessMsg(`✓ PAN verified with CGPey: ${res.data?.name || cleanPan}`);
      } else {
        setError(res.message || 'PAN verification failed');
      }
    } catch (err) {
      setError(err.message || 'PAN verification error');
    } finally {
      setVerifying((prev) => ({ ...prev, pan: false }));
    }
  };

  const handleInitiateAadhaarOkyc = async () => {
    const cleanAadhaar = (aadhaarInput || '').replace(/\D/g, '');
    if (cleanAadhaar.length !== 12) {
      setError('Please enter a valid 12-digit Aadhaar number');
      return;
    }
    setVerifying((prev) => ({ ...prev, aadhaar: true }));
    setError('');
    try {
      const res = await api.verify.initiateOkyc(cleanAadhaar, false);
      if (res.success || res.status === 'OTP_SENT') {
        const sid = res.data?.sessionId || res.sessionId;
        setOkycSession({ open: true, sessionId: sid, otp: '' });
        setSuccessMsg('Aadhaar OTP sent to your UIDAI registered mobile number');
      } else {
        setError(res.message || 'Failed to initiate Aadhaar verification');
      }
    } catch (err) {
      setError(err.message || 'Aadhaar initiation error');
    } finally {
      setVerifying((prev) => ({ ...prev, aadhaar: false }));
    }
  };

  const handleVerifyAadhaarOtp = async () => {
    if (!okycSession.otp || okycSession.otp.length < 6) {
      setError('Enter 6-digit Aadhaar OTP');
      return;
    }
    setVerifying((prev) => ({ ...prev, okycOtp: true }));
    setError('');
    try {
      const res = await api.verify.verifyOkyc({
        sessionId: okycSession.sessionId,
        otp: okycSession.otp,
        aadhaarNumber: aadhaarInput,
      });
      if (res.success || res.status === 'VERIFIED') {
        setAadhaarVerified(true);
        setOkycSession({ open: false, sessionId: '', otp: '' });
        setSuccessMsg(`✓ Aadhaar OKYC successfully verified: ${res.data?.name || 'Approved'}`);
        await loadKyc();
      } else {
        setError(res.message || 'Aadhaar OTP verification failed');
      }
    } catch (err) {
      setError(err.message || 'Aadhaar verification error');
    } finally {
      setVerifying((prev) => ({ ...prev, okycOtp: false }));
    }
  };

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

      {/* Instant Digital Verification (CGPey OKYC & PAN) */}
      <div className="mem-card" style={{ borderTop: '4px solid #059669', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <strong style={{ fontSize: '0.98rem', color: '#065f46' }}>Instant Self-Verification (UIDAI &amp; NSDL)</strong>
            <div style={{ fontSize: '0.74rem', color: 'var(--mem-text-muted)' }}>
              Verify instantly using OTP — no branch visit or physical paper needed
            </div>
          </div>
          <span style={{ fontSize: '0.7rem', background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: 12, fontWeight: 700 }}>
            Automated
          </span>
        </div>

        {/* Aadhaar OKYC Block */}
        <div style={{ background: '#f8fafc', border: '1px solid var(--mem-border)', borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--mem-text)' }}>
              1. Aadhaar Card (UIDAI OKYC)
            </span>
            {aadhaarVerified && (
              <span style={{ fontSize: '0.72rem', color: '#166534', fontWeight: 800 }}>
                ✓ UIDAI Verified
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="tel"
              maxLength={12}
              className="mem-input"
              placeholder="Enter 12-digit Aadhaar Number"
              value={aadhaarInput}
              onChange={(e) => {
                setAadhaarVerified(false);
                setAadhaarInput(e.target.value.replace(/\D/g, '').slice(0, 12));
              }}
              style={{ flex: 1, borderColor: aadhaarVerified ? '#10b981' : undefined }}
            />
            <button
              type="button"
              className="mem-btn sm"
              style={{
                width: 'auto',
                padding: '6px 12px',
                fontSize: '0.76rem',
                whiteSpace: 'nowrap',
                background: aadhaarVerified ? '#dcfce7' : undefined,
                color: aadhaarVerified ? '#166534' : undefined,
                border: aadhaarVerified ? '1px solid #86efac' : undefined,
              }}
              disabled={verifying.aadhaar || aadhaarInput.length !== 12}
              onClick={handleInitiateAadhaarOkyc}
            >
              {verifying.aadhaar ? 'Sending OTP…' : aadhaarVerified ? '✓ OKYC Done' : 'Verify with OTP'}
            </button>
          </div>
        </div>

        {/* PAN Card Block */}
        <div style={{ background: '#f8fafc', border: '1px solid var(--mem-border)', borderRadius: 10, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--mem-text)' }}>
              2. PAN Card (NSDL Registry)
            </span>
            {panVerified && (
              <span style={{ fontSize: '0.72rem', color: '#166534', fontWeight: 800 }}>
                ✓ Active &amp; Verified
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              maxLength={10}
              className="mem-input"
              placeholder="e.g. ABCDE1234F"
              value={panInput}
              onChange={(e) => {
                setPanVerified(false);
                setPanInput(e.target.value.toUpperCase());
              }}
              style={{ flex: 1, borderColor: panVerified ? '#10b981' : undefined }}
            />
            <button
              type="button"
              className="mem-btn sm"
              style={{
                width: 'auto',
                padding: '6px 12px',
                fontSize: '0.76rem',
                whiteSpace: 'nowrap',
                background: panVerified ? '#dcfce7' : undefined,
                color: panVerified ? '#166534' : undefined,
                border: panVerified ? '1px solid #86efac' : undefined,
              }}
              disabled={verifying.pan || panInput.length !== 10}
              onClick={handleVerifyPan}
            >
              {verifying.pan ? 'Verifying…' : panVerified ? '✓ Verified' : 'Verify PAN'}
            </button>
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

      {/* Aadhaar OKYC OTP Modal */}
      {okycSession.open && (
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
            <h4 style={{ margin: '0 0 6px 0', fontSize: '1rem', fontWeight: 800, color: 'var(--mem-text)' }}>
              Verify Aadhaar OTP (CGPey OKYC)
            </h4>
            <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 14px 0' }}>
              Enter the 6-digit OTP sent to your Aadhaar-linked mobile <strong>XXXX XXXX {aadhaarInput.slice(-4)}</strong>.
            </p>
            <input
              type="text"
              placeholder="Enter 6-digit OTP"
              value={okycSession.otp}
              onChange={(e) => setOkycSession((prev) => ({ ...prev, otp: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
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
                className="mem-btn sm secondary"
                style={{ flex: 1, padding: 10, fontSize: '0.84rem' }}
                onClick={() => setOkycSession({ open: false, sessionId: '', otp: '' })}
                disabled={verifying.okycOtp}
              >
                Cancel
              </button>
              <button
                type="button"
                className="mem-btn sm"
                style={{ flex: 1, padding: 10, fontSize: '0.84rem' }}
                onClick={handleVerifyAadhaarOtp}
                disabled={verifying.okycOtp || okycSession.otp.length < 6}
              >
                {verifying.okycOtp ? 'Verifying…' : 'Submit OTP'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

