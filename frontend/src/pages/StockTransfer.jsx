import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import FormField from '../components/ui/FormField.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';

const LIMIT = 25;
const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN') : '—');

// The admin moves stock from one place to another: head office or a branch (for example BR01 to BR02).
export default function StockTransfer() {
  const toast = useToast();
  const [branches, setBranches] = useState([]);
  const [form, setForm] = useState({ from: 'ho', to: '', product: '', quantity: '1', remark: '' });
  const [stock, setStock] = useState([]);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const q = useDebounce(search);

  useEffect(() => {
    api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {});
  }, []);
  useEffect(() => {
    setStock([]);
    api.stockTransfers.stock(form.from).then((r) => setStock(r.items)).catch(() => setStock([]));
  }, [form.from]);
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
  const product = stock.find((p) => p.id === form.product);
  const places = [{ key: 'ho', label: 'Head office' }, ...branches.map((b) => ({ key: b.id, label: `${b.code} — ${b.name}` }))];

  async function submit(e) {
    e.preventDefault();
    const found = {};
    if (!form.to) found.to = 'Choose where the stock goes';
    if (!form.product) found.product = 'Select the product';
    if (!(Number(form.quantity) >= 1)) found.quantity = 'Enter the number of units';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const r = await api.stockTransfers.create({ ...form, quantity: Number(form.quantity) });
      toast.success(`${r.transfer.code}: ${r.transfer.quantity} × ${r.transfer.name} moved to ${r.transfer.to}`);
      setForm((f) => ({ ...f, product: '', quantity: '1', remark: '' }));
      api.stockTransfers.stock(form.from).then((x) => setStock(x.items)).catch(() => {});
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
      <PageHeader title="Stock Transfer" description="Move stock from one place to another, for example from branch BR01 to BR02, or between head office and a branch. Only the admin can do this." />
      <form className="panel" style={{ padding: 16, marginBottom: 14 }} onSubmit={submit} noValidate>
        <div className="form-grid">
          <FormField id="tfrom" label="Move from" required>
            <select id="tfrom" value={form.from} onChange={(e) => { setForm((f) => ({ ...f, from: e.target.value, product: '' })); }}>
              {places.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </FormField>
          <FormField id="tto" label="Move to" required error={errors.to}>
            <select id="tto" value={form.to} onChange={set('to')}>
              <option value="">Select place</option>
              {places.filter((p) => p.key !== form.from).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </FormField>
          <FormField id="tproduct" label="Product" required error={errors.product} hint={stock.length ? undefined : 'Nothing is in stock at this place'}>
            <select id="tproduct" value={form.product} onChange={set('product')}>
              <option value="">Select product</option>
              {stock.map((p) => <option key={p.id} value={p.id}>{p.category} · {p.name} · {p.stockQty} in stock</option>)}
            </select>
          </FormField>
          <FormField id="tqty" label="Units" required error={errors.quantity} hint={product ? `Up to ${product.stockQty} · value ${inr(product.unitPrice * (Number(form.quantity) || 0))}` : undefined}>
            <input id="tqty" inputMode="numeric" value={form.quantity} onChange={(e) => { setForm((f) => ({ ...f, quantity: e.target.value.replace(/\D/g, '').slice(0, 6) })); setErrors((x) => ({ ...x, quantity: undefined })); }} />
          </FormField>
          <FormField id="tremark" label="Remark" className="span-2"><input id="tremark" value={form.remark} maxLength={200} onChange={set('remark')} /></FormField>
        </div>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Moving…' : 'Transfer stock'}</button>
      </form>

      <div className="panel">
        <h3 className="section-title">Transfers</h3>
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
