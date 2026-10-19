import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { DetailList, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { downloadMemberPdf } from '../utils/memberPdf.js';
import { useAuth } from '../context/AuthContext.jsx';
import { BorrowerForm } from './NewBorrower.jsx';
import CompleteDetails from './CompleteDetails.jsx';

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');
const fmtTime = (d) => (d ? new Date(d).toLocaleString('en-IN') : '—');
const TONE = { pending: 'grey', approved: 'green', rejected: 'danger' };
const LABEL = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };

function Section({ title, children }) {
  return (
    <div className="panel" style={{ padding: 16, marginBottom: 14 }}>
      <h3 className="section-title">{title}</h3>
      {children}
    </div>
  );
}

function Photos({ items }) {
  const shown = items.filter(([, src]) => src);
  if (!shown.length) return <span className="muted">No documents uploaded</span>;
  return (
    <div className="stamp-view sign-row">
      {shown.map(([label, src]) => (
        <div key={label}>
          <div className="detail-label">{label}</div>
          <img src={src} alt={label} className="stamp-img" />
        </div>
      ))}
    </div>
  );
}

function Person({ p }) {
  return (
    <>
      <DetailList items={[['Name', p.name], ['Phone', p.mobile ? `${p.mobile}${p.mobileVerified ? ' ✓' : ''}` : ''], ['Aadhaar', p.aadhaar], ['PAN', p.pan ? `${p.pan}${p.panVerified ? ' ✓ verified' : ''}` : ''], ['Employee ID', p.employeeCode], ...(p.sameAsGuarantor ? [['Note', 'Same person as the guarantor']] : [])]} />
      <div style={{ marginTop: 10 }}>
        <Photos items={[['Photo', p.photo], ['Signature', p.signature], ['Aadhaar', p.aadhaarPhoto], ['PAN', p.panPhoto], ['Joint photo with member', p.jointPhoto]]} />
      </div>
    </>
  );
}

