import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import FormField from '../../components/ui/FormField.jsx';
import Modal from '../../components/ui/Modal.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { DetailList, EmptyState, ErrorState, PageHeader, Spinner, StatusBadge } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import useDebounce from '../../hooks/useDebounce.js';
import { formatDate, formatINR, todayIso } from '../../utils/format.js';
import { NATURE_LABEL } from './AccountGroupMaster.jsx';

const LIMIT = 10;
const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
const SIDE = { debit: 'Dr', credit: 'Cr' };
const EMPTY = { name: '', group: '', type: 'debit', openingDate: '', openingAmount: '' };

const GroupOptions = ({ options }) =>
  options.map((o) => (
    <option key={o.id} value={o.id}>
      {'  '.repeat(o.depth)}{o.depth ? '↳ ' : ''}{o.name} ({NATURE_LABEL[o.nature]})
    </option>
  ));

function LedgerForm({ item, groups, onClose, onSaved }) {
  const toast = useToast();
  const isEdit = Boolean(item);
  const [form, setForm] = useState(
    item
      ? { name: item.name, group: item.groupId, type: item.type, openingDate: item.openingDate, openingAmount: String(item.openingAmount) }
      : EMPTY
  );
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  // Assets and expenses normally carry a debit balance; liabilities and income a credit one.
  function onGroupChange(e) {
    const id = e.target.value;
    const g = groups.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      group: id,
      type: !isEdit && g ? (g.nature === 'asset' || g.nature === 'expense' ? 'debit' : 'credit') : f.type,
    }));
    setErrors((er) => ({ ...er, group: undefined }));
  }

  async function submit(e) {
    e.preventDefault();
    const found = {};
    if (form.name.trim().length < 2) found.name = 'Ledger name is required';
    if (!form.group) found.group = 'Select the group this ledger belongs to';
    if (!form.openingDate) found.openingDate = 'Opening date is required';
    else if (form.openingDate > todayIso()) found.openingDate = 'Date cannot be in the future';
    const amount = String(form.openingAmount).trim();
    if (!MONEY_RE.test(amount)) found.openingAmount = 'Enter an amount (0 or more, up to 2 decimals)';
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    try {
      const payload = { ...form, name: form.name.trim(), openingAmount: amount };
      if (isEdit) await api.ledgers.update(item.id, payload);
      else await api.ledgers.create(payload);
      toast.success(isEdit ? 'Ledger updated' : 'Ledger added');
      onSaved();
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={isEdit ? `Edit ledger — ${item.name}` : 'Add ledger'}
      onClose={onClose}
      busy={saving}
      size="lg"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn primary" type="submit" form="ledger-form" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Update ledger' : 'Save ledger'}
          </button>
        </>
      }
    >
      <form id="ledger-form" onSubmit={submit} noValidate className="form-grid">
        <FormField id="name" label="Ledger name" required error={errors.name}>
          <input id="name" value={form.name} onChange={set('name')} maxLength={80} autoFocus />
        </FormField>
        <FormField id="group" label="Under group" required error={errors.group}>
          <select id="group" value={form.group} onChange={onGroupChange}>
            <option value="">Select group</option>
            <GroupOptions options={groups} />
          </select>
        </FormField>
        <FormField id="type" label="Opening balance type" required error={errors.type}>
          <div className="seg">
            {[['debit', 'Debit (Dr)'], ['credit', 'Credit (Cr)']].map(([k, l]) => (
              <label key={k} className={`seg-item${form.type === k ? ' on' : ''}`}>
                <input type="radio" name="type" value={k} checked={form.type === k} onChange={set('type')} />
                {l}
              </label>
            ))}
          </div>
        </FormField>
        <FormField id="openingAmount" label="Opening amount (₹)" required error={errors.openingAmount}>
          <input id="openingAmount" inputMode="decimal" value={form.openingAmount} onChange={set('openingAmount')} placeholder="0.00" />
        </FormField>
        <FormField id="openingDate" label="Opening date" required error={errors.openingDate}>
          <input id="openingDate" type="date" max={todayIso()} value={form.openingDate} onChange={set('openingDate')} />
        </FormField>
      </form>
    </Modal>
  );
}

