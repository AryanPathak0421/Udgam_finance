import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { compressImage } from '../utils/image.js';

const LIMIT = 25;
const APPROVERS = ['super_admin', 'admin']; // only an admin approves or rejects
const UPLOADERS = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer'];
const ADMINS = ['super_admin', 'admin'];
const TONE = { pending: 'grey', approved: 'green', rejected: 'danger' };
const LABEL = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');
const fmtTime = (d) => (d ? new Date(d).toLocaleString('en-IN') : '—');

function Badge({ status }) {
  return <span className={`badge ${TONE[status] || 'grey'}`}>{LABEL[status] || status}</span>;
}

// Status of one person's documents in the list ("—" when not added yet).
function PartyBadge({ p }) {
  if (!p || p.status === 'none') return <span className="muted">Not added</span>;
  if (p.status === 'same') return <span className="muted">Same as guarantor</span>;
  return (
    <span>
      <span className={`badge ${TONE[p.status]}`} title={`${p.approved}/${p.total} approved`}>
        {LABEL[p.status]} {p.approved}/{p.total}
      </span>
      {p.rejected > 0 && p.status !== 'rejected' && <span className="badge danger" style={{ marginLeft: 4 }}>{p.rejected} rejected</span>}
    </span>
  );
}

function ReviewDialog({ memberId, canApprove, canUpload, isAdmin, onClose, onChanged, onlyRejected = false }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [rejecting, setRejecting] = useState(null); // document key
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(null);
  const fileRef = useRef(null);
  const reuploadKey = useRef('');

  const load = useCallback(async () => {
    try {
      setData(await api.members.kyc(memberId));
    } catch (err) {
      setError(err.message);
    }
  }, [memberId]);
  useEffect(() => {
    load();
  }, [load]);

  async function act(fn, ok) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      setRejecting(null);
      setReason('');
      await load();
      onChanged();
    } catch (err) {
      if (err.errors?.reason) setReasonError(err.errors.reason);
      else toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const approve = (key) => act(() => api.members.kycReview(memberId, { key, action: 'approve' }), 'Document approved');
  function reject() {
    if (reason.trim().length < 3) return setReasonError('Enter the reason for rejection');
    act(() => api.members.kycReview(memberId, { key: rejecting, action: 'reject', reason: reason.trim() }), 'Document rejected');
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const image = await compressImage(file);
      await act(() => api.members.kycReupload(memberId, { key: reuploadKey.current, image }), 'Document uploaded again — sent for approval');
    } catch (err) {
      toast.error(err.message);
    }
  }

  const m = data?.member;
  const blocked = Boolean(m?.isBlocked);
  return (
    <Modal open title={m ? `KYC — ${m.name} (${m.code})` : 'KYC documents'} onClose={onClose} size="lg" busy={busy}
      footer={<button className="btn" onClick={onClose}>Close</button>}>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg" hidden onChange={onFile} />
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !data ? (
        <Spinner label="Loading documents…" />
      ) : (
        <>
          <p className="muted small" style={{ marginTop: 0 }}>
            {blocked && <span className="badge danger" style={{ marginRight: 8 }}>Blocked — no changes allowed</span>}
            Form ID {m.formId} · {m.branch?.name || '—'} · Submitted {fmtDate(m.submittedAt)} · <Badge status={m.status} />
            {m.guarantorChangedAt && <> · Guarantor changed {fmtDate(m.guarantorChangedAt)}</>}
          </p>
          {onlyRejected && <p className="muted small">Only rejected documents can be uploaded again. Approved documents cannot be changed.</p>}
          {data.documents.filter((d) => !onlyRejected || d.status === 'rejected').length === 0 ? (
            <EmptyState title={onlyRejected ? 'No rejected documents' : 'No documents uploaded'} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
              {data.documents.filter((d) => !onlyRejected || d.status === 'rejected').map((d) => (
                <div key={d.key} className="panel" style={{ padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                    <strong>{d.who} — {d.label}</strong>
                    <Badge status={d.status} />
                  </div>
                  <img src={d.image} alt={`${d.who} ${d.label}`} onClick={() => setZoom(d)}
                    style={{ width: '100%', maxHeight: 150, objectFit: 'contain', background: '#f6f7f9', borderRadius: 8, cursor: 'zoom-in' }} />
                  {d.status === 'rejected' && <div className="field-error">Rejected: {d.reason}</div>}
                  {d.status === 'pending' && d.resubmitted && <div className="field-hint">Uploaded again, waiting for approval</div>}
                  {d.reviewedAt && d.status !== 'pending' && <div className="field-hint">{fmtTime(d.reviewedAt)}{d.reviewedByCode ? ` · ${d.reviewedByCode}` : ''}</div>}

                  {rejecting === d.key ? (
                    <div style={{ marginTop: 8 }}>
                      <FormField id={`r-${d.key}`} label="Reason for rejection" required error={reasonError}>
                        <input id={`r-${d.key}`} value={reason} maxLength={200} autoFocus
                          onChange={(e) => { setReason(e.target.value); setReasonError(''); }} />
                      </FormField>
                      <div className="row-actions">
                        <button className="btn sm danger-outline" disabled={busy} onClick={reject}>Reject</button>
                        <button className="btn sm" disabled={busy} onClick={() => { setRejecting(null); setReason(''); setReasonError(''); }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="row-actions" style={{ marginTop: 8, display: blocked ? 'none' : undefined }}>
                      {canApprove && d.status !== 'approved' && d.status !== 'rejected' && (
                        <button className="btn sm primary" disabled={busy} onClick={() => approve(d.key)}>Approve</button>
                      )}
                      {canApprove && d.status !== 'rejected' && (
                        <button className="btn sm danger-outline" disabled={busy} onClick={() => { setRejecting(d.key); setReason(''); }}>Reject</button>
                      )}
                      {canApprove && d.status === 'approved' && <span className="muted small">Approved</span>}
                      {/* The branch can only upload a rejected document again; replacing a photo is for an admin. */}
                      {canUpload && d.status === 'rejected' && (
                        <button className="btn sm primary" disabled={busy} onClick={() => { reuploadKey.current = d.key; fileRef.current?.click(); }}>
                          Re-upload
                        </button>
                      )}
                      {isAdmin && d.status === 'pending' && !onlyRejected && (
                        <button className="btn sm" disabled={busy} onClick={() => { reuploadKey.current = d.key; fileRef.current?.click(); }}>
                          Replace photo
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {zoom && (
        <Modal open title={`${zoom.who} — ${zoom.label}`} onClose={() => setZoom(null)} size="lg" footer={<button className="btn" onClick={() => setZoom(null)}>Close</button>}>
          <img src={zoom.image} alt={zoom.label} style={{ maxWidth: '100%', display: 'block', margin: '0 auto' }} />
        </Modal>
      )}
    </Modal>
  );
}

export function KycReupload() {
  return <KycApproval mode="reupload" />;
}

export default function KycApproval({ mode = 'approval' } = {}) {
  const reupload = mode === 'reupload';
  const { user } = useAuth();
  const canApprove = APPROVERS.includes(user?.role);
  const canUpload = UPLOADERS.includes(user?.role);
  const isAdmin = ADMINS.includes(user?.role);

  const [data, setData] = useState({ items: [], counts: { pending: 0, rejected: 0, approved: 0 }, total: 0, totalPages: 1 });
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(reupload ? 'rejected' : 'pending');
  const [branch, setBranch] = useState('');
  const [party, setParty] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null);
  const q = useDebounce(search);

  useEffect(() => {
    api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.members.kycList({ page, limit: LIMIT, status, party, branch, from, to, q }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, status, party, branch, from, to, q]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [status, party, branch, from, to, q]);

  const tab = (key, label) => (
    <button key={key} className={`btn sm${status === key ? ' primary' : ''}`} onClick={() => setStatus(key)}>
      {label}{key && data.counts[key] !== undefined ? ` (${data.counts[key]})` : ''}
    </button>
  );
  const hasFilters = branch || from || to || search;

  return (
    <>
      <PageHeader
        title={reupload ? 'KYC Re-upload' : 'KYC Approval'}
        description={reupload ? 'Documents rejected by the admin are listed here. Upload them again; approved documents cannot be changed.' : 'Only an admin approves or rejects documents, date-wise. Rejected documents are uploaded again by the branch under KYC Re-upload.'}
      />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          {!reupload && (
            <div style={{ display: 'flex', gap: 6 }}>
              {tab('pending', 'Pending')}
              {tab('rejected', 'Rejected')}
              {tab('approved', 'Approved')}
              {tab('', 'All')}
            </div>
          )}
          <select value={party} onChange={(e) => setParty(e.target.value)} aria-label="Person">
            <option value="">Borrower, guarantor & nominee</option>
            <option value="member">Borrower only</option>
            <option value="guarantor">Guarantor only</option>
            <option value="nominee">Nominee only</option>
          </select>
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          {branches.length > 1 && (
            <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch">
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <input type="search" className="toolbar-search" placeholder="Search by name, member code, form ID, mobile, last 4 digits of Aadhaar or PAN" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          {hasFilters && <button className="btn" onClick={() => { setBranch(''); setFrom(''); setTo(''); setSearch(''); }}>Clear</button>}
        </div>

        {loading && !data.items.length ? (
          <Spinner label="Loading…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : data.items.length === 0 ? (
          <EmptyState title="Nothing to show" description="No members match these filters." />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead>
                  <tr><th>Date</th><th>Member code</th><th>Name</th><th>Branch</th><th>Borrower</th><th>Guarantor</th><th>Nominee</th><th className="num">Documents</th><th>Status</th><th className="actions-col">Actions</th></tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Date">{fmtDate(r.submittedAt)}</td>
                      <td data-label="Member code"><strong>{r.code}</strong></td>
                      <td data-label="Name">{r.name}</td>
                      <td data-label="Branch">{r.branch?.name || '—'}</td>
                      <td data-label="Borrower"><PartyBadge p={r.parties.member} /></td>
                      <td data-label="Guarantor">
                        <PartyBadge p={r.parties.guarantor} />
                        {r.guarantorChangedAt && <div className="muted small">Guarantor changed {fmtDate(r.guarantorChangedAt)}</div>}
                      </td>
                      <td data-label="Nominee"><PartyBadge p={r.parties.nominee} /></td>
                      <td data-label="Documents" className="num">
                        {r.approved}/{r.total}{r.rejected ? <span className="muted"> · {r.rejected} rejected</span> : null}
                      </td>
                      <td data-label="Status">
                        {r.hasPending && <Badge status="pending" />}{' '}
                        {r.hasRejected && <Badge status="rejected" />}
                        {!r.hasPending && !r.hasRejected && <Badge status="approved" />}
                      </td>
                      <td data-label="Actions" className="actions-col">
                        <button className="btn sm" onClick={() => setOpenId(r.id)}>
                          {reupload ? 'Upload again' : canApprove && r.status === 'pending' ? 'Review' : 'View'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page || page} totalPages={data.totalPages} total={data.total} limit={LIMIT} onPage={setPage} />
          </>
        )}
      </div>
      {openId && <ReviewDialog memberId={openId} canApprove={canApprove} canUpload={canUpload} isAdmin={isAdmin} onlyRejected={reupload} onClose={() => setOpenId(null)} onChanged={load} />}
    </>
  );
}
