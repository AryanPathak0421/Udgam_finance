import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import FormField from '../components/ui/FormField.jsx';
import { EmptyState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { TransferHistory } from './GroupTransfer.jsx';

// Group Master → Member Group Transfer: move members from one group to another.
export default function MemberGroupTransfer() {
  const toast = useToast();
  const [fromSearch, setFromSearch] = useState('');
  const [fromList, setFromList] = useState([]);
  const [fromId, setFromId] = useState('');
  const [members, setMembers] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [targets, setTargets] = useState([]);
  const [toId, setToId] = useState('');
  const [toSearch, setToSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const fq = useDebounce(fromSearch);
  const tq = useDebounce(toSearch);

  useEffect(() => {
    api.groups.list({ q: fq, limit: 25 }).then((r) => setFromList(r.items)).catch(() => setFromList([]));
  }, [fq]);

  const loadMembers = useCallback(async () => {
    if (!fromId) { setMembers(null); return; }
    setLoading(true);
    try {
      setMembers(await api.groupTransfer.groupMembers(fromId));
      setPicked(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fromId]);
  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    if (!fromId) { setTargets([]); return; }
    api.groupTransfer.targetGroups({ from: fromId, q: tq }).then((r) => setTargets(r.items)).catch(() => setTargets([]));
  }, [fromId, tq, refreshKey]);

  const movable = (members?.items || []).filter((m) => !m.reason);
  const target = targets.find((t) => t.id === toId);
  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  function start() {
    setError('');
    if (!picked.size) return setError('Select the members to move');
    if (!toId) return setError('Select the group they move to');
    setConfirm(true);
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const r = await api.groupTransfer.transferMembers({ fromGroup: fromId, toGroup: toId, memberIds: [...picked] });
      toast.success(`${r.moved} member${r.moved === 1 ? '' : 's'} moved from ${r.from.code} to ${r.to.code}${r.loansMoved ? ` (with ${r.loansMoved} running loan${r.loansMoved === 1 ? '' : 's'})` : ''}`);
      setConfirm(false);
      setToId('');
      setRefreshKey((k) => k + 1);
      loadMembers();
    } catch (err) {
      setConfirm(false);
      setError(err.errors?.memberIds || err.errors?.toGroup || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Member Group Transfer" description="Move members from one group to another group of the same branch. A member whose loan is running moves with it: the loan, its EMI collection and its record go to the new group. The move is shown in the member's Borrower Synopsis. Only a member whose loan is applied for and not paid out yet has to wait." />
      <div className="panel">
        <div className="form-grid">
          <FormField id="mtype" label="Transfer type"><input id="mtype" value="Group" disabled readOnly /></FormField>
          <FormField id="mfrom" label="From group" required>
            <input type="search" placeholder="Search group code or name" value={fromSearch} onChange={(e) => setFromSearch(e.target.value)} aria-label="Search from group" style={{ marginBottom: 6 }} />
            <select id="mfrom" value={fromId} onChange={(e) => { setFromId(e.target.value); setToId(''); setError(''); }}>
              <option value="">Select group</option>
              {fromList.map((g) => <option key={g.id} value={g.id}>{g.code} — {g.name} ({g.memberCount} members)</option>)}
            </select>
          </FormField>
        </div>

        {fromId && (loading && !members ? <Spinner label="Loading members…" /> : !members?.items.length ? <EmptyState title="This group has no members" /> : (
          <>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="data-table">
                <thead><tr><th style={{ width: 40 }}><input type="checkbox" aria-label="Select all members" checked={movable.length > 0 && picked.size === movable.length} disabled={!movable.length} onChange={(e) => setPicked(e.target.checked ? new Set(movable.map((m) => m.id)) : new Set())} /></th><th>Member</th><th>Can move?</th></tr></thead>
                <tbody>
                  {members.items.map((m) => (
                    <tr key={m.id} style={m.reason ? { opacity: 0.6 } : undefined}>
                      <td><input type="checkbox" aria-label={`Select ${m.code}`} checked={picked.has(m.id)} disabled={Boolean(m.reason)} onChange={() => toggle(m.id)} /></td>
                      <td data-label="Member"><strong>{m.code}</strong> {m.name}</td>
                      <td data-label="Can move?">{m.reason ? <span className="muted small">{m.reason}</span> : <><span className="badge green">Yes</span>{m.runningLoan && <span className="muted small" style={{ marginLeft: 8 }}>running loan moves with the member</span>}</>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
              <FormField id="mto" label="To group" required>
                <input type="search" placeholder="Search group code or name" value={toSearch} onChange={(e) => setToSearch(e.target.value)} aria-label="Search to group" style={{ marginBottom: 6 }} />
                <select id="mto" value={toId} onChange={(e) => { setToId(e.target.value); setError(''); }}>
                  <option value="">Select group</option>
                  {targets.map((g) => <option key={g.id} value={g.id} disabled={g.full}>{g.code} — {g.name} ({g.members} members{g.full ? ', full' : ''})</option>)}
                </select>
              </FormField>
              <button className="btn primary" onClick={start} disabled={busy}>Transfer{picked.size ? ` ${picked.size} member${picked.size === 1 ? '' : 's'}` : ''}</button>
            </div>
            <div className="muted small">Only active groups of the same branch are listed.</div>
          </>
        ))}
        {error && <div className="field-error" role="alert" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      <TransferHistory type="member" refreshKey={refreshKey} />

      <ConfirmDialog
        open={confirm}
        title="Move members to another group?"
        message={`${picked.size} member${picked.size === 1 ? '' : 's'} of ${members?.group?.code || ''} will be moved to ${target ? `${target.code} — ${target.name}` : ''}${(members?.items || []).filter((m) => picked.has(m.id) && m.runningLoan).length ? `, together with ${(members?.items || []).filter((m) => picked.has(m.id) && m.runningLoan).length} running loan(s)` : ''}.`}
        confirmLabel="Move"
        loading={busy}
        onConfirm={submit}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}
