import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import { ErrorState, PageHeader, Spinner } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { ROLE_LABELS } from '../../config/nav.js';

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
  const userId = params.get('user') || '';

  const [users, setUsers] = useState([]);
  const [menus, setMenus] = useState([]);
  const [target, setTarget] = useState(null); // {user, fullAccess, permissions}
  const [grid, setGrid] = useState({});
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingUser, setLoadingUser] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  useEffect(() => {
    Promise.all([api.users.list({ limit: 100, status: 'active' }), api.menuPermissions.catalogue()])
      .then(([u, c]) => {
        setUsers(u.items);
        setMenus(c.menus);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!userId) {
      setTarget(null);
      return undefined;
    }
    let live = true;
    setLoadingUser(true);
    api.menuPermissions
      .get(userId)
      .then((d) => {
        if (!live) return;
        setTarget(d);
        const g = {};
        (d.permissions || []).forEach((p) => (g[p.menu] = { view: p.view, add: p.add, edit: p.edit, delete: p.delete }));
        setGrid(g);
        setDirty(false);
      })
      .catch((err) => live && (toast.error(err.message), setTarget(null)))
      .finally(() => live && setLoadingUser(false));
    return () => {
      live = false;
    };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const map = new Map();
    menus.forEach((m) => map.set(m.group, [...(map.get(m.group) || []), m]));
    return [...map.entries()];
  }, [menus]);

  const rowFor = (key) => grid[key] || blank();
  const lockedFor = (m) => m.adminOnly; // admin-only menus can't be granted to non-admin users

  function setCell(key, action, value) {
    setGrid((g) => {
      const row = { ...(g[key] || blank()), [action]: value };
      if (action !== 'view' && value) row.view = true;
      if (action === 'view' && !value) Object.assign(row, blank());
      return { ...g, [key]: row };
    });
    setDirty(true);
  }

  function setColumn(action, value) {
    setGrid((g) => {
      const next = { ...g };
      menus.filter((m) => !lockedFor(m)).forEach((m) => {
        const row = { ...(next[m.key] || blank()), [action]: value };
        if (action !== 'view' && value) row.view = true;
        if (action === 'view' && !value) Object.assign(row, blank());
        next[m.key] = row;
      });
      return next;
    });
    setDirty(true);
  }

  async function save(permissions) {
    setSaving(true);
    try {
      const res = await api.menuPermissions.save(userId, permissions);
      toast.success(permissions === null ? 'Reset to role defaults' : 'Menu permissions saved');
      setTarget((t) => ({ ...t, permissions: res.permissions }));
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

  const editable = target && !target.fullAccess;

  return (
    <>
      <PageHeader title="Menu Permission" description="Choose which menus each user can see, and what they can do in them." />

      <div className="panel">
        <div className="field" style={{ maxWidth: 420 }}>
          <label htmlFor="permUser">User</label>
          <select
            id="permUser"
            value={userId}
            onChange={(e) => (e.target.value ? setParams({ user: e.target.value }) : setParams({}))}
          >
            <option value="">Select a user</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} — {ROLE_LABELS[u.role]}{u.rank ? ` (${u.rank.name})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!userId && <div className="notice" style={{ marginTop: 16 }}>Select a user to view or change their menu permissions.</div>}
      {loadingUser && <Spinner label="Loading permissions…" />}

      {target && !loadingUser && (
        <div className="panel" style={{ marginTop: 16 }}>
          {target.fullAccess ? (
            <div className="notice ok">
              {target.user.name} is {ROLE_LABELS[target.user.role]} and always has full access to every menu. Permissions cannot be restricted for this role.
            </div>
          ) : (
            <>
              <div className={`notice ${Array.isArray(target.permissions) ? '' : 'ok'}`}>
                {Array.isArray(target.permissions)
                  ? `${target.user.name} has custom menu permissions. Only the ticked menus are shown to this user.`
                  : `${target.user.name} currently uses the ${ROLE_LABELS[target.user.role]} role defaults. Tick menus below to give custom permissions.`}
              </div>

              <div className="table-wrap">
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
                <button className="btn" onClick={() => setResetOpen(true)} disabled={saving || !Array.isArray(target.permissions)}>
                  Reset to role defaults
                </button>
                <button className="btn primary" onClick={onSave} disabled={saving || !dirty}>
                  {saving ? 'Saving…' : 'Save permissions'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={resetOpen}
        title="Reset to role defaults?"
        message="Custom menu permissions for this user will be removed and their role defaults will apply."
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
