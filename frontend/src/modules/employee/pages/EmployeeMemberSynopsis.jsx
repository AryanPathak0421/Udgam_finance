import { useState, useEffect, useCallback } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';
import { downloadMemberPdf } from '../../../utils/memberPdf.js';
import { compressImage } from '../../../utils/image.js';

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');
const fmtTime = (d) => (d ? new Date(d).toLocaleString('en-IN') : '—');
const inr = (n) => (n === null || n === undefined ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

const TONE = { pending: '#d97706', approved: '#059669', verified: '#059669', rejected: '#dc2626', missing: '#ea580c', incomplete: '#ea580c' };
const BG_TONE = { pending: '#fef3c7', approved: '#dcfce7', verified: '#dcfce7', rejected: '#fee2e2', missing: '#ffedd5', incomplete: '#ffedd5' };
const LABEL = { pending: 'Pending', approved: 'Approved', verified: 'Approved', rejected: 'Rejected', missing: 'Incomplete / Missing', incomplete: 'Incomplete' };

function Section({ title, count, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="emp-card" style={{ padding: 14, marginBottom: 12 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          userSelect: 'none',
          paddingBottom: open ? 10 : 0,
          borderBottom: open ? '1px solid var(--emp-border)' : 'none',
        }}
      >
        <h3 style={{ fontSize: '0.98rem', fontWeight: 800, margin: 0, color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>{title}</span>
          {count != null && (
            <span style={{ fontSize: '0.75rem', fontWeight: 600, background: 'var(--emp-primary-light, #e0e7ff)', color: 'var(--emp-primary)', padding: '1px 6px', borderRadius: 10 }}>
              {count}
            </span>
          )}
        </h3>
        <span style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

function DetailGrid({ items }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, fontSize: '0.82rem' }}>
      {items.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([label, val]) => (
        <div key={label} style={{ background: '#f8fafc', padding: '8px 10px', borderRadius: 6, border: '1px solid #f1f5f9' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)', marginBottom: 2 }}>{label}</div>
          <div style={{ fontWeight: 700, color: 'var(--emp-text)', wordBreak: 'break-word' }}>{val}</div>
        </div>
      ))}
    </div>
  );
}

function PhotoThumbnails({ items }) {
  const shown = items.filter(([, src]) => src);
  if (!shown.length) return <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', fontStyle: 'italic' }}>No document images uploaded</div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8, marginTop: 10 }}>
      {shown.map(([label, src]) => (
        <div key={label} style={{ textAlign: 'center' }}>
          <a href={src} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            <img
              src={src}
              alt={label}
              style={{ width: '100%', height: 75, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--emp-border)', background: '#f1f5f9' }}
            />
          </a>
          <div style={{ fontSize: '0.7rem', color: 'var(--emp-text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {label}
          </div>
        </div>
      ))}
    </div>
  );
}

function PersonCard({ p, title }) {
  if (!p) return <div style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', fontStyle: 'italic' }}>No {title.toLowerCase()} added yet</div>;
  return (
    <div>
      <DetailGrid
        items={[
          ['Name', p.name],
          ['Relation', p.relation],
          ['Phone', p.mobile ? `${p.mobile}${p.mobileVerified ? ' ✓' : ''}` : ''],
          ['Aadhaar', p.aadhaar],
          ['PAN', p.pan ? `${p.pan}${p.panVerified ? ' ✓ verified' : ''}` : ''],
          ['Employee ID', p.employeeCode],
          ...(p.sameAsGuarantor ? [['Note', 'Same person as Guarantor']] : []),
        ]}
      />
      <PhotoThumbnails
        items={[
          ['Photo', p.photo],
          ['Signature', p.signature],
          ['Aadhaar Front', p.aadhaarPhoto],
          ['Aadhaar Back', p.aadhaarBackPhoto],
          ['PAN Card', p.panPhoto],
          ['Joint Photo', p.jointPhoto],
        ]}
      />
    </div>
  );
}

export default function EmployeeMemberSynopsis() {
  const { t } = useEmployeeApp();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const [phoneModal, setPhoneModal] = useState(false);
  const [phoneTarget, setPhoneTarget] = useState('member');
  const [newPhone, setNewPhone] = useState('');
  const [phoneReason, setPhoneReason] = useState('');
  const [phoneOtp, setPhoneOtp] = useState('');
  const [phoneChallengeId, setPhoneChallengeId] = useState('');
  const [phoneOtpSent, setPhoneOtpSent] = useState(false);
  const [phoneDevOtp, setPhoneDevOtp] = useState('');
  const [phoneSending, setPhoneSending] = useState(false);
  const [phoneSubmitting, setPhoneSubmitting] = useState(false);
  const [phoneCountdown, setPhoneCountdown] = useState(0);

  useEffect(() => {
    if (phoneCountdown > 0) {
      const timer = setTimeout(() => setPhoneCountdown(phoneCountdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [phoneCountdown]);

  const handleSearch = async (e) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    setData(null);
    try {
      const res = await api.employeeApp.memberSynopsis(query.trim());
      setData(res);
    } catch (err) {
      setError(err.message || 'No member synopsis found for this query');
    } finally {
      setLoading(false);
    }
  };

  const [completeModal, setCompleteModal] = useState(false);
  const [completeOptions, setCompleteOptions] = useState(null);
  const [completeLoading, setCompleteLoading] = useState(false);

  const handleOpenComplete = async () => {
    setCompleteLoading(true);
    try {
      const opts = await api.members.options();
      setCompleteOptions(opts);
      setCompleteModal(true);
    } catch (err) {
      alert(err.message || 'Failed to load options for completing details');
    } finally {
      setCompleteLoading(false);
    }
  };

  const handleSendPhoneOtp = async () => {
    const cleanNum = newPhone.trim().replace(/\D/g, '').slice(-10);
    if (!/^\d{10}$/.test(cleanNum)) {
      alert('Enter a valid 10-digit mobile number');
      return;
    }
    const currentPhone = phoneTarget === 'member' ? m?.mobile : m?.guarantor?.mobile;
    if (currentPhone && currentPhone.replace(/\D/g, '').slice(-10) === cleanNum) {
      alert('New mobile number cannot be the same as current number');
      return;
    }
    setPhoneSending(true);
    try {
      const res = await api.members.sendPhoneUpdateOtp(m.id || m._id, {
        targetType: phoneTarget,
        newNumber: cleanNum,
      });
      setPhoneChallengeId(res.challengeId);
      setPhoneOtpSent(true);
      setPhoneCountdown(60);
      if (res.devOtp) setPhoneDevOtp(res.devOtp);
      alert(`OTP sent successfully to +91 ${cleanNum}`);
    } catch (err) {
      alert(err.message || 'Failed to send OTP');
    } finally {
      setPhoneSending(false);
    }
  };

  const handleSubmitPhoneUpdate = async () => {
    if (!phoneOtpSent) {
      alert('Please send and verify OTP first');
      return;
    }
    const otpClean = phoneOtp.trim();
    if (!/^\d{6}$/.test(otpClean)) {
      alert('Enter the 6-digit OTP');
      return;
    }
    setPhoneSubmitting(true);
    try {
      const cleanNum = newPhone.trim().replace(/\D/g, '').slice(-10);
      const res = await api.members.requestPhoneUpdate(m.id || m._id, {
        targetType: phoneTarget,
        newNumber: cleanNum,
        reason: phoneReason.trim(),
        challengeId: phoneChallengeId,
        otp: otpClean,
      });
      alert(res.message || 'Phone update request submitted to Admin KYC for approval');
      setPhoneModal(false);
      const updated = await api.employeeApp.memberSynopsis(m.code || query);
      setData(updated);
    } catch (err) {
      alert(err.message || 'Failed to submit phone update request');
    } finally {
      setPhoneSubmitting(false);
    }
  };

  const m = data?.member || data;
  const kyc = data?.kyc || { documents: [] };
  const groups = data?.groups || [];
  const groupTransfers = data?.groupTransfers || [];
  const loans = data?.loans || [];
  const civilChecks = data?.civilChecks || [];
  const timeline = data?.timeline || [];
  const blockHistory = data?.blockHistory || [];
  const editHistory = data?.editHistory || [];

  return (
    <div className="emp-page-container">
      {/* Search Header */}
      <div className="emp-card">
        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 8px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="file" size={20} style={{ color: 'var(--emp-primary)' }} />
          <span>{t('borrowerSynopsis')}</span>
        </h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', margin: '0 0 12px 0' }}>
          Complete 360° Borrower Report — profile, KYC documents, loan records, groups, civil checks &amp; timeline (Same as Main Software).
        </p>

        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            className="emp-input"
            placeholder="Search Member Code, Mobile, Aadhaar..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1 }}
            autoFocus
          />
          <button type="submit" className="emp-btn-primary" style={{ padding: '0 16px', whiteSpace: 'nowrap' }} disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '12px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 12 }}>
          {error}
        </div>
      )}

      {m && (
        <>
          {/* Main Member Header Card */}
          <div className="emp-card" style={{ borderLeft: '4px solid var(--emp-primary)' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  background: 'var(--emp-primary)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.4rem',
                  fontWeight: 800,
                  overflow: 'hidden',
                  flexShrink: 0,
                }}
              >
                {(m.memberPhoto || m.photo) ? (
                  <img src={m.memberPhoto || m.photo} alt={m.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  m.name?.charAt(0) || 'M'
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: 'var(--emp-text)' }}>
                    {m.name}
                  </h3>
                  {m.mobileVerified && <span style={{ color: '#059669', fontWeight: 700, fontSize: '0.85rem' }} title="Phone verified">✓ verified</span>}
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--emp-text)', marginTop: 2 }}>
                  Member Code: <strong>{m.code}</strong> {m.formId && `· Form ${m.formId}`}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                  Branch: <strong>{m.branch?.name || m.branchName || '—'}</strong> · Joined: {fmtDate(m.joiningDate)}
                </div>
              </div>
            </div>

            {/* Status Pills */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--emp-border)' }}>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, padding: '3px 8px', borderRadius: 12, background: m.isBlocked ? '#fee2e2' : '#dcfce7', color: m.isBlocked ? '#dc2626' : '#15803d' }}>
                {m.isBlocked ? 'Blocked' : 'Active'}
              </span>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, padding: '3px 8px', borderRadius: 12, background: BG_TONE[kyc.status] || '#f1f5f9', color: TONE[kyc.status] || '#334155' }}>
                KYC {LABEL[kyc.status] || kyc.status}
              </span>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, padding: '3px 8px', borderRadius: 12, background: '#f1f5f9', color: '#475569' }}>
                {m.guarantor ? 'Guarantor Added' : 'No Guarantor'}
              </span>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, padding: '3px 8px', borderRadius: 12, background: '#f1f5f9', color: '#475569' }}>
                {m.nominee ? 'Nominee Added' : 'No Nominee'}
              </span>
              {m.civilScore != null && (
                <span style={{ fontSize: '0.74rem', fontWeight: 700, padding: '3px 8px', borderRadius: 12, background: m.civilScore >= 700 ? '#dcfce7' : '#fef3c7', color: m.civilScore >= 700 ? '#15803d' : '#b45309' }}>
                  CIBIL {m.civilScore}
                </span>
              )}
            </div>

            {/* Quick Actions */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="emp-btn-primary"
                onClick={() => downloadMemberPdf(m)}
                style={{ flex: 1, minWidth: 140, padding: '8px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <Icon name="download" size={14} />
                <span>Download Member PDF</span>
              </button>
              <button
                type="button"
                className="emp-btn-secondary"
                onClick={() => {
                  setPhoneModal(true);
                  setPhoneOtpSent(false);
                  setPhoneOtp('');
                  setNewPhone('');
                  setPhoneReason('');
                }}
                style={{ flex: 1, minWidth: 120, padding: '8px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: '#f1f5f9' }}
              >
                <Icon name="phone" size={14} />
                <span>Update Mobile</span>
              </button>
              {m.missingDetails?.length > 0 && (
                <button
                  type="button"
                  className="emp-btn-primary"
                  onClick={handleOpenComplete}
                  disabled={completeLoading}
                  style={{ flex: 1, minWidth: 160, padding: '8px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: '#d97706', borderColor: '#b45309' }}
                >
                  <Icon name="edit" size={14} />
                  <span>{completeLoading ? 'Loading…' : `Complete Details (${m.missingDetails.length})`}</span>
                </button>
              )}
            </div>
          </div>

          {/* Missing Details Banner for Old Members (Item 11 Fix) */}
          {m.missingDetails?.length > 0 && (
            <div style={{ background: '#fffbeb', border: '1.5px solid #f59e0b', color: '#92400e', padding: '10px 14px', borderRadius: 8, fontSize: '0.82rem', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <strong>Incomplete Profile (Old Member):</strong> {m.missingDetails.map((d) => d.label).join(', ')}
                <div style={{ fontSize: '0.72rem', color: '#b45309', marginTop: 2 }}>
                  Member details must be completed before applying for new loans.
                </div>
              </div>
              <button
                type="button"
                className="emp-btn-primary"
                onClick={handleOpenComplete}
                disabled={completeLoading}
                style={{ background: '#d97706', fontSize: '0.75rem', padding: '6px 14px', whiteSpace: 'nowrap' }}
              >
                Complete Details Now
              </button>
            </div>
          )}

          {data.pendingPhoneRequest && (
            <div style={{ background: '#fffbeb', border: '1px solid #fef3c7', color: '#92400e', padding: '10px 14px', borderRadius: 8, fontSize: '0.82rem', marginBottom: 12 }}>
              <strong>Phone Update Pending Admin Approval:</strong> {data.pendingPhoneRequest.targetType === 'guarantor' ? 'Guarantor' : 'Member'} mobile {data.pendingPhoneRequest.oldNumber || '—'} → <strong>{data.pendingPhoneRequest.newNumber}</strong> {data.pendingPhoneRequest.reason && `(Reason: ${data.pendingPhoneRequest.reason})`}
            </div>
          )}

          {m.isBlocked && (
            <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 14px', borderRadius: 8, fontSize: '0.82rem', marginBottom: 12 }}>
              <strong>Member Blocked:</strong> {m.blockReason || 'Blocked by administration'}
            </div>
          )}

          {/* 1. Personal Details */}
          <Section title="Personal details">
            <DetailGrid
              items={[
                ['Member Name', m.name],
                ['Husband Name', m.husbandName],
                ['Father Name', m.fatherName],
                ['Date of Birth', m.dob],
                ['Gender', cap(m.gender)],
                ['Occupation', m.occupation],
                ['Education', m.education],
                ['Employee ID', m.employeeCode],
                ['Joining Date', fmtDate(m.joiningDate)],
              ]}
            />
          </Section>

          {/* 2. Contact & Address */}
          <Section title="Contact & address">
            <DetailGrid
              items={[
                ['Mobile', `${m.mobile || '—'}${m.mobileVerified ? ' ✓ verified' : ''}`],
                ['Email', m.email || '—'],
                ['Address', m.address || '—'],
                ['Area / Village', m.area || '—'],
                ['District / State', `${m.district || ''}${m.state ? `, ${m.state}` : ''}`],
                ['Pincode', m.pincode || '—'],
              ]}
            />
          </Section>

          {/* Phone Number History */}
          {(data.phoneHistory || m.phoneHistory)?.length > 0 && (
            <Section title={`Phone number history (${(data.phoneHistory || m.phoneHistory).length})`} count={(data.phoneHistory || m.phoneHistory).length}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(data.phoneHistory || m.phoneHistory).map((h, hIdx) => (
                  <div key={hIdx} style={{ background: '#f8fafc', padding: '8px 10px', borderRadius: 6, fontSize: '0.78rem', borderLeft: '3px solid #3b82f6' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                      <span>{h.targetType === 'guarantor' ? 'Guarantor Mobile' : 'Member Mobile'}</span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--emp-text-muted)' }}>{fmtTime(h.approvedAt || h.requestedAt)}</span>
                    </div>
                    <div style={{ marginTop: 2, display: 'flex', gap: 6 }}>
                      <span style={{ textDecoration: 'line-through', color: '#64748b' }}>{h.oldNumber || '—'}</span>
                      <span>→</span>
                      <strong style={{ color: '#059669' }}>{h.newNumber}</strong>
                    </div>
                    {h.reason && <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>Reason: {h.reason}</div>}
                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 1 }}>
                      Approved by: <strong>{h.approvedByCode || 'Admin'}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* 3. KYC & Bank */}
          <Section title="KYC & bank">
            <DetailGrid
              items={[
                ['Aadhaar Number', m.aadhaar || '—'],
                ['PAN Number', m.pan ? `${m.pan}${m.panVerified ? ' ✓ verified' : ''}` : '—'],
                ['Bank Name', m.bankName || '—'],
                ['IFSC Code', m.ifsc || '—'],
                ['Account Number', m.accountNumber || '—'],
              ]}
            />
          </Section>

          {/* 4. Documents & Photo Stamps */}
          <Section title={`Documents (${kyc.approved || 0}/${kyc.total || 0} approved)`} count={kyc.total || 0}>
            {!kyc.documents || kyc.documents.length === 0 ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', fontStyle: 'italic' }}>No documents uploaded</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--emp-border)', textAlign: 'left' }}>
                      <th style={{ padding: '6px 8px' }}>Document</th>
                      <th style={{ padding: '6px 8px' }}>Of</th>
                      <th style={{ padding: '6px 8px' }}>Status</th>
                      <th style={{ padding: '6px 8px' }}>Reviewed</th>
                      <th style={{ padding: '6px 8px' }}>Remark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kyc.documents.map((d) => (
                      <tr key={d.key} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '6px 8px', fontWeight: 600 }}>{d.label}</td>
                        <td style={{ padding: '6px 8px' }}>{d.who}</td>
                        <td style={{ padding: '6px 8px' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 6px', borderRadius: 8, background: BG_TONE[d.status] || '#f1f5f9', color: TONE[d.status] || '#334155' }}>
                            {LABEL[d.status] || d.status}
                          </span>
                        </td>
                        <td style={{ padding: '6px 8px', fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>
                          {d.reviewedAt ? `${fmtTime(d.reviewedAt)}${d.reviewedByCode ? ` · ${d.reviewedByCode}` : ''}` : '—'}
                        </td>
                        <td style={{ padding: '6px 8px', fontSize: '0.72rem' }}>
                          {d.reason || (d.resubmitted && d.status === 'pending' ? 'Uploaded again' : '—')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <PhotoThumbnails
              items={[
                ['Member photo', m.memberPhoto || m.photo],
                ['Signature', m.signaturePhoto],
                ['Aadhaar front', m.aadhaarPhoto],
                ['Aadhaar back', m.aadhaarBackPhoto],
                ['PAN card', m.panPhoto],
              ]}
            />
          </Section>

          {/* 5. Groups */}
          <Section title={`Groups (${groups.length})`} count={groups.length}>
            {groups.length === 0 ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', fontStyle: 'italic' }}>This member is not in any group</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--emp-border)', textAlign: 'left' }}>
                      <th style={{ padding: '6px 8px' }}>Group</th>
                      <th style={{ padding: '6px 8px' }}>Leader</th>
                      <th style={{ padding: '6px 8px' }}>Members</th>
                      <th style={{ padding: '6px 8px' }}>Added on</th>
                      <th style={{ padding: '6px 8px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <tr key={g.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '6px 8px' }}>
                          <strong>{g.code}</strong> — {g.name}
                        </td>
                        <td style={{ padding: '6px 8px' }}>{g.leaderName}</td>
                        <td style={{ padding: '6px 8px' }}>{g.memberCount}</td>
                        <td style={{ padding: '6px 8px', fontSize: '0.72rem' }}>{fmtTime(g.addedAt)}</td>
                        <td style={{ padding: '6px 8px' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 6px', borderRadius: 8, background: g.isCurrent ? '#dcfce7' : '#f1f5f9', color: g.isCurrent ? '#15803d' : '#64748b' }}>
                            {g.statusLabel || (g.isCurrent ? 'Active (Current)' : 'Previous / Transferred')}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Group Transfers if any */}
          {groupTransfers.length > 0 && (
            <Section title={`Group transfers (${groupTransfers.length})`} count={groupTransfers.length}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--emp-border)', textAlign: 'left' }}>
                      <th style={{ padding: '6px 8px' }}>Date</th>
                      <th style={{ padding: '6px 8px' }}>From</th>
                      <th style={{ padding: '6px 8px' }}>To</th>
                      <th style={{ padding: '6px 8px' }}>By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupTransfers.map((t, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '6px 8px' }}>{fmtTime(t.at)}</td>
                        <td style={{ padding: '6px 8px' }}>{t.from}</td>
                        <td style={{ padding: '6px 8px' }}><strong>{t.to}</strong></td>
                        <td style={{ padding: '6px 8px' }}>{t.by || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* 6. Loan Record (Full Software View) */}
          <Section title={`Loan record (${loans.length})`} count={loans.length}>
            {loans.length === 0 ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', fontStyle: 'italic' }}>No loan requisition for this member yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {loans.map((l, i) => (
                  <div key={l.id || i} style={{ border: '1px solid var(--emp-border)', borderRadius: 8, padding: 10, background: '#fff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: '0.92rem', color: 'var(--emp-primary)' }}>
                          {l.loanId ? l.loanId : <span style={{ color: 'var(--emp-text-muted)' }}>Not paid out yet</span>}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--emp-text-muted)', marginTop: 1 }}>
                          Form ID: {l.formId} · Scheme: {l.scheme}
                        </div>
                      </div>
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: l.status === 'approved' ? '#dcfce7' : l.status === 'pending' ? '#f1f5f9' : '#fee2e2', color: l.status === 'approved' ? '#15803d' : l.status === 'pending' ? '#475569' : '#b91c1c' }}>
                        {cap(l.status)}
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e2e8f0', fontSize: '0.78rem' }}>
                      <div>
                        <span style={{ color: 'var(--emp-text-muted)' }}>Sanctioned:</span>
                        <div style={{ fontWeight: 700 }}>{inr(l.amount)}</div>
                      </div>
                      <div>
                        <span style={{ color: 'var(--emp-text-muted)' }}>Cash In Hand:</span>
                        <div style={{ fontWeight: 700 }}>{inr(l.cash)}</div>
                      </div>
                      <div>
                        <span style={{ color: 'var(--emp-text-muted)' }}>EMI:</span>
                        <div style={{ fontWeight: 700, color: '#059669' }}>{inr(l.emi)}</div>
                      </div>
                      <div>
                        <span style={{ color: 'var(--emp-text-muted)' }}>Term &amp; Mode:</span>
                        <div style={{ fontWeight: 600 }}>{l.term} installments ({l.mode})</div>
                      </div>
                    </div>

                    {l.group && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)', marginTop: 6 }}>
                        Group: {l.group}
                      </div>
                    )}
                    {l.product && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                        Product: {l.product}
                      </div>
                    )}
                    {l.productLoans && l.productLoans.map((pl, plIdx) => (
                      <div key={plIdx} style={{ fontSize: '0.72rem', color: '#7c3aed', marginTop: 2 }}>
                        Product Loan: {pl.product} = {inr(pl.value)} (EMI {inr(pl.emi)})
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* 7. Civil Checks */}
          <Section title={`Civil checks (${civilChecks.length})`} count={civilChecks.length}>
            {civilChecks.length === 0 ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', fontStyle: 'italic' }}>No civil check recorded</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--emp-border)', textAlign: 'left' }}>
                      <th style={{ padding: '6px 8px' }}>Date</th>
                      <th style={{ padding: '6px 8px' }}>Bureau</th>
                      <th style={{ padding: '6px 8px' }}>Score</th>
                      <th style={{ padding: '6px 8px' }}>Band</th>
                      <th style={{ padding: '6px 8px' }}>Remark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {civilChecks.map((c, i) => (
                      <tr key={c.id || i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '6px 8px' }}>{fmtDate(c.reportDate)}</td>
                        <td style={{ padding: '6px 8px' }}>{c.bureau}</td>
                        <td style={{ padding: '6px 8px' }}><strong>{c.score}</strong></td>
                        <td style={{ padding: '6px 8px' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 6px', borderRadius: 8, background: c.score >= 700 ? '#dcfce7' : c.score >= 650 ? '#fef3c7' : '#fee2e2', color: c.score >= 700 ? '#15803d' : c.score >= 650 ? '#b45309' : '#dc2626' }}>
                            {c.band}
                          </span>
                        </td>
                        <td style={{ padding: '6px 8px', fontSize: '0.72rem' }}>{c.remark || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* 8. Guarantor */}
          <Section title="Guarantor">
            <PersonCard p={m.guarantor} title="Guarantor" />
          </Section>

          {/* Previous Guarantors if any */}
          {m.guarantorHistory?.length > 0 && (
            <Section title={`Previous guarantors (${m.guarantorHistory.length})`} count={m.guarantorHistory.length}>
              {m.guarantorHistory.map((h, hIdx) => (
                <div key={hIdx} style={{ marginBottom: 12, paddingBottom: 10, borderBottom: '1px dashed #e2e8f0' }}>
                  <div style={{ fontSize: '0.74rem', color: 'var(--emp-text-muted)', marginBottom: 6 }}>
                    Replaced on {fmtTime(h.replacedAt)}{h.replacedByCode ? ` by ${h.replacedByCode}` : ''} · Reason: {h.reason || '—'}
                  </div>
                  <PersonCard p={h} title="Previous Guarantor" />
                </div>
              ))}
            </Section>
          )}

          {/* 9. Nominee */}
          <Section title="Nominee">
            <PersonCard p={m.nominee} title="Nominee" />
          </Section>

          {/* 10. Recent EMI Payments */}
          {data.recentEmis && data.recentEmis.length > 0 && (
            <Section title={`Recent EMI Payments (${data.recentEmis.length})`} count={data.recentEmis.length}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.recentEmis.map((e, eIdx) => (
                  <div key={e.receiptNo || eIdx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '6px 10px', borderRadius: 6, fontSize: '0.78rem' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>Rcpt: {e.receiptNo}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--emp-text-muted)' }}>Paid on: {e.paidOn || '—'} · {e.mode}</div>
                    </div>
                    <div style={{ fontWeight: 700, color: '#059669' }}>
                      {inr(e.amount)}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* 11. Activity Timeline */}
          {timeline.length > 0 && (
            <Section title={`Activity timeline (${timeline.length})`} count={timeline.length} defaultOpen={false}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.78rem' }}>
                {timeline.map((t, idx) => (
                  <div key={idx} style={{ padding: '6px 8px', borderRadius: 6, background: '#f8fafc', borderLeft: '3px solid var(--emp-primary)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <strong>{t.label}</strong>
                      <span style={{ fontSize: '0.7rem', color: 'var(--emp-text-muted)' }}>{fmtTime(t.at)}</span>
                    </div>
                    {t.detail && <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>{t.detail}</div>}
                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: 1 }}>By: {t.by || '—'}</div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Update Phone Modal Sheet */}
          {phoneModal && (
            <div className="emp-modal-overlay" onClick={() => setPhoneModal(false)}>
              <div className="emp-modal-sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '90vh', overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800 }}>Update Phone Number</h3>
                  <button type="button" onClick={() => setPhoneModal(false)} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 6 }}>
                      Select Target to Update *
                    </label>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="appPhoneTarget"
                          value="member"
                          checked={phoneTarget === 'member'}
                          onChange={() => { setPhoneTarget('member'); setPhoneOtpSent(false); setPhoneOtp(''); }}
                        />
                        <span>Member ({m.mobile || '—'})</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="appPhoneTarget"
                          value="guarantor"
                          checked={phoneTarget === 'guarantor'}
                          onChange={() => { setPhoneTarget('guarantor'); setPhoneOtpSent(false); setPhoneOtp(''); }}
                        />
                        <span>Guarantor ({m.guarantor?.mobile || '—'})</span>
                      </label>
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      New 10-Digit Mobile Number *
                    </label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        type="tel"
                        maxLength={10}
                        placeholder="New 10-digit number"
                        value={newPhone}
                        onChange={(e) => { setNewPhone(e.target.value.replace(/\D/g, '')); setPhoneOtpSent(false); setPhoneOtp(''); }}
                        className="emp-input"
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        className="emp-btn-primary"
                        onClick={handleSendPhoneOtp}
                        disabled={phoneSending || newPhone.length !== 10 || phoneCountdown > 0}
                        style={{ padding: '6px 12px', fontSize: '0.75rem' }}
                      >
                        {phoneSending ? '...' : phoneCountdown > 0 ? `(${phoneCountdown}s)` : phoneOtpSent ? 'Resend' : 'Send OTP'}
                      </button>
                    </div>
                    {phoneDevOtp && (
                      <div style={{ fontSize: '0.7rem', color: '#059669', marginTop: 2 }}>
                        Dev OTP: <strong>{phoneDevOtp}</strong> (or use 123456)
                      </div>
                    )}
                  </div>

                  {phoneOtpSent && (
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                        Enter 6-Digit OTP *
                      </label>
                      <input
                        type="text"
                        maxLength={6}
                        placeholder="Enter 6-digit OTP"
                        value={phoneOtp}
                        onChange={(e) => setPhoneOtp(e.target.value.replace(/\D/g, ''))}
                        className="emp-input"
                      />
                    </div>
                  )}

                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      Reason for Update
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. SIM card lost, number changed"
                      value={phoneReason}
                      onChange={(e) => setPhoneReason(e.target.value)}
                      className="emp-input"
                    />
                  </div>

                  <div style={{ background: '#f8fafc', padding: '8px 10px', borderRadius: 6, fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>
                    Request will be submitted to Admin KYC. Upon Admin approval, the number updates and old number is retained in history.
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button
                      type="button"
                      className="emp-btn-secondary"
                      style={{ flex: 1 }}
                      onClick={() => setPhoneModal(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="emp-btn-primary"
                      style={{ flex: 2 }}
                      onClick={handleSubmitPhoneUpdate}
                      disabled={phoneSubmitting || !phoneOtpSent || phoneOtp.length !== 6}
                    >
                      {phoneSubmitting ? 'Submitting...' : 'Submit to Admin KYC'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Complete Member Details Modal for Old / Incomplete Members (Item 11 Fix) */}
          {completeModal && (
            <EmpCompleteDetailsModal
              member={m}
              options={completeOptions}
              onClose={() => setCompleteModal(false)}
              onSaved={async () => {
                setCompleteModal(false);
                const updated = await api.employeeApp.memberSynopsis(m.code || query);
                setData(updated);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

export function EmpCompleteDetailsModal({ member, options, onClose, onSaved }) {
  const missing = new Set((member.missingDetails || []).map((d) => d.key));
  const [form, setForm] = useState({
    mobile: member.mobile || '',
    husbandName: '',
    occupation: '',
    education: '',
    address: '',
    pincode: '',
    state: member.state || '',
    district: '',
    aadhaar: '',
    bankName: '',
    ifsc: '',
    accountNumber: '',
    memberPhoto: '',
    signaturePhoto: '',
    aadhaarPhoto: '',
    aadhaarBackPhoto: '',
    panPhoto: '',
  });

  const [challengeId, setChallengeId] = useState('');
  const [districts, setDistricts] = useState([]);
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [devOtp, setDevOtp] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [otpVerified, setOtpVerified] = useState(Boolean(member.mobileVerified));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!form.state) return;
    api.members.districts(form.state).then((r) => setDistricts(r.cities || [])).catch(() => setDistricts([]));
  }, [form.state]);

  const handleSendOtp = async () => {
    const cleanNum = form.mobile.trim().replace(/\D/g, '').slice(-10);
    if (!/^\d{10}$/.test(cleanNum)) {
      alert('Enter a valid 10-digit mobile number');
      return;
    }
    setSendingOtp(true);
    setError('');
    try {
      const res = await api.members.sendOtp({ mobile: cleanNum, purpose: 'mobile' });
      setChallengeId(res.challengeId);
      setOtpSent(true);
      if (res.devOtp) setDevOtp(res.devOtp);
      alert(`OTP sent to +91 ${cleanNum}`);
    } catch (err) {
      setError(err.message || 'Failed to send OTP');
    } finally {
      setSendingOtp(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!challengeId) {
      alert('Send OTP first');
      return;
    }
    if (!otp.trim()) {
      alert('Enter OTP');
      return;
    }
    setVerifyingOtp(true);
    setError('');
    try {
      const cleanNum = form.mobile.trim().replace(/\D/g, '').slice(-10);
      await api.members.verifyOtp({ challengeId, otp: otp.trim(), mobile: cleanNum, purpose: 'mobile' });
      setOtpVerified(true);
      alert('Mobile verified successfully!');
    } catch (err) {
      setError(err.message || 'Invalid OTP');
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handlePhotoUpload = async (key, file) => {
    if (!file) return;
    try {
      const base64 = await compressImage(file, { maxWidth: 1000, maxHeight: 1000, quality: 0.8 });
      setForm((f) => ({ ...f, [key]: base64 }));
    } catch (err) {
      alert('Failed to compress photo: ' + err.message);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const body = {};
    Object.entries(form).forEach(([k, v]) => {
      if (missing.has(k) && String(v).trim() !== '') body[k] = v;
    });
    if (missing.has('district') && form.state && body.district) body.state = form.state;
    if (missing.has('mobile') && body.mobile) {
      if (!challengeId) {
        setError('Verify the mobile number with an OTP first');
        return;
      }
      body.mobileChallengeId = challengeId;
    }
    if (!Object.keys(body).length) {
      setError('Fill in at least one of the missing details to save');
      return;
    }
    setBusy(true);
    try {
      const res = await api.members.complete(member.id || member._id, body);
      alert(`Saved: ${res.filled?.length || Object.keys(body).length} details updated successfully!`);
      onSaved();
    } catch (err) {
      setError(err.message || 'Failed to save member details');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
      <div style={{ background: '#fff', borderRadius: 12, maxWidth: 520, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 18, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderBottom: '1px solid var(--emp-border)', paddingBottom: 10 }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0, color: 'var(--emp-text)' }}>
            Complete Details — {member.name} ({member.code})
          </h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#64748b' }}>✕</button>
        </div>

        <div style={{ background: '#fffbeb', border: '1px solid #fef3c7', color: '#92400e', padding: '8px 12px', borderRadius: 6, fontSize: '0.78rem', marginBottom: 12 }}>
          Fill in missing old-system details. You can save now and complete the rest later. Once saved, details are locked and can only be altered by admin.
        </div>

        {error && (
          <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 6, fontSize: '0.78rem', marginBottom: 12 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {missing.has('mobile') && (
            <div style={{ border: '1px solid var(--emp-border)', borderRadius: 8, padding: 10, background: '#f8fafc' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                Mobile Number (OTP Required) *
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  maxLength={10}
                  className="emp-input"
                  placeholder="10-digit mobile"
                  value={form.mobile}
                  onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value.replace(/\D/g, '') }))}
                  disabled={otpVerified}
                  style={{ flex: 1 }}
                />
                {!otpVerified ? (
                  <button
                    type="button"
                    className="emp-btn-primary"
                    onClick={handleSendOtp}
                    disabled={sendingOtp || form.mobile.length !== 10}
                    style={{ fontSize: '0.75rem', padding: '6px 12px', whiteSpace: 'nowrap' }}
                  >
                    {sendingOtp ? 'Sending…' : otpSent ? 'Resend OTP' : 'Send OTP'}
                  </button>
                ) : (
                  <span style={{ color: '#16a34a', fontWeight: 700, fontSize: '0.8rem', display: 'flex', alignItems: 'center' }}>✓ Verified</span>
                )}
              </div>
              {devOtp && !otpVerified && (
                <div style={{ fontSize: '0.7rem', color: '#059669', marginTop: 2 }}>Dev OTP: {devOtp} (or 123456)</div>
              )}
              {otpSent && !otpVerified && (
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <input
                    type="text"
                    maxLength={6}
                    className="emp-input"
                    placeholder="Enter 6-digit OTP"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="emp-btn-primary"
                    onClick={handleVerifyOtp}
                    disabled={verifyingOtp || otp.length < 4}
                    style={{ fontSize: '0.75rem', padding: '6px 12px', background: '#059669' }}
                  >
                    {verifyingOtp ? 'Verifying…' : 'Verify'}
                  </button>
                </div>
              )}
            </div>
          )}

          {missing.has('husbandName') && (
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>Husband Name *</label>
              <input type="text" className="emp-input" value={form.husbandName} onChange={(e) => setForm((f) => ({ ...f, husbandName: e.target.value }))} placeholder="Enter husband name" />
            </div>
          )}

          {missing.has('occupation') && (
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>Occupation *</label>
              <select className="emp-input" value={form.occupation} onChange={(e) => setForm((f) => ({ ...f, occupation: e.target.value }))}>
                <option value="">-- Select Occupation --</option>
                {(options?.occupations || ['Agriculture', 'Dairy', 'Daily Wage Labor', 'Self Employed / Business', 'Housewife', 'Private Service', 'Tailoring']).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>
          )}

          {missing.has('education') && (
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>Education *</label>
              <select className="emp-input" value={form.education} onChange={(e) => setForm((f) => ({ ...f, education: e.target.value }))}>
                <option value="">-- Select Education --</option>
                {(options?.educations || ['Illiterate', 'Primary (1-5)', 'Middle (6-8)', 'Secondary (10th)', 'Higher Secondary (12th)', 'Graduate', 'Post Graduate']).map((ed) => (
                  <option key={ed} value={ed}>{ed}</option>
                ))}
              </select>
            </div>
          )}

          {missing.has('address') && (
            <div>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>Address *</label>
              <input type="text" className="emp-input" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="Full address (village/mohalla)" />
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {missing.has('pincode') && (
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>Pincode *</label>
                <input type="text" maxLength={6} className="emp-input" value={form.pincode} onChange={(e) => setForm((f) => ({ ...f, pincode: e.target.value.replace(/\D/g, '') }))} placeholder="6-digit pincode" />
              </div>
            )}
            {missing.has('aadhaar') && (
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>Aadhaar Number *</label>
                <input type="text" maxLength={12} className="emp-input" value={form.aadhaar} onChange={(e) => setForm((f) => ({ ...f, aadhaar: e.target.value.replace(/\D/g, '') }))} placeholder="12-digit Aadhaar" />
              </div>
            )}
          </div>

          {missing.has('district') && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>State *</label>
                <select className="emp-input" value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value, district: '' }))}>
                  <option value="">-- State --</option>
                  {(options?.states || ['Bihar', 'Uttar Pradesh', 'Jharkhand', 'West Bengal']).map((st) => (
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>District *</label>
                <select className="emp-input" value={form.district} onChange={(e) => setForm((f) => ({ ...f, district: e.target.value }))}>
                  <option value="">-- District --</option>
                  {districts.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Bank Details */}
          {(missing.has('bankName') || missing.has('ifsc') || missing.has('accountNumber')) && (
            <div style={{ border: '1px solid var(--emp-border)', borderRadius: 8, padding: 10, background: '#f8fafc' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--emp-text)', marginBottom: 6 }}>Bank Account Details</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {missing.has('bankName') && (
                  <div>
                    <label style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Bank Name</label>
                    <input type="text" className="emp-input" value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} placeholder="e.g. State Bank of India" />
                  </div>
                )}
                {missing.has('ifsc') && (
                  <div>
                    <label style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>IFSC Code</label>
                    <input type="text" maxLength={11} className="emp-input" value={form.ifsc} onChange={(e) => setForm((f) => ({ ...f, ifsc: e.target.value.toUpperCase() }))} placeholder="SBIN0001234" />
                  </div>
                )}
              </div>
              {missing.has('accountNumber') && (
                <div style={{ marginTop: 6 }}>
                  <label style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Account Number</label>
                  <input type="text" className="emp-input" value={form.accountNumber} onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value.replace(/\D/g, '') }))} placeholder="Bank account number" />
                </div>
              )}
            </div>
          )}

          {/* Photos */}
          {['memberPhoto', 'signaturePhoto', 'aadhaarPhoto', 'aadhaarBackPhoto', 'panPhoto'].some((k) => missing.has(k)) && (
            <div style={{ border: '1px solid var(--emp-border)', borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--emp-text)', marginBottom: 6 }}>Upload Required Photos</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {missing.has('memberPhoto') && (
                  <div>
                    <label style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Member Photo</label>
                    <input type="file" accept="image/*" onChange={(e) => handlePhotoUpload('memberPhoto', e.target.files?.[0])} style={{ fontSize: '0.72rem', width: '100%' }} />
                    {form.memberPhoto && <span style={{ color: '#16a34a', fontSize: '0.7rem' }}>✓ Attached</span>}
                  </div>
                )}
                {missing.has('signaturePhoto') && (
                  <div>
                    <label style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Signature</label>
                    <input type="file" accept="image/*" onChange={(e) => handlePhotoUpload('signaturePhoto', e.target.files?.[0])} style={{ fontSize: '0.72rem', width: '100%' }} />
                    {form.signaturePhoto && <span style={{ color: '#16a34a', fontSize: '0.7rem' }}>✓ Attached</span>}
                  </div>
                )}
                {missing.has('aadhaarPhoto') && (
                  <div>
                    <label style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Aadhaar Front</label>
                    <input type="file" accept="image/*" onChange={(e) => handlePhotoUpload('aadhaarPhoto', e.target.files?.[0])} style={{ fontSize: '0.72rem', width: '100%' }} />
                    {form.aadhaarPhoto && <span style={{ color: '#16a34a', fontSize: '0.7rem' }}>✓ Attached</span>}
                  </div>
                )}
                {missing.has('aadhaarBackPhoto') && (
                  <div>
                    <label style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Aadhaar Back</label>
                    <input type="file" accept="image/*" onChange={(e) => handlePhotoUpload('aadhaarBackPhoto', e.target.files?.[0])} style={{ fontSize: '0.72rem', width: '100%' }} />
                    {form.aadhaarBackPhoto && <span style={{ color: '#16a34a', fontSize: '0.7rem' }}>✓ Attached</span>}
                  </div>
                )}
                {missing.has('panPhoto') && (
                  <div>
                    <label style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>PAN Photo</label>
                    <input type="file" accept="image/*" onChange={(e) => handlePhotoUpload('panPhoto', e.target.files?.[0])} style={{ fontSize: '0.72rem', width: '100%' }} />
                    {form.panPhoto && <span style={{ color: '#16a34a', fontSize: '0.7rem' }}>✓ Attached</span>}
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button type="button" className="emp-btn-secondary" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
            <button type="submit" className="emp-btn-primary" disabled={busy} style={{ flex: 2, background: '#d97706', borderColor: '#b45309' }}>
              {busy ? 'Saving Details…' : 'Save Completed Details'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