export default function LedgerMaster() {
  const toast = useToast();
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1, totals: { debit: 0, credit: 0, difference: 0 } });
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [status, setStatus] = useState('');
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const q = useDebounce(search);

  useEffect(() => {
    api.accountGroups.options().then((d) => setGroups(d.items)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.ledgers.list({ page, limit: LIMIT, q, group: groupFilter, type: typeFilter, status }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, q, groupFilter, typeFilter, status]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [q, groupFilter, typeFilter, status]);

  async function run(action, success) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      const wasDelete = dialog?.type === 'delete';
      setDialog(null);
      if (wasDelete && data.items.length === 1 && page > 1) setPage(page - 1);
      else load();
    } catch (err) {
      toast.error(err.message);
      setDialog(null);
    } finally {
      setBusy(false);
    }
  }

  const closeDialog = () => setDialog(null);
  const hasFilters = q || groupFilter || typeFilter || status;
  const t = data?.totals || { debit: 0, credit: 0, difference: 0 };
  const diffVal = Number(t.difference) || 0;
  const isDiff = diffVal > 0.001;

  return (
    <>
      <PageHeader
        title="Ledger Master"
        description="Ledgers with their group, opening balance side, date and amount."
        actions={<button className="btn primary" onClick={() => setDialog({ type: 'form' })}>+ Add Ledger</button>}
      />

      <section className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card" style={{ borderLeft: '4px solid #059669' }}>
          <div>
            <div className="stat-label">Opening Debit (Dr)</div>
            <div className="stat-value" style={{ color: '#059669' }}>{formatINR(t.debit)}</div>
          </div>
        </div>
        <div className="stat-card" style={{ borderLeft: '4px solid #2563eb' }}>
          <div>
            <div className="stat-label">Opening Credit (Cr)</div>
            <div className="stat-value" style={{ color: '#2563eb' }}>{formatINR(t.credit)}</div>
          </div>
        </div>
        <div
          className="stat-card"
          style={{
            borderLeft: `4px solid ${isDiff ? '#dc2626' : '#16a34a'}`,
            background: isDiff ? '#fff5f5' : 'inherit',
          }}
        >
          <div>
            <div className="stat-label" style={{ color: isDiff ? '#b91c1c' : undefined, fontWeight: 700 }}>
              Opening Difference {isDiff ? `(${t.diffSide || (t.debit >= t.credit ? 'Dr' : 'Cr')})` : ''}
            </div>
            <div className="stat-value" style={{ color: isDiff ? '#dc2626' : '#16a34a', fontWeight: 800 }}>
              {formatINR(diffVal)} {isDiff ? (t.diffSide || (t.debit >= t.credit ? 'Dr' : 'Cr')) : '✓ Balanced'}
            </div>
          </div>
        </div>
      </section>

      {/* Difference Alert Banner */}
      {isDiff ? (
        <div
          style={{
            padding: '10px 14px',
            background: '#fee2e2',
            border: '1px solid #f87171',
            borderRadius: 8,
            color: '#991b1b',
            marginBottom: 16,
            fontSize: '0.86rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div>
            <strong>⚠️ Opening Balance Difference:</strong> Total Debit is <strong>{formatINR(t.debit)}</strong> and Total Credit is <strong>{formatINR(t.credit)}</strong>.
            Difference is <strong style={{ textDecoration: 'underline' }}>{formatINR(diffVal)} {t.diffSide || (t.debit >= t.credit ? 'Dr' : 'Cr')}</strong>.
          </div>
          <span style={{ fontSize: '0.78rem', background: '#dc2626', color: '#fff', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
            Difference: {formatINR(diffVal)}
          </span>
        </div>
      ) : (
        <div
          style={{
            padding: '8px 14px',
            background: '#ecfdf5',
            border: '1px solid #6ee7b7',
            borderRadius: 8,
            color: '#065f46',
            marginBottom: 16,
            fontSize: '0.85rem',
            fontWeight: 600,
          }}
        >
          ✓ Opening balances are perfectly balanced: Total Dr ({formatINR(t.debit)}) = Total Cr ({formatINR(t.credit)}). Difference is ₹0.00.
        </div>
      )}

      <div className="panel">
        <div className="toolbar">
          <input type="search" className="toolbar-search" placeholder="Search by ledger name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search ledgers" />
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} aria-label="Filter by group">
            <option value="">All groups</option>
            <GroupOptions options={groups} />
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by type">
            <option value="">Dr and Cr</option>
            <option value="debit">Debit (Dr)</option>
            <option value="credit">Credit (Cr)</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          {hasFilters && <button className="btn" onClick={() => { setSearch(''); setGroupFilter(''); setTypeFilter(''); setStatus(''); }}>Clear</button>}
        </div>

        {loading && !data.items.length ? (
          <Spinner label="Loading ledgers…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : data.items.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No ledgers match your filters' : 'No ledgers yet'}
            description={hasFilters ? 'Try changing or clearing the filters.' : 'Add ledgers such as Cash, bank accounts, share capital or interest income.'}
            action={!hasFilters && <button className="btn primary" onClick={() => setDialog({ type: 'form' })}>+ Add Ledger</button>}
          />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ledger name</th>
                    <th>Under group</th>
                    <th>Type</th>
                    <th>Opening date</th>
                    <th className="num">Opening amount</th>
                    <th>Status</th>
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((l) => (
                    <tr key={l.id}>
                      <td data-label="Ledger name"><strong>{l.name}</strong></td>
                      <td data-label="Under group">{l.group?.path || '—'}</td>
                      <td data-label="Type"><span className={`badge ${l.type === 'debit' ? 'green' : 'grey'}`}>{SIDE[l.type]}</span></td>
                      <td data-label="Opening date">{formatDate(l.openingDate)}</td>
                      <td data-label="Opening amount" className="num">{formatINR(l.openingAmount)} {SIDE[l.type]}</td>
                      <td data-label="Status"><StatusBadge active={l.isActive} /></td>
                      <td data-label="Actions" className="actions-col">
                        <div className="row-actions">
                          <button className="btn sm" onClick={() => setDialog({ type: 'view', item: l })}>View</button>
                          <button className="btn sm" onClick={() => setDialog({ type: 'form', item: l })}>Edit</button>
                          <button className="btn sm" onClick={() => setDialog({ type: 'status', item: l })}>{l.isActive ? 'Deactivate' : 'Activate'}</button>
                          <button className="btn sm danger-outline" onClick={() => setDialog({ type: 'delete', item: l })}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--surface-sunken, #f8fafc)', fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                    <td colSpan={4}><strong>Total Opening Balance:</strong></td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ color: '#059669', fontSize: '0.82rem' }}>Total Dr: {formatINR(t.debit)}</div>
                      <div style={{ color: '#2563eb', fontSize: '0.82rem' }}>Total Cr: {formatINR(t.credit)}</div>
                      <div style={{ color: isDiff ? '#dc2626' : '#16a34a', fontWeight: 800, marginTop: 2, fontSize: '0.84rem' }}>
                        Diff: {formatINR(diffVal)} {isDiff ? (t.diffSide || (t.debit >= t.credit ? 'Dr' : 'Cr')) : '(Balanced)'}
                      </div>
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
            <Pagination page={data.page || page} totalPages={data.totalPages} total={data.total} limit={LIMIT} onPage={setPage} />
          </>
        )}
      </div>

      {dialog?.type === 'form' && (
        <LedgerForm item={dialog.item || null} groups={groups} onClose={closeDialog} onSaved={() => { closeDialog(); load(); }} />
      )}

      <Modal
        open={dialog?.type === 'view'}
        title={dialog?.item ? dialog.item.name : ''}
        onClose={closeDialog}
        footer={<button className="btn" onClick={closeDialog}>Close</button>}
      >
        {dialog?.type === 'view' && (
          <DetailList
            items={[
              ['Ledger name', dialog.item.name],
              ['Under group', dialog.item.group?.path],
              ['Nature', dialog.item.group ? NATURE_LABEL[dialog.item.group.nature] : ''],
              ['Opening balance', `${formatINR(dialog.item.openingAmount)} ${SIDE[dialog.item.type]}`],
              ['Opening date', formatDate(dialog.item.openingDate)],
              ['Status', dialog.item.isActive ? 'Active' : 'Inactive'],
            ]}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={dialog?.type === 'status'}
        title={dialog?.item?.isActive ? 'Deactivate ledger?' : 'Activate ledger?'}
        message={dialog?.item ? (dialog.item.isActive ? `${dialog.item.name} will be hidden from new entries.` : `${dialog.item.name} will be available again.`) : ''}
        confirmLabel={dialog?.item?.isActive ? 'Deactivate' : 'Activate'}
        loading={busy}
        onConfirm={() => run(() => api.ledgers.setStatus(dialog.item.id, !dialog.item.isActive), dialog.item.isActive ? 'Ledger deactivated' : 'Ledger activated')}
        onCancel={closeDialog}
      />

      <ConfirmDialog
        open={dialog?.type === 'delete'}
        title="Delete ledger?"
        message={dialog?.item ? `Delete "${dialog.item.name}"? Its name becomes available again.` : ''}
        confirmLabel="Delete"
        tone="danger"
        loading={busy}
        onConfirm={() => run(() => api.ledgers.remove(dialog.item.id), 'Ledger deleted')}
        onCancel={closeDialog}
      />
    </>
  );
}
