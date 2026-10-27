import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import { ErrorState, PageHeader, Spinner } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';

const ACTIONS = [
  ['view', 'View'],
  ['add', 'Add'],
  ['edit', 'Edit'],
  ['delete', 'Delete'],
];
const blank = () => ({ view: false, add: false, edit: false, delete: false });

export default function MenuPermission() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const rankId = params.get('rank') || '';

  const [ranks, setRanks] = useState([]);
  const [menus, setMenus] = useState([]);
  const [target, setTarget] = useState(null); // {rank, permissions}
  const [grid, setGrid] = useState({});
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingRank, setLoadingRank] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [copySource, setCopySource] = useState('');

  useEffect(() => {
    Promise.all([api.ranks.list({ limit: 100 }), api.menuPermissions.catalogue()])
      .then(([r, c]) => {
        setRanks(r.items);
        setMenus(c.menus);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!rankId) {
      setTarget(null);
      return undefined;
    }
    let live = true;
    setLoadingRank(true);
    api.menuPermissions
      .get(rankId)
      .then((d) => {
        if (!live) return;
        setTarget(d);
        const g = {};
        (d.permissions || []).forEach((p) => (g[p.menu] = { view: p.view, add: p.add, edit: p.edit, delete: p.delete }));
        setGrid(g);
        setDirty(false);
      })
      .catch((err) => live && (toast.error(err.message), setTarget(null)))
      .finally(() => live && setLoadingRank(false));
    return () => {
      live = false;
    };
  }, [rankId]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const map = new Map();
    menus.forEach((m) => map.set(m.group, [...(map.get(m.group) || []), m]));
    return [...map.entries()];
  }, [menus]);

  const rowFor = (key) => grid[key] || blank();
  // Admin-only menus can't be granted through a rank.
  const lockedFor = (m) => m.adminOnly;

  function applyCell(row, action, value) {
    const next = { ...row, [action]: value };
    if (action !== 'view' && value) next.view = true;
    if (action === 'view' && !value) Object.assign(next, blank());
    return next;
  }

  function setCell(key, action, value) {
    setGrid((g) => ({ ...g, [key]: applyCell(g[key] || blank(), action, value) }));
    setDirty(true);
  }

  // Fills the grid with the menus of another rank (e.g. the rank of the other branch's staff); nothing is saved until Save permissions is pressed.
  async function copyFromRank() {
    if (!copySource) return;
    try {
      const d = await api.menuPermissions.get(copySource);
      if (!Array.isArray(d.permissions) || !d.permissions.length) { toast.error(`"${d.rank.name}" has no ticked menus to copy`); return; }
      const g = {};
      d.permissions.forEach((p) => { g[p.menu] = { view: p.view, add: p.add, edit: p.edit, delete: p.delete }; });
      setGrid(g);
      setDirty(true);
      toast.success(`Menus of "${d.rank.name}" copied. Press Save permissions to give them to ${target.rank.name}.`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  function setColumn(action, value) {
    setGrid((g) => {
      const next = { ...g };
      menus.filter((m) => !lockedFor(m)).forEach((m) => {
        next[m.key] = applyCell(next[m.key] || blank(), action, value);
      });
      return next;
    });
    setDirty(true);
  }

  async function save(permissions) {
    setSaving(true);
    try {
      const res = await api.menuPermissions.save(rankId, permissions);
      toast.success(permissions === null ? 'Reset to role defaults' : 'Menu permissions saved');
      setTarget((t) => ({ ...t, permissions: res.permissions }));
      if (permissions !== null) toast.success('The users of this rank see the new menus within 30 seconds, or when they open any menu.');
      if (permissions === null) setGrid({});
      setDirty(false);
      setResetOpen(false);
    } catch (err) {
      toast.error(err.message);
      setResetOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const onSave = () =>
    save(
      menus
        .filter((m) => !lockedFor(m))
        .map((m) => ({ menu: m.key, ...rowFor(m.key) }))
        .filter((p) => p.view || p.add || p.edit || p.delete)
    );

  if (loading) return <Spinner label="Loading…" />;
  if (error) return <ErrorState message={error} />;

  const hasCustom = target && Array.isArray(target.permissions);

  return (
    <>
      <PageHeader
        title="Menu Permission"
        description="Menu access is set per rank. Every user holding a rank gets that rank's menus."
      />

      <div className="panel">
        <div className="field" style={{ maxWidth: 420 }}>
          <label htmlFor="permRank">Rank</label>
          <select
            id="permRank"
            value={rankId}
            onChange={(e) => (e.target.value ? setParams({ rank: e.target.value }) : setParams({}))}
          >
            <option value="">Select a rank</option>
            {ranks.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} (Level {r.level}){r.isActive ? '' : ' — inactive'}
              </option>
            ))}
          </select>
        </div>
        {ranks.length === 0 && <div className="field-hint">No ranks yet. Create ranks in Rank Master first.</div>}
      </div>

      {!rankId && ranks.length > 0 && (
        <div className="notice" style={{ marginTop: 16 }}>
          Select a rank to view or change its menu permissions.
        </div>
      )}
      {loadingRank && <Spinner label="Loading permissions…" />}

      {target && !loadingRank && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className={`notice ${hasCustom ? '' : 'ok'}`}>
            {hasCustom
              ? `${target.rank.userCount} user${target.rank.userCount === 1 ? '' : 's'} with the rank "${target.rank.name}" see only the ticked menus.`
              : `"${target.rank.name}" has no custom permissions, so its ${target.rank.userCount} user${target.rank.userCount === 1 ? '' : 's'} use their role defaults. Tick menus below to set rank permissions.`}{' '}
            Admin and Super Admin users always have full access.
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '10px 0' }}>
            <label htmlFor="copyRank" className="small muted">Same menus as another rank:</label>
            <select id="copyRank" value={copySource} onChange={(e) => setCopySource(e.target.value)} aria-label="Copy the menus of this rank">
              <option value="">Select a rank</option>
              {ranks.filter((r) => r.id !== rankId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <button type="button" className="btn sm" onClick={copyFromRank} disabled={!copySource}>Copy menus</button>
          </div>
          {(target.users || []).length > 0 && (
            <div className="small" style={{ margin: '10px 0' }}>
              <strong>Users who get these menus ({target.users.length}):</strong>{' '}
              {target.users.map((u) => `${u.name}${u.employeeCode ? ` (${u.employeeCode})` : ''}${u.isActive ? '' : ' — login stopped'}`).join(', ')}
            </div>
          )}
          {(target.usersWithoutRank || []).length > 0 && (
            <div className="notice" style={{ margin: '10px 0' }}>
              <strong>{target.usersWithoutRank.length} active staff member{target.usersWithoutRank.length === 1 ? ' has' : 's have'} no rank</strong>, so they do not get any menu ticked here
              ({target.usersWithoutRank.slice(0, 8).map((u) => `${u.name}${u.employeeCode ? ` (${u.employeeCode})` : ''}`).join(', ')}{target.usersWithoutRank.length > 8 ? ' …' : ''}). Give them a rank in User Master.
            </div>
          )}

          <div className="table-wrap perm-wrap">
            <table className="data-table perm-table">
              <thead>
                <tr>
                  <th>Menu</th>
                  {ACTIONS.map(([k, label]) => (
                    <th key={k} className="perm-col">
                      {label}
                      <div className="perm-bulk">
                        <button type="button" className="link-btn" onClick={() => setColumn(k, true)}>All</button>
                        <button type="button" className="link-btn" onClick={() => setColumn(k, false)}>None</button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map(([group, items]) => (
                  <PermGroup key={group} group={group} items={items} rowFor={rowFor} lockedFor={lockedFor} onChange={setCell} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="form-actions">
            <button className="btn" onClick={() => setResetOpen(true)} disabled={saving || !hasCustom}>
              Reset to role defaults
            </button>
            <button className="btn primary" onClick={onSave} disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save permissions'}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={resetOpen}
        title="Reset to role defaults?"
        message="Custom menu permissions for this rank will be removed. Its users will get their role defaults."
        confirmLabel="Reset"
        loading={saving}
        onConfirm={() => save(null)}
        onCancel={() => setResetOpen(false)}
      />
    </>
  );
}

function PermGroup({ group, items, rowFor, lockedFor, onChange }) {
  return (
    <>
      <tr className="perm-group">
        <td colSpan={5}>{group}</td>
      </tr>
      {items.map((m) => {
        const row = rowFor(m.key);
        const locked = lockedFor(m);
        return (
          <tr key={m.key}>
            <td>
              {m.label}
              {locked && <span className="badge grey" style={{ marginLeft: 8 }}>Admin only</span>}
            </td>
            {ACTIONS.map(([k, label]) => (
              <td key={k} className="perm-col">
                <input
                  type="checkbox"
                  aria-label={`${label} ${m.label}`}
                  checked={locked ? false : row[k]}
                  disabled={locked}
                  onChange={(e) => onChange(m.key, k, e.target.checked)}
                />
              </td>
            ))}
          </tr>
        );
      })}
    </>
  );
}
