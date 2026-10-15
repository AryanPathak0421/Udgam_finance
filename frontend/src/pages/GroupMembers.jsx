import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import Modal from '../components/ui/Modal.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import { DetailList, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { MEETING_LABEL, collectionLabel, formatTime } from '../components/GroupFields.jsx';
import { MemberPicker } from './GroupCreate.jsx';

const MANAGERS = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer'];
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// Add members: pick, confirm, submit.
function AddMembersDialog({ group, existing, onClose, onDone }) {
  const toast = useToast();
  const [selected, setSelected] = useState([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggle = useCallback((m) => {
    setSelected((list) => (list.some((x) => x.id === m.id) ? list.filter((x) => x.id !== m.id) : [...list, m]));
  }, []);
  const toggleAll = useCallback((shown, on) => {
    setSelected((cur) => {
      const rest = cur.filter((x) => !shown.some((m) => m.id === x.id));
      return on ? [...rest, ...shown] : rest;
    });
  }, []);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const r = await api.groups.addMembers(group.id, selected.map((m) => m.id));
      toast.success(`${r.message}. Total members in the group: ${r.memberCount}`);
      onDone();
    } catch (err) {
      setError(err.errors?.members || err.message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      title={`Add members — ${group.name}`}
      onClose={onClose}
      busy={busy}
      footer={
        confirming ? (
          <>
            <button className="btn" onClick={() => setConfirming(false)} disabled={busy}>Back</button>
            <button className="btn primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : `Confirm & submit (${selected.length})`}</button>
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!selected.length} onClick={() => setConfirming(true)}>Review {selected.length || ''} selected</button>
          </>
        )
      }
    >
      {error && <div className="field-error" role="alert" style={{ marginBottom: 8 }}>{error}</div>}
      {confirming ? (
        <>
          <p style={{ marginTop: 0 }}>Add these {selected.length} member{selected.length === 1 ? '' : 's'} to <strong>{group.name}</strong>?</p>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Member code</th><th>Name</th><th>Mobile</th></tr></thead>
              <tbody>
                {selected.map((m) => <tr key={m.id}><td data-label="Code"><strong>{m.code}</strong></td><td data-label="Name">{m.name}</td><td data-label="Mobile">{m.mobile}</td></tr>)}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <MemberPicker branch={group.branchId} selected={selected} onToggle={toggle} onToggleAll={toggleAll} exclude={existing} />
      )}
    </Modal>
  );
}

function GroupDetail({ group, canManage, onBack }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await api.groups.get(group.id));
    } catch (err) {
      setError(err.message);
    }
  }, [group.id]);
  useEffect(() => {
    load();
  }, [load]);

  async function remove() {
    setBusy(true);
    try {
      await api.groups.removeMember(group.id, removing.id);
      toast.success('Member removed');
      setRemoving(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const g = data?.group || group;
  return (
    <>
      <PageHeader
        title={`${g.name} — ${g.code}`}
        description="Members of this group."
        actions={
          <>
            {canManage && g.isActive && <button className="btn primary" onClick={() => setAdding(true)}>+ Add members</button>}
            <button className="btn" onClick={onBack}>Change group</button>
          </>
        }
      />
      <div className="panel" style={{ padding: 16, marginBottom: 14 }}>
        <DetailList
          items={[
            ['Branch', g.branch ? `${g.branch.code} — ${g.branch.name}` : ''], ['Employee', g.employeeCode ? `${g.employeeCode}${g.employeeName ? ` — ${g.employeeName}` : ''}` : ''],
            ['Group leader', g.leaderName], ['Opening date', fmtDate(g.openingDate)],
            ['Meeting', g.meetingType ? `${MEETING_LABEL[g.meetingType]} · ${collectionLabel(g)} · ${formatTime(g.meetingTime)}` : ''],
            ['Total members', String(data ? data.members.length : g.memberCount)],
          ]}
        />
      </div>

      <div className="panel">
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !data ? (
          <Spinner label="Loading members…" />
        ) : data.members.length === 0 ? (
          <EmptyState title="No members in this group yet" description={canManage ? 'Use "+ Add members" to add borrowers to this group.' : undefined} />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>#</th><th>Member code</th><th>Name</th><th>Mobile</th><th>Added on</th><th>Added by</th><th>Status</th>{canManage && <th className="actions-col">Actions</th>}</tr></thead>
              <tbody>
                {data.members.map((m, i) => (
                  <tr key={m.id}>
                    <td data-label="#">{i + 1}</td>
                    <td data-label="Member code"><strong>{m.code}</strong></td>
                    <td data-label="Name">{m.name}</td>
                    <td data-label="Mobile">{m.mobile}</td>
                    <td data-label="Added on">{fmtDateTime(m.addedAt)}</td>
                    <td data-label="Added by">{m.addedBy ? `${m.addedBy.name}${m.addedBy.employeeCode ? ` · ${m.addedBy.employeeCode}` : ''}` : '—'}</td>
                    <td data-label="Status"><span className={`badge ${m.isBlocked ? 'danger' : 'green'}`}>{m.isBlocked ? 'Blocked' : 'Active'}</span></td>
                    {canManage && (
                      <td data-label="Actions" className="actions-col">
                        <button className="btn sm danger-outline" onClick={() => setRemoving(m)}>Remove</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {adding && data && (
        <AddMembersDialog group={g} existing={data.members.map((m) => m.id)} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove member from group?"
        message={removing ? `Remove ${removing.name} (${removing.code}) from ${g.name}?` : ''}
        confirmLabel="Remove"
        tone="danger"
        loading={busy}
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}

export default function GroupMembers() {
  const { user } = useAuth();
  const canManage = MANAGERS.includes(user?.role);
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState(null);
  const q = useDebounce(search);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.groups.list({ page, limit: 25, q, status: 'active' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, q]);
  useEffect(() => {
    if (!group) load();
  }, [load, group]);
  useEffect(() => setPage(1), [q]);

  if (group) return <GroupDetail group={group} canManage={canManage} onBack={() => setGroup(null)} />;

  return (
    <>
      <PageHeader title="Group Members" description="Choose a group to see its members, add new members or remove existing ones." />
      <div className="panel">
        <div className="toolbar">
          <input type="search" className="toolbar-search" placeholder="Search by group code, name or leader" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search groups" />
        </div>
        {loading && !data.items.length ? (
          <Spinner label="Loading groups…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : data.items.length === 0 ? (
          <EmptyState title="No groups found" description="Create a group first under Create Group." />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead><tr><th>Group code</th><th>Group name</th><th>Branch</th><th>Leader</th><th className="num">Members</th><th className="actions-col">Actions</th></tr></thead>
                <tbody>
                  {data.items.map((g) => (
                    <tr key={g.id}>
                      <td data-label="Code"><strong>{g.code}</strong></td>
                      <td data-label="Group">{g.name}</td>
                      <td data-label="Branch">{g.branch?.name || '—'}</td>
                      <td data-label="Leader">{g.leaderName}</td>
                      <td data-label="Members" className="num">{g.memberCount}</td>
                      <td data-label="Actions" className="actions-col"><button className="btn sm primary" onClick={() => setGroup(g)}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page || page} totalPages={data.totalPages} total={data.total} limit={25} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}
