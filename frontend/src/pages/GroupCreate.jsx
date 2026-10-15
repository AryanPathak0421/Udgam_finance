import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import GroupFields, { EMPTY_GROUP, MEETING_LABEL, collectionLabel, formatTime, validateGroup } from '../components/GroupFields.jsx';
import { DetailList, EmptyState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';

const ADMINS = ['super_admin', 'admin'];

// Picks members of a branch that are free to join a group.
export function MemberPicker({ branch, selected, onToggle, exclude = [] }) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const q = useDebounce(search);

  useEffect(() => {
    if (!branch) return undefined;
    let live = true;
    setLoading(true);
    setError('');
    api.groups
      .memberCandidates({ branch, q })
      .then((r) => live && setItems(r.items))
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [branch, q]);

  const shown = items.filter((m) => !exclude.includes(m.id));
  const isSel = (id) => selected.some((x) => x.id === id);
  return (
    <div>
      <input type="search" className="toolbar-search" placeholder="Search by member code, name or mobile" value={search}
        onChange={(e) => setSearch(e.target.value)} aria-label="Search members" style={{ marginBottom: 10, width: '100%' }} />
      {error && <div className="field-error">{error}</div>}
      {loading && !shown.length ? (
        <Spinner label="Loading members…" />
      ) : shown.length === 0 ? (
        <EmptyState title="No free members found" description="Only members of this branch who are not blocked and not in another group can be added." />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th style={{ width: 40 }} /><th>Member code</th><th>Name</th><th>Mobile</th></tr></thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.id} onClick={() => onToggle(m)} style={{ cursor: 'pointer' }}>
                  <td><input type="checkbox" checked={isSel(m.id)} onChange={() => onToggle(m)} aria-label={`Select ${m.code}`} /></td>
                  <td data-label="Code"><strong>{m.code}</strong></td>
                  <td data-label="Name">{m.name}</td>
                  <td data-label="Mobile">{m.mobile}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const STEPS = ['Group details', 'Add members', 'Confirm & submit'];

export default function GroupCreate() {
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = ADMINS.includes(user?.role);

  const [step, setStep] = useState(0);
  const [branches, setBranches] = useState([]);
  const [form, setForm] = useState(EMPTY_GROUP);
  const [errors, setErrors] = useState({});
  const [members, setMembers] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.groups.branchOptions().then((r) => {
      setBranches(r.items);
      if (r.items.length === 1) setForm((f) => ({ ...f, branch: r.items[0].id }));
    }).catch(() => {});
  }, []);

  // Members belong to one branch: changing the branch clears the selection.
  useEffect(() => setMembers([]), [form.branch]);

  const toggle = useCallback((m) => {
    setMembers((list) => (list.some((x) => x.id === m.id) ? list.filter((x) => x.id !== m.id) : [...list, m]));
  }, []);

  function next() {
    const found = validateGroup(form, { isEdit: false });
    setErrors(found);
    if (Object.keys(found).length) return toast.error('Please correct the highlighted fields');
    setStep(1);
  }

  async function submit() {
    setSaving(true);
    try {
      const r = await api.groups.create({ ...form, memberIds: members.map((m) => m.id) });
      toast.success(`Group created — ${r.group.code}`);
      navigate('/group-master/list');
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
      if (Object.keys(err.errors || {}).some((k) => k !== 'members')) setStep(0);
      else setStep(1);
    } finally {
      setSaving(false);
    }
  }

  const branch = branches.find((b) => b.id === form.branch);
  return (
    <>
      <PageHeader title="Create Group" description="Fill the group details, add members, then confirm and submit." />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {STEPS.map((s, i) => (
          <span key={s} className={`badge ${i === step ? 'green' : 'grey'}`}>{i + 1}. {s}</span>
        ))}
      </div>

      {step === 0 && (
        <div className="panel" style={{ padding: 18 }}>
          <GroupFields form={form} setForm={setForm} errors={errors} setErrors={setErrors} branches={branches} isAdmin={isAdmin} isEdit={false} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn primary" onClick={next}>Next: add members</button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="panel" style={{ padding: 18 }}>
          <h3 className="section-title">Add members — {branch ? branch.name : ''}</h3>
          {errors.members && <div className="field-error" role="alert">{errors.members}</div>}
          <MemberPicker branch={form.branch} selected={members} onToggle={toggle} />
          <p className="muted small">{members.length} member{members.length === 1 ? '' : 's'} selected. You can also add or remove members later from Group Members.</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
            <button className="btn" onClick={() => setStep(0)}>Back</button>
            <button className="btn primary" onClick={() => setStep(2)}>Next: confirm</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="panel" style={{ padding: 18 }}>
          <h3 className="section-title">Confirm</h3>
          <DetailList
            items={[
              ['Group name', form.name], ['Branch', branch ? `${branch.code} — ${branch.name}` : ''],
              ['Opening date', form.openingDate], ['Employee ID', form.employeeCode],
              ['Group leader', form.leaderName], ['Leader mobile', form.leaderMobile],
              ['Meeting type', MEETING_LABEL[form.meetingType]], ['Collection day', collectionLabel({ meetingType: form.meetingType, collectionDay: Number(form.collectionDay) })],
              ['Meeting time', formatTime(form.meetingTime)], ['Members', String(members.length)],
            ]}
          />
          {members.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="data-table">
                <thead><tr><th>Member code</th><th>Name</th><th>Mobile</th></tr></thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id}><td data-label="Code"><strong>{m.code}</strong></td><td data-label="Name">{m.name}</td><td data-label="Mobile">{m.mobile}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
            <button className="btn" onClick={() => setStep(1)} disabled={saving}>Back</button>
            <button className="btn primary" onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Confirm & submit'}</button>
          </div>
        </div>
      )}
    </>
  );
}
