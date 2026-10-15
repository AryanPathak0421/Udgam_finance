import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import FormField from '../../components/ui/FormField.jsx';
import Modal from '../../components/ui/Modal.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner, StatusBadge } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import useDebounce from '../../hooks/useDebounce.js';

const LIMIT = 25;
const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function ProductForm({ item, onClose, onSaved }) {
  const toast = useToast();
  const isEdit = Boolean(item);
  const [form, setForm] = useState({
    name: item?.name || '',
    category: item?.category || '',
    unitPrice: item ? String(item.unitPrice) : '',
    stockQty: item ? String(item.stockQty) : '0',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  async function submit(e) {
    e.preventDefault();
    const found = {};
    if (form.name.trim().length < 2) found.name = 'Product name is required';
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(form.unitPrice) || Number(form.unitPrice) < 1) found.unitPrice = 'Enter the price per unit';
    if (!/^\d+$/.test(form.stockQty)) found.stockQty = 'Enter the stock as a whole number';
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const payload = { ...form, name: form.name.trim(), category: form.category.trim() };
      if (isEdit) await api.stockProducts.update(item.id, payload);
      else await api.stockProducts.create(payload);
      toast.success(isEdit ? 'Product updated' : 'Product added');
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
      title={isEdit ? `Edit product — ${item.code}` : 'Add stock product'}
      onClose={onClose}
      busy={saving}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn primary" type="submit" form="product-form" disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Update product' : 'Save product'}</button>
        </>
      }
    >
      <form id="product-form" onSubmit={submit} noValidate className="form-grid">
        <FormField id="name" label="Product name" required error={errors.name} className="span-2">
          <input id="name" value={form.name} onChange={set('name')} maxLength={100} autoFocus />
        </FormField>
        <FormField id="category" label="Category" error={errors.category} hint="Optional, e.g. Mobile, Appliance">
          <input id="category" value={form.category} onChange={set('category')} maxLength={60} />
        </FormField>
        <FormField id="unitPrice" label="Price per unit (₹)" required error={errors.unitPrice}>
          <input id="unitPrice" inputMode="decimal" value={form.unitPrice} onChange={(e) => { setForm((f) => ({ ...f, unitPrice: e.target.value.replace(/[^\d.]/g, '') })); setErrors((er) => ({ ...er, unitPrice: undefined })); }} />
        </FormField>
        <FormField id="stockQty" label="Stock (units)" required error={errors.stockQty}>
          <input id="stockQty" inputMode="numeric" value={form.stockQty} onChange={(e) => { setForm((f) => ({ ...f, stockQty: e.target.value.replace(/\D/g, '') })); setErrors((er) => ({ ...er, stockQty: undefined })); }} />
        </FormField>
      </form>
    </Modal>
  );
}

export default function StockProductMaster() {
  const toast = useToast();
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const q = useDebounce(search);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.stockProducts.list({ page, limit: LIMIT, q, status }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, q, status]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [q, status]);

  async function run(action, success) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
      setDialog(null);
    }
  }
  const close = () => setDialog(null);

  return (
    <>
      <PageHeader
        title="Stock Product Master"
        description="Products in stock that a product loan can be taken for. A product loan picks a product from here."
        actions={<button className="btn primary" onClick={() => setDialog({ type: 'form' })}>+ Add Product</button>}
      />
      <div className="panel">
        <div className="toolbar">
          <input type="search" className="toolbar-search" placeholder="Search by code, name or category" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search products" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        {loading && !data.items.length ? (
          <Spinner label="Loading products…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : data.items.length === 0 ? (
          <EmptyState title={q || status ? 'No products match your filters' : 'No products yet'} description={q || status ? 'Try changing the filters.' : 'Add the first stock product.'} />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead><tr><th>Code</th><th>Product</th><th>Category</th><th className="num">Price / unit</th><th className="num">Stock</th><th>Status</th><th className="actions-col">Actions</th></tr></thead>
                <tbody>
                  {data.items.map((p) => (
                    <tr key={p.id}>
                      <td data-label="Code"><strong>{p.code}</strong></td>
                      <td data-label="Product">{p.name}</td>
                      <td data-label="Category">{p.category || '—'}</td>
                      <td data-label="Price" className="num">{inr(p.unitPrice)}</td>
                      <td data-label="Stock" className="num">{p.stockQty}</td>
                      <td data-label="Status"><StatusBadge active={p.isActive} /></td>
                      <td data-label="Actions" className="actions-col">
                        <div className="row-actions">
                          <button className="btn sm" onClick={() => setDialog({ type: 'form', item: p })}>Edit</button>
                          <button className="btn sm" onClick={() => setDialog({ type: 'status', item: p })}>{p.isActive ? 'Deactivate' : 'Activate'}</button>
                          <button className="btn sm danger-outline" onClick={() => setDialog({ type: 'delete', item: p })}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page || page} totalPages={data.totalPages} total={data.total} limit={LIMIT} onPage={setPage} />
          </>
        )}
      </div>

      {dialog?.type === 'form' && <ProductForm item={dialog.item || null} onClose={close} onSaved={() => { close(); load(); }} />}
      <ConfirmDialog
        open={dialog?.type === 'status'}
        title={dialog?.item?.isActive ? 'Deactivate product?' : 'Activate product?'}
        message={dialog?.item ? (dialog.item.isActive ? `${dialog.item.name} will no longer be offered for product loans.` : `${dialog.item.name} will be offered again.`) : ''}
        confirmLabel={dialog?.item?.isActive ? 'Deactivate' : 'Activate'}
        loading={busy}
        onConfirm={() => run(() => api.stockProducts.setStatus(dialog.item.id, !dialog.item.isActive), dialog.item.isActive ? 'Product deactivated' : 'Product activated')}
        onCancel={close}
      />
      <ConfirmDialog
        open={dialog?.type === 'delete'}
        title="Delete product?"
        message={dialog?.item ? `Delete "${dialog.item.name}"? Requisitions already made keep their own copy of the product.` : ''}
        confirmLabel="Delete"
        tone="danger"
        loading={busy}
        onConfirm={() => run(() => api.stockProducts.remove(dialog.item.id), 'Product deleted')}
        onCancel={close}
      />
    </>
  );
}
