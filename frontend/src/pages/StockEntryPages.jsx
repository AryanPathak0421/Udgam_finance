import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { Refresh, Summary, useLoad, inr, dmy, today } from './HrPages.jsx';
import { todayIso } from '../utils/format.js';

const monthStart = () => `${todayIso().slice(0, 7)}-01`;
const Dates = ({ from, setFrom, to, setTo }) => (
  <>
    <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>From <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /></label>
    <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>To <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" /></label>
  </>
);
/** Head office (admin) or one of the branches. */
function PlaceSelect({ value, onChange, isAdmin }) {
  const [branches, setBranches] = useState([]);
  useEffect(() => { api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {}); }, []);
  if (!isAdmin && branches.length < 2) return null;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Place">
      <option value="">{isAdmin ? 'Head office and all branches' : 'All my branches'}</option>
      {isAdmin && <option value="ho">Head office</option>}
      {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
    </select>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Product stock entry
export function StockEntry() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);
  const [place, setPlace] = useState('');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 300);
  const list = useLoad(() => api.stockEntries.list({ branch: place, from, to, q }), [place, from, to, q]);
  const [adding, setAdding] = useState(false);
  const [products, setProducts] = useState([]);
  const [f, setF] = useState({});
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  async function openAdd() {
    setF({ product: '', quantity: '', entryDate: today(), purchaseRate: '', supplier: '', billNo: '', remark: '' });
    setErrors({});
    setAdding(true);
    try { setProducts((await api.stockEntries.products()).items); } catch (err) { toast.error(err.message); }
  }
  async function save() {
    setBusy(true);
    setErrors({});
    try {
      const r = await api.stockEntries.create(f);
      toast.success(`${r.item.code}: ${r.item.quantity} unit${r.item.quantity === 1 ? '' : 's'} added — stock is now ${r.item.stockAfter}`);
      setAdding(false);
      list.load();
    } catch (err) { setErrors(err.errors || {}); toast.error(err.message); } finally { setBusy(false); }
  }
  async function cancel() {
    setBusy(true);
    setReasonError('');
    try { await api.stockEntries.cancel(cancelling.id, reason); toast.success('Entry cancelled, the units are taken out of the stock'); setCancelling(null); setReason(''); list.load(); } catch (err) { setReasonError(err.errors?.reason || err.message); } finally { setBusy(false); }
  }
  const items = list.data?.items || [];
  const chosen = products.find((p) => p.id === f.product);
  return (
    <>
      <PageHeader title="Product Stock Entry" description="Record the stock that is received: pick the product, enter the quantity and the bill. The units are added to the stock of the product at once (head office or the branch that holds it)." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <PlaceSelect value={place} onChange={setPlace} isAdmin={isAdmin} />
          <Dates from={from} setFrom={setFrom} to={to} setTo={setTo} />
          <input type="search" placeholder="Search product, supplier, bill" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" style={{ minWidth: 200 }} />
          <Refresh onClick={list.load} loading={list.loading} />
          <button className="btn primary" onClick={openAdd}>New stock entry</button>
        </div>
        {list.loading && !list.data ? <Spinner label="Loading…" /> : list.error ? <ErrorState message={list.error} onRetry={list.load} /> : items.length === 0 ? <EmptyState title="No stock entry" description="No stock was entered for these dates." /> : (
          <>
            <Summary items={[['Entries', list.data.summary.entries], ['Units received', list.data.summary.units], ['Bill amount', inr(list.data.summary.amount)]]} />
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Entry</th><th>Date</th><th>Product</th><th>Held at</th><th className="num">Quantity</th><th className="num">Stock before → after</th><th>Bill</th><th>Status</th>{isAdmin && <th />}</tr></thead>
                <tbody>
                  {items.map((e) => (
                    <tr key={e.id}>
                      <td data-label="Entry"><strong>{e.code}</strong><div className="muted small">{e.by}</div></td><td data-label="Date">{dmy(e.entryDate)}</td>
                      <td data-label="Product">{e.product.name}<div className="muted small">{e.product.code}</div></td><td data-label="Held at">{e.place}</td><td data-label="Quantity" className="num"><strong>{e.quantity}</strong></td>
                      <td data-label="Stock" className="num">{e.stockBefore} → {e.stockAfter}</td>
                      <td data-label="Bill">{e.supplier || '—'}{e.billNo && <div className="muted small">Bill {e.billNo}</div>}{e.amount !== null && <div className="muted small">{inr(e.purchaseRate)} × {e.quantity} = {inr(e.amount)}</div>}</td>
                      <td data-label="Status"><span className={`badge ${e.status === 'active' ? 'green' : 'grey'}`}>{e.status === 'active' ? 'Received' : 'Cancelled'}</span>{e.cancelReason && <div className="muted small">{e.cancelReason}</div>}</td>
                      {isAdmin && <td>{e.status === 'active' && <button className="btn sm danger-outline" onClick={() => { setCancelling(e); setReason(''); setReasonError(''); }}>Cancel</button>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {adding && (
        <Modal open title="New product stock entry" onClose={() => setAdding(false)} busy={busy}
          footer={<><button className="btn" onClick={() => setAdding(false)} disabled={busy}>Close</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Add to stock'}</button></>}>
          <div className="form-grid">
            <FormField id="sep" label="Product" required className="span-2" error={errors.product}>
              <select id="sep" value={f.product} onChange={set('product')}><option value="">Select</option>{products.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name} · {p.place} · stock {p.stockQty}</option>)}</select>
            </FormField>
            <FormField id="seq" label="Quantity received" required error={errors.quantity} hint={chosen ? `Now in stock: ${chosen.stockQty}` : undefined}><input id="seq" inputMode="numeric" value={f.quantity} onChange={(e) => { setF((x) => ({ ...x, quantity: e.target.value.replace(/\D/g, '').slice(0, 6) })); setErrors((x) => ({ ...x, quantity: undefined })); }} /></FormField>
            <FormField id="sed" label="Date received" error={errors.entryDate}><input id="sed" type="date" max={today()} value={f.entryDate} onChange={set('entryDate')} /></FormField>
            <FormField id="ser" label="Purchase rate per unit (₹)" hint="Optional" error={errors.purchaseRate}><input id="ser" inputMode="decimal" value={f.purchaseRate} onChange={(e) => { setF((x) => ({ ...x, purchaseRate: e.target.value.replace(/[^\d.]/g, '') })); setErrors((x) => ({ ...x, purchaseRate: undefined })); }} /></FormField>
            <FormField id="ses" label="Supplier" error={errors.supplier}><input id="ses" value={f.supplier} maxLength={80} onChange={set('supplier')} /></FormField>
            <FormField id="seb" label="Bill / challan no." error={errors.billNo}><input id="seb" value={f.billNo} maxLength={40} onChange={set('billNo')} /></FormField>
            <FormField id="sek" label="Remark" className="span-2"><input id="sek" value={f.remark} maxLength={200} onChange={set('remark')} /></FormField>
          </div>
        </Modal>
      )}
      {cancelling && (
        <Modal open title="Cancel the stock entry" onClose={() => setCancelling(null)} busy={busy}
          footer={<><button className="btn" onClick={() => setCancelling(null)} disabled={busy}>Close</button><button className="btn danger" onClick={cancel} disabled={busy}>{busy ? 'Saving…' : 'Cancel entry'}</button></>}>
          <p className="muted">{cancelling.code}: {cancelling.quantity} × {cancelling.product.name}. The units are taken out of the stock again; this only works while they are all still in stock.</p>
          <FormField id="secr" label="Reason" required error={reasonError}><input id="secr" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></FormField>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------
// Quantity report
export function QuantityReport() {
  const { user } = useAuth();
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);
  const [place, setPlace] = useState('');
  const [category, setCategory] = useState('');
  const [low, setLow] = useState('');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 300);
  const list = useLoad(() => api.stockEntries.quantityReport({ branch: place, category, low, from, to, q }), [place, category, low, from, to, q]);
  const d = list.data;
  return (
    <>
      <PageHeader title="Quantity Report" description="Every product with the units in stock and their value, and the units received (stock entry) and transferred in and out in the period." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <PlaceSelect value={place} onChange={setPlace} isAdmin={isAdmin} />
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category"><option value="">All categories</option>{(d?.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <select value={low} onChange={(e) => setLow(e.target.value)} aria-label="Stock level"><option value="">Any stock</option><option value="0">Out of stock</option><option value="5">5 or less</option><option value="10">10 or less</option></select>
          <Dates from={from} setFrom={setFrom} to={to} setTo={setTo} />
          <input type="search" placeholder="Search product" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          <Refresh onClick={list.load} loading={list.loading} />
          <button className="btn" onClick={() => window.print()}>Print</button>
        </div>
        {list.loading && !d ? <Spinner label="Loading…" /> : list.error ? <ErrorState message={list.error} onRetry={list.load} /> : !d || d.rows.length === 0 ? <EmptyState title="No product" description="No product for this filter." /> : (
          <>
            <Summary items={[['Products', d.totals.products], ['Units in stock', d.totals.stock], ['Stock value', inr(d.totals.value)], ['Received', d.totals.received], ['Transferred in', d.totals.transferIn], ['Transferred out', d.totals.transferOut], ['Out of stock', d.totals.outOfStock]]} />
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Product</th><th>Category</th><th>Held at</th><th className="num">Price</th><th className="num">In stock</th><th className="num">Value</th><th className="num">Received</th><th className="num">Transfer in</th><th className="num">Transfer out</th></tr></thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Product"><strong>{r.name}</strong><div className="muted small">{r.code}{r.isActive ? '' : ' · stopped'}</div></td><td data-label="Category">{r.category}</td><td data-label="Held at">{r.place}</td><td data-label="Price" className="num">{inr(r.unitPrice)}</td>
                      <td data-label="In stock" className="num">{r.stock === 0 ? <span className="badge danger">0</span> : r.stock <= 5 ? <span className="badge amber">{r.stock}</span> : <strong>{r.stock}</strong>}</td>
                      <td data-label="Value" className="num">{inr(r.value)}</td><td data-label="Received" className="num">{r.received || '—'}</td><td data-label="Transfer in" className="num">{r.transferIn || '—'}</td><td data-label="Transfer out" className="num">{r.transferOut || '—'}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid currentColor' }}><td colSpan={4}><strong>Total</strong></td><td className="num"><strong>{d.totals.stock}</strong></td><td className="num"><strong>{inr(d.totals.value)}</strong></td><td className="num"><strong>{d.totals.received}</strong></td><td className="num"><strong>{d.totals.transferIn}</strong></td><td className="num"><strong>{d.totals.transferOut}</strong></td></tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
