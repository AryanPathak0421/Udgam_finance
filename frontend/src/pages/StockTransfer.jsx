import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import FormField from '../components/ui/FormField.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { OrderDialog } from './ProductOrders.jsx';

const LIMIT = 25;
const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN') : '—');

// The admin moves stock from one place to another: head office or a branch (for example BR01 to BR02).
export default function StockTransfer() {
  const toast = useToast();
  const [branches, setBranches] = useState([]);
  const [form, setForm] = useState({ product: '', from: '', to: '', quantity: '1', remark: '' }); // product = the product (key), from = the place it is taken from
  const [catalog, setCatalog] = useState([]); // every product in stock somewhere, with the places that have it
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  // orders sent by the branches: the admin clicks Transfer and the stock moves to the branch
  const [orderTab, setOrderTab] = useState('pending');
  const [orders, setOrders] = useState(null);
  const [openOrder, setOpenOrder] = useState(null);
  const loadOrders = useCallback(() => api.productOrders.list({ status: orderTab, limit: 50 }).then(setOrders).catch(() => setOrders({ items: [], pending: 0 })), [orderTab]);
  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {});
  }, []);
  const loadCatalog = useCallback(() => api.stockTransfers.products().then((r) => setCatalog(r.items)).catch(() => setCatalog([])), []);
  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.stockTransfers.list({ page, limit: LIMIT, q }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, q]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [q]);

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const chosen = catalog.find((p) => p.key === form.product);
  const source = chosen?.places.find((p) => p.place === form.from); // the stock entry at the place it is taken from
  const places = [{ key: 'ho', label: 'Head office' }, ...branches.map((b) => ({ key: b.id, label: `${b.code} — ${b.name}` }))];

  async function submit(e) {
    e.preventDefault();
    const found = {};
    if (!form.product) found.product = 'Select the product';
    else if (!form.from) found.from = 'Choose the place the product is taken from';
    if (!form.to) found.to = 'Choose where the stock goes';
    if (!(Number(form.quantity) >= 1)) found.quantity = 'Enter the number of units';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const r = await api.stockTransfers.create({ from: form.from, to: form.to, product: source.stockId, quantity: Number(form.quantity), remark: form.remark });
      toast.success(`${r.transfer.code}: ${r.transfer.quantity} × ${r.transfer.name} moved to ${r.transfer.to}`);
      setForm((f) => ({ ...f, product: '', from: '', quantity: '1', remark: '' }));
      loadCatalog();
      load();
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Stock Transfer" description="Orders from the branches are listed first: click Transfer to move the stock. You can also move stock by hand, for example from branch BR01 to BR02, or between head office and a branch. Only the admin can do this." />
      <div className="panel" style={{ marginBottom: 14 }}>
        <h3 className="section-title">Orders from the branches</h3>
        <p className="muted small" style={{ marginTop: 0 }}>Click Transfer on an order to move its stock from head office (or another branch) to the branch that ordered it. The order is then done.</p>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button className={`btn sm${orderTab === 'pending' ? ' primary' : ''}`} onClick={() => setOrderTab('pending')}>Waiting for transfer{orders && orderTab === 'pending' ? ` (${orders.total})` : orders?.pending ? ` (${orders.pending})` : ''}</button>
          <button className={`btn sm${orderTab === 'approved' ? ' primary' : ''}`} onClick={() => setOrderTab('approved')}>Done</button>
        </div>
        {!orders ? <Spinner label="Loading…" /> : orders.items.length === 0 ? (
          <EmptyState title={orderTab === 'pending' ? 'No order is waiting' : 'No order is done yet'} description={orderTab === 'pending' ? 'Orders sent by the branches appear here.' : 'Orders whose stock has been transferred appear here.'} />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Order</th><th>Date</th><th>Branch</th><th>Products</th><th className="num">Units</th><th className="actions-col">Actions</th></tr></thead>
              <tbody>
                {orders.items.map((o) => (
                  <tr key={o.id}>
                    <td data-label="Order"><strong>{o.code}</strong>{orderTab === 'approved' && <div><span className="badge green">Transferred</span></div>}</td>
                    <td data-label="Date">{fmt(orderTab === 'approved' ? o.decidedAt : o.createdAt)}{orderTab === 'approved' && o.decidedByCode && <div className="muted small">by {o.decidedByCode}</div>}</td>
                    <td data-label="Branch">{o.branch ? `${o.branch.code} — ${o.branch.name}` : '—'}</td>
                    <td data-label="Products">{o.items.map((i) => `${i.name} × ${orderTab === 'approved' ? i.approvedQty : i.requestedQty}`).join(', ')}</td>
                    <td data-label="Units" className="num">{orderTab === 'approved' ? o.totalApproved : o.totalRequested}</td>
                    <td data-label="Actions" className="actions-col">
                      <button className={`btn sm${orderTab === 'pending' ? ' primary' : ''}`} onClick={() => setOpenOrder(o.id)}>{orderTab === 'pending' ? 'Transfer' : 'View'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {openOrder && <OrderDialog id={openOrder} isAdmin transferView onClose={() => setOpenOrder(null)} onChanged={() => { loadOrders(); load(); loadCatalog(); }} />}

      <form className="panel" style={{ padding: 16, marginBottom: 14 }} onSubmit={submit} noValidate>
        <div className="form-grid">
          <FormField id="tproduct" label="Product" required error={errors.product} hint={catalog.length ? undefined : 'No product is in stock at head office or any branch'}>
            <select id="tproduct" value={form.product} onChange={(e) => { setForm((f) => ({ ...f, product: e.target.value, from: '', to: '' })); setErrors((x) => ({ ...x, product: undefined })); }}>
              <option value="">Select product</option>
              {catalog.map((p) => <option key={p.key} value={p.key}>{p.category} · {p.name} · {p.places.reduce((t, x) => t + x.stockQty, 0)} in stock</option>)}
            </select>
          </FormField>
          <FormField id="tfrom" label="Take from" required error={errors.from} hint={chosen ? 'Only the places that have this product' : 'Choose the product first'}>
            <select id="tfrom" value={form.from} disabled={!chosen} onChange={(e) => { setForm((f) => ({ ...f, from: e.target.value, to: f.to === e.target.value ? '' : f.to })); setErrors((x) => ({ ...x, from: undefined })); }}>
              <option value="">Select place</option>
              {(chosen?.places || []).map((p) => <option key={p.place} value={p.place}>{p.label} · {p.stockQty} in stock</option>)}
            </select>
          </FormField>
          <FormField id="tto" label="Move to" required error={errors.to}>
            <select id="tto" value={form.to} onChange={set('to')}>
              <option value="">Select place</option>
              {places.filter((p) => p.key !== form.from).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </FormField>
          <FormField id="tqty" label="Units" required error={errors.quantity} hint={source ? `Up to ${source.stockQty} · value ${inr(source.unitPrice * (Number(form.quantity) || 0))}. The due to head office moves with the goods when a branch gives to another branch.` : undefined}>
            <input id="tqty" inputMode="numeric" value={form.quantity} onChange={(e) => { setForm((f) => ({ ...f, quantity: e.target.value.replace(/\D/g, '').slice(0, 6) })); setErrors((x) => ({ ...x, quantity: undefined })); }} />
          </FormField>
          <FormField id="tremark" label="Remark" className="span-2"><input id="tremark" value={form.remark} maxLength={200} onChange={set('remark')} /></FormField>
        </div>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Moving…' : 'Transfer stock'}</button>
      </form>

      <div className="panel">
        <h3 className="section-title">Transfers made by hand</h3>
        <div className="toolbar"><input type="search" className="toolbar-search" placeholder="Search transfer no or product" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search transfers" /></div>
        {loading && !data ? <Spinner label="Loading…" /> : error ? <ErrorState message={error} onRetry={load} /> : data.items.length === 0 ? (
          <EmptyState title="No transfer yet" description="Stock moved between places appears here." />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead><tr><th>No</th><th>Date</th><th>Product</th><th>From</th><th>To</th><th className="num">Units</th><th className="num">Value</th><th>By</th></tr></thead>
                <tbody>
                  {data.items.map((t) => (
                    <tr key={t.id}>
                      <td data-label="No"><strong>{t.code}</strong></td>
                      <td data-label="Date">{fmt(t.date)}</td>
                      <td data-label="Product">{t.category} · {t.name}{t.remark && <div className="muted small">{t.remark}</div>}</td>
                      <td data-label="From">{t.from}</td>
                      <td data-label="To">{t.to}</td>
                      <td data-label="Units" className="num">{t.quantity}</td>
                      <td data-label="Value" className="num">{inr(t.value)}</td>
                      <td data-label="By">{t.byCode || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page || page} totalPages={data.totalPages} total={data.total} limit={LIMIT} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}
