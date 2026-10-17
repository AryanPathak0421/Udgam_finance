import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { canDo } from '../config/nav.js';

const LIMIT = 25;
const ADMINS = ['super_admin', 'admin'];
const TONE = { pending: 'grey', approved: 'green', rejected: 'danger', cancelled: 'grey' };
const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN') : '—');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

// New order: the branch picks products of the head-office stock and the quantity it needs.
function NewOrder({ branches, onClose, onSaved }) {
  const toast = useToast();
  const [products, setProducts] = useState([]);
  const [branch, setBranch] = useState(branches.length === 1 ? branches[0].id : '');
  const [lines, setLines] = useState([{ product: '', quantity: '1' }]);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.productOrders.products().then((r) => setProducts(r.items)).catch(() => setProducts([]));
  }, []);

  const setLine = (i, patch) => setLines((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const total = lines.reduce((s, l) => {
    const p = products.find((x) => x.id === l.product);
    return s + (p ? p.unitPrice * (Number(l.quantity) || 0) : 0);
  }, 0);

  async function submit(e) {
    e.preventDefault();
    const found = {};
    if (!branch) found.branch = 'Select the branch';
    const filled = lines.filter((l) => l.product);
    if (!filled.length) found.items = 'Add at least one product';
    else if (filled.some((l) => !(Number(l.quantity) >= 1))) found.items = 'Enter the quantity on every line';
    else if (new Set(filled.map((l) => l.product)).size !== filled.length) found.items = 'A product is on the order twice';
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const r = await api.productOrders.create({ branch, items: filled.map((l) => ({ product: l.product, quantity: Number(l.quantity) })), note });
      toast.success(`Order ${r.order.code} sent to the admin`);
      onSaved();
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title="New product order" onClose={onClose} busy={saving} size="lg"
      footer={<><button className="btn" onClick={onClose} disabled={saving}>Cancel</button><button className="btn primary" type="submit" form="order-form" disabled={saving}>{saving ? 'Sending…' : 'Send order to admin'}</button></>}>
      <form id="order-form" onSubmit={submit} noValidate>
        <div className="form-grid">
          <FormField id="obranch" label="Branch" required error={errors.branch}>
            <select id="obranch" value={branch} onChange={(e) => { setBranch(e.target.value); setErrors((er) => ({ ...er, branch: undefined })); }} disabled={branches.length === 1}>
              <option value="">Select branch</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
          </FormField>
          <FormField id="onote" label="Note" hint="Optional">
            <input id="onote" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        </div>
        <h3 className="section-title" style={{ marginTop: 12 }}>Products</h3>
        {errors.items && <div className="field-error" role="alert">{errors.items}</div>}
        {products.length === 0 && <div className="field-hint">No head-office product is available to order yet.</div>}
        {lines.map((l, i) => {
          const p = products.find((x) => x.id === l.product);
          return (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select aria-label={`Product ${i + 1}`} style={{ flex: 1, minWidth: 220 }} value={l.product} onChange={(e) => setLine(i, { product: e.target.value })}>
                <option value="">Select product</option>
                {products.map((x) => <option key={x.id} value={x.id}>{x.category} · {x.name} · {inr(x.unitPrice)} · {x.stockQty} available</option>)}
              </select>
              <input aria-label={`Quantity ${i + 1}`} inputMode="numeric" style={{ width: 90 }} placeholder="Qty" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
              {p && <span className="muted small">{inr(p.unitPrice * (Number(l.quantity) || 0))}</span>}
              {lines.length > 1 && <button type="button" className="btn sm danger-outline" onClick={() => setLines((x) => x.filter((_, j) => j !== i))}>Remove</button>}
            </div>
          );
        })}
        <button type="button" className="btn sm" onClick={() => setLines((l) => [...l, { product: '', quantity: '1' }])}>+ Add product</button>
        <div style={{ marginTop: 10 }}><strong>Order value: {inr(total)}</strong></div>
      </form>
    </Modal>
  );
}

// What a branch bought from head office, what it paid, and what it still owes. Head office records the payments.
function PaymentsDialog({ row, isAdmin, onClose, onChanged }) {
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [items, setItems] = useState(null);
  const [form, setForm] = useState({ amount: '', paidOn: today, mode: 'bank', reference: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState(row.balance);

  const load = useCallback(() => api.productOrders.payments(row.branchId).then((r) => setItems(r.items)).catch(() => setItems([])), [row.branchId]);
  useEffect(() => {
    load();
  }, [load]);
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined }));
  };

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const r = await api.productOrders.addPayment({ ...form, branch: row.branchId });
      toast.success('Payment recorded');
      setBalance(r.balance);
      setForm((f) => ({ ...f, amount: '', reference: '' }));
      load();
      onChanged();
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(p) {
    setBusy(true);
    try {
      await api.productOrders.removePayment(p.id);
      toast.success('Payment removed');
      setBalance((b) => b + p.amount);
      load();
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`Payments — ${row.branch ? `${row.branch.code} ${row.branch.name}` : ''}`} onClose={onClose} size="lg" busy={busy} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <p style={{ marginTop: 0 }}>Purchased <strong>{inr(row.purchased)}</strong> · Paid <strong>{inr(row.purchased - balance)}</strong> · Balance <strong>{inr(balance)}</strong></p>
      {isAdmin && (
        <form onSubmit={add} noValidate className="form-grid" style={{ marginBottom: 14 }}>
          <FormField id="pamount" label="Amount received (₹)" required error={errors.amount}>
            <input id="pamount" inputMode="decimal" value={form.amount} onChange={(e) => { setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })); setErrors((er) => ({ ...er, amount: undefined })); }} />
          </FormField>
          <FormField id="ppaidOn" label="Date" error={errors.paidOn}>
            <input id="ppaidOn" type="date" max={today} value={form.paidOn} onChange={set('paidOn')} />
          </FormField>
          <FormField id="pmode" label="Mode" required error={errors.mode}>
            <select id="pmode" value={form.mode} onChange={set('mode')}>
              <option value="bank">Bank transfer</option>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="cheque">Cheque</option>
            </select>
          </FormField>
          <FormField id="pref" label="Reference no." hint="Optional">
            <input id="pref" value={form.reference} maxLength={60} onChange={set('reference')} />
          </FormField>
          <div><button className="btn primary" type="submit" disabled={busy || balance <= 0}>Record payment</button></div>
        </form>
      )}
      {items === null ? <Spinner label="Loading…" /> : items.length === 0 ? <span className="muted">No payment yet</span> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Date</th><th className="num">Amount</th><th>Mode</th><th>Reference</th><th>Recorded by</th>{isAdmin && <th className="actions-col">Actions</th>}</tr></thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td data-label="Date">{p.paidOn}</td>
                  <td data-label="Amount" className="num">{inr(p.amount)}</td>
                  <td data-label="Mode">{cap(p.mode)}</td>
                  <td data-label="Reference">{p.reference || '—'}</td>
                  <td data-label="By">{p.createdByCode || '—'}</td>
                  {isAdmin && <td data-label="Actions" className="actions-col"><button className="btn sm danger-outline" disabled={busy} onClick={() => remove(p)}>Remove</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

// Order detail. The admin can change the quantities and approve, or reject with a reason.
function OrderDialog({ id, isAdmin, canCancel, onClose, onChanged }) {
  const toast = useToast();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [qty, setQty] = useState({});
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.productOrders.get(id).then((r) => {
      setOrder(r.order);
      setQty(Object.fromEntries(r.order.items.map((i) => [i.id, String(i.requestedQty)])));
    }).catch((err) => setError(err.message));
  }, [id]);

  async function act(fn, ok) {
    setBusy(true);
    setErrors({});
    try {
      const r = await fn();
      toast.success(ok);
      setOrder(r.order);
      setRejecting(false);
      onChanged();
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const pending = order?.status === 'pending';
  const value = order ? order.items.reduce((s, i) => s + (pending && isAdmin ? Number(qty[i.id]) || 0 : i.approvedQty ?? i.requestedQty) * i.unitPrice, 0) : 0;
  return (
    <Modal open title={order ? `Order ${order.code}` : 'Order'} onClose={onClose} size="lg" busy={busy} footer={<button className="btn" onClick={onClose}>Close</button>}>
      {error ? <ErrorState message={error} /> : !order ? <Spinner label="Loading…" /> : (
        <>
          <p className="muted small" style={{ marginTop: 0 }}>
            {order.branch ? `${order.branch.code} — ${order.branch.name}` : ''} · Ordered {fmt(order.createdAt)}{order.requestedByCode ? ` by ${order.requestedByCode}` : ''} · <span className={`badge ${TONE[order.status]}`}>{cap(order.status)}</span>
            {order.decidedAt && <> · {cap(order.status)} {fmt(order.decidedAt)}{order.decidedByCode ? ` by ${order.decidedByCode}` : ''}</>}
          </p>
          {order.note && <p>Note: {order.note}</p>}
          {order.rejectReason && <div className="notice warn">Rejected: {order.rejectReason}</div>}
          {errors.items && <div className="field-error" role="alert">{errors.items}</div>}
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Category</th><th>Product</th><th className="num">Price</th><th className="num">Ordered</th><th className="num">{pending && isAdmin ? 'Approve quantity' : 'Approved'}</th></tr></thead>
              <tbody>
                {order.items.map((i) => (
                  <tr key={i.id}>
                    <td data-label="Category">{i.category}</td>
                    <td data-label="Product">{i.name}</td>
                    <td data-label="Price" className="num">{inr(i.unitPrice)}</td>
                    <td data-label="Ordered" className="num">{i.requestedQty}</td>
                    <td data-label="Approved" className="num">
                      {pending && isAdmin ? (
                        <input aria-label={`Approve quantity of ${i.name}`} inputMode="numeric" style={{ width: 90 }} value={qty[i.id] ?? ''} onChange={(e) => setQty((x) => ({ ...x, [i.id]: e.target.value.replace(/\D/g, '').slice(0, 7) }))} />
                      ) : order.status === 'approved' ? i.approvedQty : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 8 }}><strong>Value: {inr(value)}</strong></div>

          {pending && isAdmin && !rejecting && (
            <div className="row-actions" style={{ marginTop: 12 }}>
              <button className="btn primary" disabled={busy} onClick={() => act(() => api.productOrders.approve(id, order.items.map((i) => ({ id: i.id, quantity: Number(qty[i.id]) || 0 }))), 'Order approved — stock moved to the branch')}>Approve order</button>
              <button className="btn danger-outline" disabled={busy} onClick={() => setRejecting(true)}>Reject</button>
            </div>
          )}
          {pending && isAdmin && rejecting && (
            <div style={{ marginTop: 12 }}>
              <FormField id="rreason" label="Reason for rejection" required error={errors.reason}>
                <input id="rreason" value={reason} maxLength={200} autoFocus onChange={(e) => setReason(e.target.value)} />
              </FormField>
              <div className="row-actions">
                <button className="btn danger-outline" disabled={busy} onClick={() => act(() => api.productOrders.reject(id, reason.trim()), 'Order rejected')}>Reject order</button>
                <button className="btn" disabled={busy} onClick={() => setRejecting(false)}>Cancel</button>
              </div>
            </div>
          )}
          {pending && !isAdmin && canCancel && (
            <div className="row-actions" style={{ marginTop: 12 }}>
              <button className="btn danger-outline" disabled={busy} onClick={() => act(() => api.productOrders.cancel(id), 'Order cancelled')}>Cancel this order</button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

export default function ProductOrders() {
  const { user } = useAuth();
  const isAdmin = ADMINS.includes(user?.role);
  const canAdd = canDo(user, '/stock/orders', 'add');
  const canCancel = canDo(user, '/stock/orders', 'delete');
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1, pending: 0 });
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(isAdmin ? 'pending' : '');
  const [branch, setBranch] = useState('');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [balance, setBalance] = useState(null);
  const [payRow, setPayRow] = useState(null);
  const loadBalance = useCallback(() => api.productOrders.balance().then(setBalance).catch(() => setBalance(null)), []);
  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  useEffect(() => {
    api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.productOrders.list({ page, limit: LIMIT, status, branch }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, status, branch]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [status, branch]);

  const tab = (key, label) => <button key={key} className={`btn sm${status === key ? ' primary' : ''}`} onClick={() => setStatus(key)}>{label}{key === 'pending' ? ` (${data.pending})` : ''}</button>;

  return (
    <>
      <PageHeader
        title="Product Orders"
        description={isAdmin ? 'Orders sent by the branches. Approve (the quantity can be edited) to move the stock from head office to the branch, or reject.' : 'Order products from the head-office stock. The admin approves your order and may change the quantity.'}
        actions={canAdd ? <button className="btn primary" onClick={() => setCreating(true)}>+ New order</button> : null}
      />
      {balance && balance.rows.length > 0 && (
        <div className="panel" style={{ marginBottom: 14, padding: 16 }}>
          <h3 className="section-title">Purchase balance (products bought from head office)</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Branch</th><th className="num">Orders</th><th className="num">Purchased</th><th className="num">Paid</th><th className="num">Balance</th><th className="actions-col">Actions</th></tr></thead>
              <tbody>
                {balance.rows.map((r) => (
                  <tr key={r.branchId}>
                    <td data-label="Branch">{r.branch ? `${r.branch.code} — ${r.branch.name}` : '—'}</td>
                    <td data-label="Orders" className="num">{r.orders}</td>
                    <td data-label="Purchased" className="num">{inr(r.purchased)}</td>
                    <td data-label="Paid" className="num">{inr(r.paid)}</td>
                    <td data-label="Balance" className="num"><strong>{inr(r.balance)}</strong></td>
                    <td data-label="Actions" className="actions-col"><button className="btn sm" onClick={() => setPayRow(r)}>{isAdmin ? 'Payments' : 'View payments'}</button></td>
                  </tr>
                ))}
                {balance.rows.length > 1 && (
                  <tr>
                    <td><strong>Total</strong></td><td />
                    <td className="num"><strong>{inr(balance.total.purchased)}</strong></td>
                    <td className="num"><strong>{inr(balance.total.paid)}</strong></td>
                    <td className="num"><strong>{inr(balance.total.balance)}</strong></td><td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {tab('pending', 'Pending')}{tab('approved', 'Approved')}{tab('rejected', 'Rejected')}{tab('', 'All')}
          </div>
          {branches.length > 1 && (
            <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch">
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>
        {loading && !data.items.length ? <Spinner label="Loading orders…" /> : error ? <ErrorState message={error} onRetry={load} /> : data.items.length === 0 ? (
          <EmptyState title="No orders" description={status === 'pending' ? 'Nothing is waiting for approval.' : 'No orders match these filters.'} />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead><tr><th>Order</th><th>Date</th><th>Branch</th><th>Products</th><th className="num">Units</th><th className="num">Value</th><th>Status</th><th className="actions-col">Actions</th></tr></thead>
                <tbody>
                  {data.items.map((o) => (
                    <tr key={o.id}>
                      <td data-label="Order"><strong>{o.code}</strong></td>
                      <td data-label="Date">{fmt(o.createdAt)}</td>
                      <td data-label="Branch">{o.branch ? `${o.branch.code} — ${o.branch.name}` : '—'}</td>
                      <td data-label="Products">{o.items.map((i) => i.name).join(', ')}</td>
                      <td data-label="Units" className="num">{o.status === 'approved' ? o.totalApproved : o.totalRequested}</td>
                      <td data-label="Value" className="num">{inr(o.value)}</td>
                      <td data-label="Status"><span className={`badge ${TONE[o.status]}`}>{cap(o.status)}</span></td>
                      <td data-label="Actions" className="actions-col"><button className="btn sm" onClick={() => setOpenId(o.id)}>{isAdmin && o.status === 'pending' ? 'Review' : 'View'}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page || page} totalPages={data.totalPages} total={data.total} limit={LIMIT} onPage={setPage} />
          </>
        )}
      </div>
      {creating && <NewOrder branches={branches} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {openId && <OrderDialog id={openId} isAdmin={isAdmin} canCancel={canCancel} onClose={() => setOpenId(null)} onChanged={() => { load(); loadBalance(); }} />}
      {payRow && <PaymentsDialog row={payRow} isAdmin={isAdmin} onClose={() => setPayRow(null)} onChanged={loadBalance} />}
    </>
  );
}
