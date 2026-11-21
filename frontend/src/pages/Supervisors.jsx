import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';
import { PageHeader, Spinner, EmptyState, ErrorState } from '../components/ui/Feedback.jsx';
import Modal from '../components/ui/Modal.jsx';
import FormField from '../components/ui/FormField.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { branchLabel } from '../utils/staffLabel.js';

const idOf = (x) => x?.id || x?._id || x;

/** A list of choices with a search box and a tick on each (the ticked ones are the `value` set). */
function CheckList({ items, value, onChange, label, empty, render }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((i) => label(i).toLowerCase().includes(s)) : items;
  }, [items, q, label]);
  const toggle = (id) => { const n = new Set(value); if (n.has(id)) n.delete(id); else n.add(id); onChange(n); };
  return (
    <div style={{ border: '1px solid var(--border-color, #e2e8f0)', borderRadius: 8, padding: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <input type="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
        <span className="muted small">{value.size} selected</span>
        {shown.length > 0 && <button type="button" className="btn sm" onClick={() => onChange(new Set([...value, ...shown.map((i) => idOf(i))]))}>All shown</button>}
        {value.size > 0 && <button type="button" className="btn sm" onClick={() => onChange(new Set())}>Clear</button>}
      </div>
      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
        {shown.length === 0 ? <div className="muted small" style={{ padding: 6 }}>{empty}</div> : shown.map((i) => (
          <label key={idOf(i)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 2px', cursor: 'pointer', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={value.has(idOf(i))} onChange={() => toggle(idOf(i))} />
            <span>{render ? render(i) : label(i)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

const empLabel = (e) => `${e.employeeCode} — ${e.name}${e.branch?.code ? ` (${e.branch.code})` : ''}${e.designation?.name ? ` · ${e.designation.name}` : ''}`;

export default function Supervisors() {
  const toast = useToast();
  const [employees, setEmployees] = useState(null);
  const [options, setOptions] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [teamOf, setTeamOf] = useState(null); // the supervisor whose team is open
  const [branchesOf, setBranchesOf] = useState(null); // the supervisor whose branches are edited

  // create form
  const [newEmp, setNewEmp] = useState('');
  const [newBranches, setNewBranches] = useState(new Set());
  const [newTeam, setNewTeam] = useState(new Set());
  // team form
  const [addIds, setAddIds] = useState(new Set());
  const [removeIds, setRemoveIds] = useState(new Set());
  // branches form
  const [editBranches, setEditBranches] = useState(new Set());

  const load = useCallback(async () => {
    setError('');
    try {
      const [e, o] = await Promise.all([api.hr.employees({ status: 'active' }), api.hr.options()]);
      setEmployees(e.items || []);
      setOptions(o);
    } catch (err) { setError(err.message || 'Could not load'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const branches = useMemo(() => options?.branches || [], [options]);
  const isSup = (e) => (e.supervisedBranches || []).length > 0 || /supervisor/i.test(e.designation?.name || '');
  const supervisors = useMemo(() => (employees || []).filter(isSup), [employees]);
  const shownSupervisors = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? supervisors.filter((e) => [e.employeeCode, e.name, e.mobile].some((v) => String(v || '').toLowerCase().includes(s))) : supervisors;
  }, [supervisors, search]);
  // who can become a supervisor: working, not one already, and not reporting to a supervisor
  const candidates = useMemo(() => (employees || []).filter((e) => !isSup(e) && !e.supervisor), [employees]);
  // who can be put in a team: not a supervisor and has no supervisor
  const freeEmployees = useMemo(() => (employees || []).filter((e) => !isSup(e) && !e.supervisor), [employees]);

  const teamMembers = (sup) => (employees || []).filter((e) => e.supervisor && String(idOf(e.supervisor)) === String(sup.id));

  async function create() {
    if (!newEmp) return toast.error('Select the employee');
    if (!newBranches.size) return toast.error('Select at least one branch');
    setBusy(true);
    try {
      await api.hr.supervisorBranches({ supervisorId: newEmp, branchIds: [...newBranches], create: true });
      if (newTeam.size) await api.hr.supervisorAssign({ supervisorId: newEmp, employeeIds: [...newTeam] });
      toast.success('Supervisor created');
      setCreateOpen(false); setNewEmp(''); setNewBranches(new Set()); setNewTeam(new Set());
      await load();
    } catch (err) { toast.error(err.message || 'Could not create the supervisor'); } finally { setBusy(false); }
  }

  async function saveTeam() {
    if (!addIds.size && !removeIds.size) return toast.error('Tick the employees to add or to remove');
    setBusy(true);
    try {
      if (addIds.size) await api.hr.supervisorAssign({ supervisorId: teamOf.id, employeeIds: [...addIds] });
      if (removeIds.size) await api.hr.supervisorAssign({ supervisorId: null, employeeIds: [...removeIds] });
      toast.success('Team saved');
      setTeamOf(null); setAddIds(new Set()); setRemoveIds(new Set());
      await load();
    } catch (err) { toast.error(err.message || 'Could not save the team'); } finally { setBusy(false); }
  }

  async function saveBranches() {
    setBusy(true);
    try {
      await api.hr.supervisorBranches({ supervisorId: branchesOf.id, branchIds: [...editBranches] });
      toast.success('Branches saved');
      setBranchesOf(null);
      await load();
    } catch (err) { toast.error(err.message || 'Could not save the branches'); } finally { setBusy(false); }
  }

  const branchItems = branches.map((b) => ({ id: b.id, code: b.code, name: b.name }));
  const branchText = (b) => branchLabel(b);

  return (
    <>
      <PageHeader
        title="Supervisors"
        description="Make an employee a supervisor, give the branches under them, and put employees in their team."
        actions={<button type="button" className="btn primary" onClick={() => setCreateOpen(true)}>+ Create Supervisor</button>}
      />

      <div className="panel">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <input type="search" placeholder="Search code, name, mobile…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 260 }} />
          <span className="muted small">{supervisors.length} supervisor{supervisors.length === 1 ? '' : 's'}</span>
        </div>
        {error ? <ErrorState message={error} onRetry={load} /> : !employees ? <Spinner label="Loading supervisors…" /> : shownSupervisors.length === 0 ? (
          <EmptyState title="No supervisor yet" description="Use Create Supervisor to make an employee a supervisor." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Supervisor</th><th>Branches under them</th><th>Team</th><th className="actions-col">Action</th></tr></thead>
              <tbody>
                {shownSupervisors.map((s) => (
                  <tr key={s.id}>
                    <td data-label="Supervisor"><strong>{s.employeeCode}</strong> {s.name}<div className="muted small">{s.designation?.name || '—'} · {s.mobile || '—'}</div></td>
                    <td data-label="Branches">{(s.supervisedBranches || []).length ? (s.supervisedBranches || []).map((b) => <span key={b.id} className="badge grey" style={{ marginRight: 4 }}>{b.code || b.name}</span>) : <span className="muted small">No branch</span>}</td>
                    <td data-label="Team">{teamMembers(s).length}</td>
                    <td data-label="Action" className="actions-col">
                      <div className="row-actions">
                        <button type="button" className="btn sm" onClick={() => { setAddIds(new Set()); setRemoveIds(new Set()); setTeamOf(s); }}>Team</button>
                        <button type="button" className="btn sm" onClick={() => { setEditBranches(new Set((s.supervisedBranches || []).map((b) => b.id))); setBranchesOf(s); }}>Branches</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {createOpen && (
        <Modal open title="Create Supervisor" onClose={() => setCreateOpen(false)} size="lg"
          footer={<><button className="btn" onClick={() => setCreateOpen(false)}>Cancel</button><button className="btn primary" disabled={busy} onClick={create}>{busy ? 'Saving…' : 'Create Supervisor'}</button></>}>
          <FormField id="sv-emp" label="Employee" required hint="A working employee who is not a supervisor and has no supervisor over them. A new person is registered first in Employee Registration.">
            <select id="sv-emp" value={newEmp} onChange={(e) => setNewEmp(e.target.value)}>
              <option value="">Select the employee</option>
              {candidates.map((e) => <option key={e.id} value={e.id}>{empLabel(e)}</option>)}
            </select>
          </FormField>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>Branches under the supervisor *</div>
            <CheckList items={branchItems} value={newBranches} onChange={setNewBranches} label={branchText} empty="No branch" />
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>Employees in the team (optional)</div>
            <CheckList items={freeEmployees.filter((e) => String(e.id) !== String(newEmp))} value={newTeam} onChange={setNewTeam} label={empLabel} empty="No employee without a supervisor" />
          </div>
        </Modal>
      )}

      {teamOf && (
        <Modal open title={`Team of ${teamOf.employeeCode} ${teamOf.name}`} onClose={() => setTeamOf(null)} size="lg"
          footer={<><button className="btn" onClick={() => setTeamOf(null)}>Cancel</button><button className="btn primary" disabled={busy} onClick={saveTeam}>{busy ? 'Saving…' : 'Save team'}</button></>}>
          <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>In the team now (tick to remove)</div>
          <CheckList items={teamMembers(teamOf)} value={removeIds} onChange={setRemoveIds} label={empLabel} empty="No employee in the team yet" />
          <div style={{ fontWeight: 600, fontSize: '0.85rem', margin: '12px 0 4px' }}>Add employees (without a supervisor)</div>
          <CheckList items={freeEmployees.filter((e) => String(e.id) !== String(teamOf.id))} value={addIds} onChange={setAddIds} label={empLabel} empty="Every employee has a supervisor" />
        </Modal>
      )}

      {branchesOf && (
        <Modal open title={`Branches of ${branchesOf.employeeCode} ${branchesOf.name}`} onClose={() => setBranchesOf(null)} size="md"
          footer={<><button className="btn" onClick={() => setBranchesOf(null)}>Cancel</button><button className="btn primary" disabled={busy} onClick={saveBranches}>{busy ? 'Saving…' : 'Save branches'}</button></>}>
          <CheckList items={branchItems} value={editBranches} onChange={setEditBranches} label={branchText} empty="No branch" />
        </Modal>
      )}
    </>
  );
}
