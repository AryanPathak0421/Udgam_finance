import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import FormField from '../../components/ui/FormField.jsx';
import Modal from '../../components/ui/Modal.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner, StatusBadge } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import useDebounce from '../../hooks/useDebounce.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { canDo } from '../../config/nav.js';

const LIMIT = 25;
const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const branchText = (b) => (b ? `${b.code} — ${b.name}` : 'Head office');

function ProductForm({ item, options, onClose, onSaved }) {
  const toast = useToast();
  const isEdit = Boolean(item);
  const single = !options.headOffice && options.branches.length === 1 ? options.branches[0].id : '';
  const [form, setForm] = useState({
    category: item?.category || '',
    brand: item?.brand || '',
    model: item?.model || '',
    variant: item?.variant || '',
    unitPrice: item ? String(item.unitPrice) : '',
    stockQty: item ? String(item.stockQty) : '0',
    branch: item ? item.branch?.id || '' : single,
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
    if (!form.category.trim()) found.category = 'Category is required';
    if (!form.brand.trim()) found.brand = 'Brand is required';
    if (!form.model.trim()) found.model = 'Model is required';
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(form.unitPrice) || Number(form.unitPrice) < 1) found.unitPrice = 'Enter the sale price per unit';
    if (!/^\d+$/.test(form.stockQty)) found.stockQty = 'Enter the quantity as a whole number';
    if (!options.headOffice && !form.branch) found.branch = 'Select the branch';
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const payload = { ...form, category: form.category.trim(), brand: form.brand.trim(), model: form.model.trim(), variant: form.variant.trim() };
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
      title={isEdit ? `Edit product — ${item.code}` : 'Add product'}
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
        <FormField id="code" label="Product code" hint="Generated automatically">
          <input id="code" value={item?.code || 'Auto'} disabled />
        </FormField>
        <FormField id="branch" label="Branch" required={!options.headOffice} error={errors.branch} hint={options.headOffice ? 'Head office is the admin stock that branches order from' : undefined}>
          <select id="branch" value={form.branch} onChange={set('branch')} disabled={!options.headOffice && options.branches.length === 1}>
            {options.headOffice ? <option value="">Head office</option> : <option value="">Select branch</option>}
            {options.branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
          </select>
        </FormField>
        <FormField id="category" label="Product category" required error={errors.category} hint="e.g. Electronics, Furniture">
          <input id="category" list="stock-categories" value={form.category} onChange={set('category')} maxLength={60} autoFocus />
          <datalist id="stock-categories">{options.categories.map((c) => <option key={c} value={c} />)}</datalist>
        </FormField>
        <FormField id="brand" label="Product brand" required error={errors.brand}>
          <input id="brand" value={form.brand} onChange={set('brand')} maxLength={60} />
        </FormField>
        <FormField id="model" label="Product model" required error={errors.model}>
          <input id="model" value={form.model} onChange={set('model')} maxLength={60} />
        </FormField>
        <FormField id="variant" label="Product variant" error={errors.variant} hint="Optional, e.g. 6GB / 128GB, Black">
          <input id="variant" value={form.variant} onChange={set('variant')} maxLength={60} />
        </FormField>
        <FormField id="unitPrice" label="Product sale price (₹)" required error={errors.unitPrice}>
          <input id="unitPrice" inputMode="decimal" value={form.unitPrice} onChange={(e) => { setForm((f) => ({ ...f, unitPrice: e.target.value.replace(/[^\d.]/g, '') })); setErrors((er) => ({ ...er, unitPrice: undefined })); }} />
        </FormField>
        <FormField id="stockQty" label="Quantity" required error={errors.stockQty}>
          <input id="stockQty" inputMode="numeric" value={form.stockQty} onChange={(e) => { setForm((f) => ({ ...f, stockQty: e.target.value.replace(/\D/g, '') })); setErrors((er) => ({ ...er, stockQty: undefined })); }} />
        </FormField>
      </form>
    </Modal>
  );
}

function Report({ report }) {
  if (!report || !report.rows.length) return null;
  return (
    <div className="panel" style={{ marginBottom: 14, padding: 16 }}>
      <h3 className="section-title">Stock report</h3>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Branch</th><th className="num">Products</th><th className="num">Units</th><th className="num">Stock value</th></tr></thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.branchId || 'ho'}>
                <td data-label="Branch">{r.branch}</td>
                <td data-label="Products" className="num">{r.products}</td>
                <td data-label="Units" className="num">{r.units}</td>
                <td data-label="Value" className="num">{inr(r.value)}</td>
              </tr>
            ))}
            {report.rows.length > 1 && (
              <tr>
                <td><strong>Total</strong></td>
                <td className="num"><strong>{report.total.products}</strong></td>
                <td className="num"><strong>{report.total.units}</strong></td>
                <td className="num"><strong>{inr(report.total.value)}</strong></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function StockProductMaster() {
  const toast = useToast();
  const { user } = useAuth();
  const canAdd = canDo(user, '/stock/products', 'add');
  const canEdit = canDo(user, '/stock/products', 'edit');
  const canDelete = canDo(user, '/stock/products', 'delete');
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [options, setOptions] = useState({ branches: [], categories: [], headOffice: false });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [branch, setBranch] = useState('');
  const [category, setCategory] = useState('');
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const q = useDebounce(search);

  useEffect(() => {
    api.stockProducts.options().then(setOptions).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [list, rep] = await Promise.all([api.stockProducts.list({ page, limit: LIMIT, q, status, branch, category }), api.stockProducts.report()]);
      setData(list);
      setReport(rep);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, q, status, branch, category]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [q, status, branch, category]);

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
  const filtered = q || status || branch || category;
  const showBranches = options.headOffice || options.branches.length > 1;

  return (
    <>
      <PageHeader
        title="Stock Product Master"
        description="Enter products with category, brand, model, variant, sale price and quantity. Branch stock is what product loans are given from; branches order from the head-office stock."
        actions={canAdd ? <button className="btn primary" onClick={() => setDialog({ type: 'form' })}>+ Add Product</button> : null}
      />
      <Report report={report} />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <input type="search" className="toolbar-search" placeholder="Search by code, brand, model or category" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search products" />
          {showBranches && (
            <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Filter by branch">
              <option value="">All branches</option>
              {options.headOffice && <option value="ho">Head office</option>}
              {options.branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
          )}
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
            <option value="">All categories</option>
            {options.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
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
          <EmptyState title={filtered ? 'No products match your filters' : 'No products yet'} description={filtered ? 'Try changing the filters.' : ['super_admin', 'admin'].includes(user?.role) ? 'Add the first product.' : 'Your branch has no stock yet. Order products from the head office under Branch Order; once the admin approves the order, the stock shows here.'} />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead><tr><th>Code</th><th>Category</th><th>Brand</th><th>Model</th><th>Variant</th><th className="num">Sale price</th><th className="num">Quantity</th><th>Branch</th><th>Status</th><th className="actions-col">Actions</th></tr></thead>
                <tbody>
                  {data.items.map((p) => (
                    <tr key={p.id}>
                      <td data-label="Code"><strong>{p.code}</strong></td>
                      <td data-label="Category">{p.category}</td>
                      <td data-label="Brand">{p.brand}</td>
                      <td data-label="Model">{p.model}</td>
                      <td data-label="Variant">{p.variant || '—'}</td>
                      <td data-label="Price" className="num">{inr(p.unitPrice)}</td>
                      <td data-label="Quantity" className="num">{p.stockQty}</td>
                      <td data-label="Branch">{branchText(p.branch)}</td>
                      <td data-label="Status"><StatusBadge active={p.isActive} /></td>
                      <td data-label="Actions" className="actions-col">
                        <div className="row-actions">
                          {canEdit && <button className="btn sm" onClick={() => setDialog({ type: 'form', item: p })}>Edit</button>}
                          {canEdit && <button className="btn sm" onClick={() => setDialog({ type: 'status', item: p })}>{p.isActive ? 'Deactivate' : 'Activate'}</button>}
                          {canDelete && <button className="btn sm danger-outline" onClick={() => setDialog({ type: 'delete', item: p })}>Delete</button>}
                          {!canEdit && !canDelete && <span className="muted">View only</span>}
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

      {dialog?.type === 'form' && <ProductForm item={dialog.item || null} options={options} onClose={close} onSaved={() => { close(); load(); api.stockProducts.options().then(setOptions).catch(() => {}); }} />}
      <ConfirmDialog
        open={dialog?.type === 'status'}
        title={dialog?.item?.isActive ? 'Deactivate product?' : 'Activate product?'}
        message={dialog?.item ? (dialog.item.isActive ? `${dialog.item.name} will no longer be offered for product loans or orders.` : `${dialog.item.name} will be offered again.`) : ''}
        confirmLabel={dialog?.item?.isActive ? 'Deactivate' : 'Activate'}
        loading={busy}
        onConfirm={() => run(() => api.stockProducts.setStatus(dialog.item.id, !dialog.item.isActive), dialog.item.isActive ? 'Product deactivated' : 'Product activated')}
        onCancel={close}
      />
      <ConfirmDialog
        open={dialog?.type === 'delete'}
        title="Delete product?"
        message={dialog?.item ? `Delete "${dialog.item.name}" (${branchText(dialog.item.branch)})? Requisitions already made keep their own copy of the product.` : ''}
        confirmLabel="Delete"
        tone="danger"
        loading={busy}
        onConfirm={() => run(() => api.stockProducts.remove(dialog.item.id), 'Product deleted')}
        onCancel={close}
      />
    </>
  );
}
