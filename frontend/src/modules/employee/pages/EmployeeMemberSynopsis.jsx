import { useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';
import { downloadMemberPdf } from '../../../utils/memberPdf.js';

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');
const fmtTime = (d) => (d ? new Date(d).toLocaleString('en-IN') : '—');
const inr = (n) => (n === null || n === undefined ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

const TONE = { pending: '#d97706', approved: '#059669', rejected: '#dc2626' };
const BG_TONE = { pending: '#fef3c7', approved: '#dcfce7', rejected: '#fee2e2' };
const LABEL = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };

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
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                type="button"
                className="emp-btn-primary"
                onClick={() => downloadMemberPdf(m)}
                style={{ flex: 1, padding: '8px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <Icon name="download" size={14} />
                <span>Download Member PDF</span>
              </button>
            </div>
          </div>

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
        </>
      )}
    </div>
  );
}
