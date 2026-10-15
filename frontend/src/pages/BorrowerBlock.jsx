import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';

const LIMIT = 25;
const DECIDERS = ['super_admin', 'admin', 'branch_manager'];
const fmtTime = (d) => (d ? new Date(d).toLocaleString('en-IN') : '—');

function ReasonDialog({ member, action, onClose, onDone }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const blocking = action === 'block';

  async function submit(e) {
    e.preventDefault();
    if (reason.trim().length < 3) return setError('Enter the reason (at least 3 characters)');
    setBusy(true);
    try {
      await api.members.setBlocked(member.id, { action, reason: reason.trim() });
      toast.success(blocking ? 'Member blocked' : 'Member unblocked');
      onDone();
    } catch (err) {
      setError(err.errors?.reason || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={`${blocking ? 'Block' : 'Unblock'} ${member.name} (${member.code})`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className={`btn ${blocking ? 'danger-outline' : 'primary'}`} type="submit" form="block-form" disabled={busy}>
            {busy ? 'Saving…' : blocking ? 'Block member' : 'Unblock member'}
          </button>
        </>
      }
    >
      <form id="block-form" onSubmit={submit} noValidate>
        {blocking ? (
          <p className="muted" style={{ marginTop: 0 }}>A blocked borrower stays on record but must not be given new loans or services until unblocked.</p>
        ) : (
          <p className="muted" style={{ marginTop: 0 }}>Blocked for: {member.blockReason || '—'}</p>
        )}
        <FormField id="reason" label="Reason" required error={error}>
          <input id="reason" value={reason} maxLength={200} autoFocus onChange={(e) => { setReason(e.target.value); setError(''); }} />
        </FormField>
      </form>
    </Modal>
  );
}

function HistoryDialog({ member, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.members.synopsis(member.id).then(setData).catch((e) => setError(e.message));
  }, [member.id]);
  return (
    <Modal open title={`Block history — ${member.code}`} onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      {error ? (
        <ErrorState message={error} />
      ) : !data ? (
        <Spinner label="Loading…" />
      ) : data.blockHistory.length === 0 ? (
        <EmptyState title="Never blocked" />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Date & time</th><th>Action</th><th>By</th><th>Reason</th></tr></thead>
            <tbody>
              {data.blockHistory.map((b) => (
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
    </Modal>
  );
}

export default function BorrowerBlock() {
  const { user } = useAuth();
  const canDecide = DECIDERS.includes(user?.role);

  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [state, setState] = useState('');
  const [dialog, setDialog] = useState(null);
  const q = useDebounce(search);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.members.list({ page, limit: LIMIT, q, blocked: state === 'blocked' ? 'true' : state === 'active' ? 'false' : '' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, q, state]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [q, state]);

  return (
    <>
      <PageHeader title="Borrower Block & Unblock" description="Filter by member code, then block or unblock a borrower. Every change is recorded with the reason." />
      <div className="panel">
        <div className="toolbar">
          <input type="search" className="toolbar-search" placeholder="Search by name, member code, form ID, mobile, last 4 digits of Aadhaar or PAN (guarantor details too)" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search member" />
          <select value={state} onChange={(e) => setState(e.target.value)} aria-label="Filter by status">
            <option value="">All members</option>
            <option value="active">Active</option>
            <option value="blocked">Blocked</option>
          </select>
        </div>

        {loading && !data.items.length ? (
          <Spinner label="Loading…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : data.items.length === 0 ? (
          <EmptyState title="No members found" description="Try a different member code or clear the status filter." />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead><tr><th>Member code</th><th>Name</th><th>Branch</th><th>Mobile</th><th>Status</th><th>Reason</th><th className="actions-col">Actions</th></tr></thead>
                <tbody>
                  {data.items.map((m) => (
                    <tr key={m.id}>
                      <td data-label="Member code"><strong>{m.code}</strong></td>
                      <td data-label="Name">{m.name}</td>
                      <td data-label="Branch">{m.branch?.name || '—'}</td>
                      <td data-label="Mobile">{m.mobile}</td>
                      <td data-label="Status"><span className={`badge ${m.isBlocked ? 'danger' : 'green'}`}>{m.isBlocked ? 'Blocked' : 'Active'}</span></td>
                      <td data-label="Reason">{m.blockReason || '—'}</td>
                      <td data-label="Actions" className="actions-col">
                        <div className="row-actions">
                          <button className="btn sm" onClick={() => setDialog({ type: 'history', member: m })}>History</button>
                          {canDecide && (m.isBlocked ? (
                            <button className="btn sm primary" onClick={() => setDialog({ type: 'unblock', member: m })}>Unblock</button>
                          ) : (
                            <button className="btn sm danger-outline" onClick={() => setDialog({ type: 'block', member: m })}>Block</button>
                          ))}
                        </div>
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

      {(dialog?.type === 'block' || dialog?.type === 'unblock') && (
        <ReasonDialog member={dialog.member} action={dialog.type} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />
      )}
      {dialog?.type === 'history' && <HistoryDialog member={dialog.member} onClose={() => setDialog(null)} />}
    </>
  );
}