export default function BorrowerSynopsis() {
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);
  const [editing, setEditing] = useState(null); // { branches, options } while the admin edits
  const [completing, setCompleting] = useState(null); // form options while the branch completes an imported member's details
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [data, setData] = useState(null);
  const [loadingId, setLoadingId] = useState(false);
  const [error, setError] = useState('');
  const q = useDebounce(search);

  useEffect(() => {
    if (data) return undefined;
    let live = true;
    setSearching(true);
    api.members
      .list({ q, limit: 10 })
      .then((r) => live && setResults(r.items))
      .catch(() => live && setResults([]))
      .finally(() => live && setSearching(false));
    return () => {
      live = false;
    };
  }, [q, data]);

  async function open(id) {
    setLoadingId(true);
    setError('');
    try {
      setData(await api.members.synopsis(id));
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setLoadingId(false);
    }
  }

  if (!data) {
    return (
      <>
        <PageHeader title="Borrower Synopsis" description="Search by member code to see everything about a borrower, from A to Z." />
        <div className="panel">
          <div className="toolbar">
            <input type="search" className="toolbar-search" placeholder="Search by member code, name, form ID, mobile, Aadhaar number (or last 4 digits) or PAN number" value={search}
              onChange={(e) => setSearch(e.target.value)} autoFocus aria-label="Search member" />
          </div>
          {error && <ErrorState message={error} />}
          {searching && !results.length ? (
            <Spinner label="Searching…" />
          ) : results.length === 0 ? (
            <EmptyState title="No members found" description="Try the member code, name or mobile number." />
          ) : (
            <div className={`table-wrap${loadingId ? ' dim' : ''}`}>
              <table className="data-table">
                <thead><tr><th>Member code</th><th>Name</th><th>Branch</th><th>Mobile</th><th>Status</th><th className="actions-col">Actions</th></tr></thead>
                <tbody>
                  {results.map((m) => (
                    <tr key={m.id}>
                      <td data-label="Code"><strong>{m.code}</strong></td>
                      <td data-label="Name">{m.name}</td>
                      <td data-label="Branch">{m.branch?.name || '—'}</td>
                      <td data-label="Mobile">{m.mobile}</td>
                      <td data-label="Status"><span className={`badge ${m.isBlocked ? 'danger' : 'green'}`}>{m.isBlocked ? 'Blocked' : 'Active'}</span></td>
                      <td data-label="Actions" className="actions-col"><button className="btn sm primary" disabled={loadingId} onClick={() => open(m.id)}>View synopsis</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>
    );
  }

  const { member: m, kyc, blockHistory, timeline, editHistory = [], groups = [], loans = [], civilChecks = [] } = data;
  const inr = (n) => (n === null || n === undefined ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const KIND = { personal: 'Personal', group: 'Group', business: 'Business / MSME', product: 'Product' };

  async function startEdit() {
    try {
      const [b, o] = await Promise.all([api.groups.branchOptions(), api.members.options()]);
      setEditing({ branches: b.items, options: o });
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function startComplete() {
    try {
      setCompleting(await api.members.options());
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (editing) {
    return (
      <>
        <PageHeader title={`Edit details — ${m.name} (${m.code})`} description="Only an admin can change a member's details. Replaced photos and a changed name or Aadhaar go back to KYC approval." />
        <BorrowerForm
          member={m}
          branches={editing.branches}
          options={editing.options}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            setData(await api.members.synopsis(m.id));
          }}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`${m.name} — ${m.code}`}
        description={`Form ID ${m.formId} · ${m.branch ? m.branch.name : ''} · Joined ${fmtDate(m.joiningDate)}`}
        actions={
          <>
            {m.missingDetails?.length > 0 && <button className="btn primary" onClick={startComplete}>Complete details</button>}
            {isAdmin && <button className="btn primary" onClick={startEdit}>Edit details</button>}
            <button className="btn" onClick={() => downloadMemberPdf(m)}>Download PDF</button>
            <button className="btn" onClick={() => setData(null)}>Search another</button>
          </>
        }
      />

      {completing && <CompleteDetails member={m} options={completing} onClose={() => setCompleting(null)} onSaved={async () => { setCompleting(null); setData(await api.members.synopsis(m.id)); }} />}
      {m.missingDetails?.length > 0 && (
        <div className="notice warn" style={{ marginBottom: 14 }}>
          Details still missing (imported from the old system): <strong>{m.missingDetails.map((d) => d.label).join(', ')}</strong>. The member cannot get a new loan until they are filled in.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <span className={`badge ${m.isBlocked ? 'danger' : 'green'}`}>{m.isBlocked ? 'Blocked' : 'Active'}</span>
        <span className={`badge ${TONE[kyc.status]}`}>KYC {LABEL[kyc.status]}</span>
        <span className="badge grey">{m.guarantor ? 'Guarantor added' : 'No guarantor'}</span>
        <span className="badge grey">{m.nominee ? 'Nominee added' : 'No nominee'}</span>
      </div>
      {m.isBlocked && <div className="notice warn">Blocked — {m.blockReason}</div>}

      <Section title="Personal details">
        <DetailList
          items={[
            ['Member name', m.name], ['Husband name', m.husbandName], ['Date of birth', m.dob], ['Gender', cap(m.gender)],
            ['Occupation', m.occupation], ['Education', m.education], ['Employee ID', m.employeeCode], ['Joining date', m.joiningDate],
          ]}
        />
      </Section>

      <Section title="Contact & address">
        <DetailList
          items={[
            ['Mobile', `${m.mobile}${m.mobileVerified ? ' ✓ verified' : ''}`], ['Email', m.email],
            ['Address', m.address], ['Area / post office', m.area], ['District / State', `${m.district}, ${m.state}`], ['Pincode', m.pincode],
          ]}
        />
      </Section>

      <Section title="KYC & bank">
        <DetailList
          items={[
            ['Aadhaar number', m.aadhaar], ['PAN number', m.pan ? `${m.pan}${m.panVerified ? ' ✓ verified' : ''}` : ''],
            ['Bank name', m.bankName], ['IFSC code', m.ifsc], ['Account number', m.accountNumber],
          ]}
        />
      </Section>

      <Section title={`Documents (${kyc.approved}/${kyc.total} approved)`}>
        {kyc.documents.length === 0 ? (
          <span className="muted">No documents uploaded</span>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Document</th><th>Of</th><th>Status</th><th>Reviewed</th><th>Remark</th></tr></thead>
              <tbody>
                {kyc.documents.map((d) => (
                  <tr key={d.key}>
                    <td data-label="Document">{d.label}</td>
                    <td data-label="Of">{d.who}</td>
                    <td data-label="Status"><span className={`badge ${TONE[d.status]}`}>{LABEL[d.status]}</span></td>
                    <td data-label="Reviewed">{d.reviewedAt ? `${fmtTime(d.reviewedAt)}${d.reviewedByCode ? ` · ${d.reviewedByCode}` : ''}` : '—'}</td>
                    <td data-label="Remark">{d.reason || (d.resubmitted && d.status === 'pending' ? 'Uploaded again' : '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <Photos items={[['Member photo', m.memberPhoto], ['Signature', m.signaturePhoto], ['Aadhaar', m.aadhaarPhoto], ['PAN', m.panPhoto]]} />
        </div>
      </Section>

      <Section title={`Groups (${groups.length})`}>
        {groups.length === 0 ? (
          <span className="muted">This member is not in any group</span>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Group code</th><th>Group name</th><th>Leader</th><th className="num">Members</th><th>Added on</th><th>Added by</th><th>Status</th></tr></thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id}>
                    <td data-label="Group code"><strong>{g.code}</strong></td>
                    <td data-label="Group name">{g.name}</td>
                    <td data-label="Leader">{g.leaderName}</td>
                    <td data-label="Members" className="num">{g.memberCount}</td>
                    <td data-label="Added on">{fmtTime(g.addedAt)}</td>
                    <td data-label="Added by">{g.addedBy ? `${g.addedBy.name}${g.addedBy.employeeCode ? ` · ${g.addedBy.employeeCode}` : ''}` : '—'}</td>
                    <td data-label="Status"><span className={`badge ${g.isActive ? 'green' : 'grey'}`}>{g.isActive ? 'Active' : 'Inactive'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={`Loan record (${loans.length})`}>
        {loans.length === 0 ? (
          <span className="muted">No loan requisition for this member yet</span>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Form ID</th><th>Date</th><th>Type</th><th>Scheme</th><th className="num">Amount</th><th className="num">Cash in hand</th><th className="num">EMI</th><th>Term</th><th>Status</th><th>Details</th></tr></thead>
              <tbody>
                {loans.map((l) => (
                  <tr key={l.id}>
                    <td data-label="Form ID"><strong>{l.formId}</strong></td>
                    <td data-label="Date">{fmtDate(l.loanDate)}</td>
                    <td data-label="Type">{KIND[l.kind] || l.kind}</td>
                    <td data-label="Scheme">{l.scheme}</td>
                    <td data-label="Amount" className="num">{inr(l.amount)}</td>
                    <td data-label="Cash" className="num">{inr(l.cash)}</td>
                    <td data-label="EMI" className="num">{inr(l.emi)}</td>
                    <td data-label="Term">{l.term} installments ({l.mode})</td>
                    <td data-label="Status"><span className={`badge ${l.status === 'approved' ? 'green' : l.status === 'pending' ? 'grey' : 'danger'}`}>{cap(l.status)}</span></td>
                    <td data-label="Details">
                      {l.group && <div>Group {l.group}</div>}
                      {l.product && <div>Product {l.product}</div>}
                      {l.productLoans.map((p, i) => <div key={i}>Product loan: {p.product} = {inr(p.value)} (EMI {inr(p.emi)})</div>)}
                      <div className="muted small">Employee {l.employeeCode}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={`Civil checks (${civilChecks.length})`}>
        {civilChecks.length === 0 ? (
          <span className="muted">No civil check recorded</span>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Report date</th><th>Bureau</th><th className="num">Score</th></tr></thead>
              <tbody>{civilChecks.map((c, i) => <tr key={i}><td data-label="Date">{fmtDate(c.reportDate)}</td><td data-label="Bureau">{c.bureau}</td><td data-label="Score" className="num">{c.score}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Guarantor">
        {m.guarantor ? <Person p={m.guarantor} /> : <span className="muted">No guarantor added yet</span>}
      </Section>

      {m.guarantorHistory?.length > 0 && (
        <Section title="Previous guarantors">
          {m.guarantorHistory.map((h) => (
            <div key={`${h.replacedAt}-${h.aadhaar}`} style={{ marginBottom: 16 }}>
              <div className="field-hint" style={{ marginBottom: 6 }}>
                Replaced on {fmtTime(h.replacedAt)}{h.replacedByCode ? ` by ${h.replacedByCode}` : ''} · Reason: {h.reason || '—'}
              </div>
              <Person p={h} />
            </div>
          ))}
        </Section>
      )}

      <Section title="Nominee">
        {m.nominee ? <Person p={m.nominee} /> : <span className="muted">No nominee added yet</span>}
      </Section>

      <Section title={`Edit record (${editHistory.length})`}>
        {editHistory.length === 0 ? (
          <span className="muted">The details have not been edited since registration</span>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Date & time</th><th>Edited by</th><th>What changed</th></tr></thead>
              <tbody>
                {editHistory.map((h, i) => (
                  <tr key={`${h.at}-${i}`}>
                    <td data-label="Date">{fmtTime(h.at)}</td>
                    <td data-label="Edited by">{h.by || '—'}</td>
                    <td data-label="Changed">
                      {h.changes.map((c) => (
                        <div key={c.field}>
                          <strong>{c.field}</strong>{c.to === 'replaced' && !c.from ? ': replaced' : `: ${c.from || '—'} → ${c.to || '—'}`}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Block history">
        {blockHistory.length === 0 ? (
          <span className="muted">Never blocked</span>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Date & time</th><th>Action</th><th>By</th><th>Reason</th></tr></thead>
              <tbody>
                {blockHistory.map((b) => (
                  <tr key={`${b.at}-${b.action}`}>
                    <td data-label="Date">{fmtTime(b.at)}</td>
                    <td data-label="Action"><span className={`badge ${b.action === 'block' ? 'danger' : 'green'}`}>{b.action === 'block' ? 'Blocked' : 'Unblocked'}</span></td>
                    <td data-label="By">{b.byCode || '—'}</td>
                    <td data-label="Reason">{b.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Activity">
        {timeline.length === 0 ? (
          <span className="muted">No activity recorded</span>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Date & time</th><th>Activity</th><th>By</th><th>Details</th></tr></thead>
              <tbody>
                {timeline.map((t, i) => (
                  <tr key={`${t.at}-${i}`}>
                    <td data-label="Date">{fmtTime(t.at)}</td>
                    <td data-label="Activity">{t.label}</td>
                    <td data-label="By">{t.by || '—'}</td>
                    <td data-label="Details">{t.detail || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
