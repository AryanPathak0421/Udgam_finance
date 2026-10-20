import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import { EmptyState, ErrorState, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { PhotoField } from './NewBorrower.jsx';

const LIMIT = 25;
const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');
const fmtTime = (d) => (d ? new Date(d).toLocaleString('en-IN') : '—');
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS = { submitted: { label: 'Submitted', tone: 'grey' }, resolved: { label: 'Resolved by admin', tone: 'green' }, delivered: { label: 'Delivered', tone: 'green' } };

// Raise a complaint: choose the sold product (the member's name and ID are shown), upload the bill, say what is wrong.
function NewComplaint({ branches, onClose, onSaved }) {
  const toast = useToast();
  const [branch, setBranch] = useState(branches.length === 1 ? branches[0].id : '');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState(null);
  const [picked, setPicked] = useState(null);
  const [bill, setBill] = useState('');
  const [remark, setRemark] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const q = useDebounce(search);

  useEffect(() => {
    let live = true;
    setItems(null);
    api.productComplaints.sales({ branch, q }).then((r) => live && setItems(r.items)).catch(() => live && setItems([]));
    return () => { live = false; };
  }, [branch, q]);

  async function submit(e) {
    e.preventDefault();
    const found = {};
    if (!picked) found.sale = 'Select the sold product';
    if (!bill) found.billPhoto = 'Upload the bill';
    if (remark.trim().length < 3) found.remark = 'Write what is wrong with the product';
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      const r = await api.productComplaints.create({ loanPayment: picked.loanPayment, memberCode: picked.memberCode, productIndex: picked.productIndex, billPhoto: bill, remark: remark.trim() });
      toast.success(`Complaint ${r.complaint.code} submitted to the admin`);
      onSaved();
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title="New complaint" onClose={onClose} busy={saving} size="lg"
      footer={<><button className="btn" onClick={onClose} disabled={saving}>Cancel</button><button className="btn primary" type="submit" form="complaint-form" disabled={saving}>{saving ? 'Submitting…' : 'Submit complaint'}</button></>}>
      <form id="complaint-form" onSubmit={submit} noValidate>
        {branches.length > 1 && (
          <FormField id="cbranch" label="Branch">
            <select id="cbranch" value={branch} onChange={(e) => { setBranch(e.target.value); setPicked(null); }}>
              <option value="">All my branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
          </FormField>
        )}
        <FormField id="csearch" label="Sold product" required error={errors.sale} hint="Products sold to members with a loan. Search by member name or ID, product or Loan ID.">
          <input id="csearch" type="search" placeholder="Search member name / ID, product, Loan ID" value={search} onChange={(e) => setSearch(e.target.value)} />
        </FormField>
        {items === null ? <Spinner label="Loading…" /> : items.length === 0 ? <EmptyState title="No sold product found" description="Products appear here once a loan with a product is paid out." /> : (
          <div className="table-wrap" style={{ maxHeight: 260, overflow: 'auto', marginBottom: 12 }}>
            <table className="data-table">
              <thead><tr><th style={{ width: 36 }} /><th>Member</th><th>Product</th><th>Loan ID</th><th>Sold on</th></tr></thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.key} onClick={() => { setPicked(s); setErrors((x) => ({ ...x, sale: undefined })); }} style={{ cursor: 'pointer', background: picked?.key === s.key ? 'var(--surface-2, rgba(16,120,112,.08))' : undefined }}>
                    <td><input type="radio" name="sale" aria-label={`Select ${s.product.name} of ${s.memberCode}`} checked={picked?.key === s.key} onChange={() => setPicked(s)} /></td>
                    <td data-label="Member"><strong>{s.memberName}</strong><div className="muted small">{s.memberCode}</div></td>
                    <td data-label="Product">{s.product.name}{s.product.quantity > 1 ? ` × ${s.product.quantity}` : ''}{s.product.unitPrice ? <div className="muted small">{inr(s.product.unitPrice)}</div> : null}</td>
                    <td data-label="Loan ID">{s.loanId}</td>
                    <td data-label="Sold on">{fmt(s.soldOn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {picked && <div className="notice" style={{ marginBottom: 12 }}>Complaint about <strong>{picked.product.name}</strong> of <strong>{picked.memberName}</strong> ({picked.memberCode}), Loan {picked.loanId}.</div>}
        <div className="form-grid">
          <PhotoField id="complaintBill" label="Bill" required value={bill} error={errors.billPhoto} onChange={(v) => { setBill(v); setErrors((x) => ({ ...x, billPhoto: undefined })); }} />
          <FormField id="cremark" label="What is wrong" required error={errors.remark}>
            <textarea id="cremark" rows={4} maxLength={300} value={remark} onChange={(e) => { setRemark(e.target.value); setErrors((x) => ({ ...x, remark: undefined })); }} />
          </FormField>
        </div>
      </form>
    </Modal>
  );
}

function ComplaintDialog({ id, isAdmin, canAdd, onClose, onChanged }) {
  const toast = useToast();
  const [c, setC] = useState(null);
  const [resolution, setResolution] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.productComplaints.get(id).then((r) => setC(r.complaint)).catch((err) => setError(err.message));
  }, [id]);

  async function act(fn, message) {
    setBusy(true);
    setError('');
    try {
      const r = await fn();
      setC((x) => ({ ...x, ...r.complaint }));
      toast.success(message);
      onChanged();
    } catch (err) {
      setError(err.errors?.resolution || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={c ? `Complaint ${c.code}` : 'Complaint'} onClose={onClose} busy={busy} size="lg" footer={<button className="btn" onClick={onClose}>Close</button>}>
      {!c ? (error ? <div className="field-error" role="alert">{error}</div> : <Spinner label="Loading…" />) : (
        <>
          <dl className="detail-list">
            <div><dt>Status</dt><dd><span className={`badge ${STATUS[c.status].tone}`}>{STATUS[c.status].label}</span></dd></div>
            <div><dt>Branch</dt><dd>{c.branch ? `${c.branch.code} — ${c.branch.name}` : '—'}</dd></div>
            <div><dt>Member</dt><dd>{c.memberName} ({c.memberCode})</dd></div>
            <div><dt>Product</dt><dd>{c.product?.name}{c.product?.quantity > 1 ? ` × ${c.product.quantity}` : ''} · Loan {c.loanId} · sold {fmt(c.soldOn)}</dd></div>
            <div><dt>Complaint</dt><dd>{c.remark}</dd></div>
            <div><dt>Raised</dt><dd>{fmtTime(c.createdAt)}{c.createdByCode ? ` by ${c.createdByCode}` : ''}</dd></div>
            {c.status !== 'submitted' && <div><dt>Resolved</dt><dd>{c.resolution} · {fmtTime(c.resolvedAt)}{c.resolvedByCode ? ` by ${c.resolvedByCode}` : ''}</dd></div>}
            {c.status === 'delivered' && <div><dt>Delivered</dt><dd>{fmtTime(c.deliveredAt)}{c.deliveredByCode ? ` by ${c.deliveredByCode}` : ''}</dd></div>}
          </dl>
          {c.billPhoto && <div style={{ margin: '10px 0' }}><div className="detail-label">Bill</div><img src={c.billPhoto} alt="Bill" className="stamp-img" style={{ maxWidth: '100%', maxHeight: 320 }} /></div>}
          {error && <div className="field-error" role="alert" style={{ marginBottom: 8 }}>{error}</div>}
          {isAdmin && c.status === 'submitted' && (
            <div>
              <FormField id="cresolution" label="How it is resolved" required>
                <textarea id="cresolution" rows={3} maxLength={300} value={resolution} onChange={(e) => { setResolution(e.target.value); setError(''); }} />
              </FormField>
              <button className="btn primary" disabled={busy} onClick={() => act(() => api.productComplaints.resolve(c.id, resolution.trim()), 'Complaint resolved')}>{busy ? 'Saving…' : 'Mark resolved'}</button>
            </div>
          )}
          {canAdd && c.status === 'resolved' && (
            <button className="btn primary" disabled={busy} onClick={() => act(() => api.productComplaints.deliver(c.id), 'Marked as delivered')}>{busy ? 'Saving…' : 'Mark delivered to the member'}</button>
          )}
          {!isAdmin && c.status === 'submitted' && <div className="muted">Waiting for the admin to resolve it.</div>}
        </>
      )}
    </Modal>
  );
}

export default function ProductComplaints({ isAdmin, canAdd, branches }) {
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1, submitted: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(isAdmin ? 'submitted' : '');
  const [branch, setBranch] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const q = useDebounce(search);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.productComplaints.list({ page, limit: LIMIT, status, branch, q }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, status, branch, q]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => setPage(1), [status, branch, q]);

  const tab = (key, label) => <button key={key} className={`btn sm${status === key ? ' primary' : ''}`} onClick={() => setStatus(key)}>{label}{key === 'submitted' ? ` (${data.submitted})` : ''}</button>;

  return (
    <>
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6 }}>{tab('submitted', 'Submitted')}{tab('resolved', 'Resolved')}{tab('delivered', 'Delivered')}{tab('', 'All')}</div>
          <input type="search" className="toolbar-search" placeholder="Search complaint, member, product or Loan ID" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search complaints" />
          {branches.length > 1 && (
            <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch">
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          {canAdd && <button className="btn primary" onClick={() => setCreating(true)}>+ New complaint</button>}
        </div>
        {loading && !data.items.length ? <Spinner label="Loading complaints…" /> : error ? <ErrorState message={error} onRetry={load} /> : data.items.length === 0 ? (
          <EmptyState title="No complaint" description={status === 'submitted' ? 'Nothing is waiting to be resolved.' : 'No complaint matches these filters.'} />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead><tr><th>Complaint</th><th>Date</th><th>Branch</th><th>Member</th><th>Product</th><th>Loan ID</th><th>Status</th><th className="actions-col">Actions</th></tr></thead>
                <tbody>
                  {data.items.map((c) => (
                    <tr key={c.id}>
                      <td data-label="Complaint"><strong>{c.code}</strong></td>
                      <td data-label="Date">{fmt(c.createdAt)}</td>
                      <td data-label="Branch">{c.branch ? `${c.branch.code} — ${c.branch.name}` : '—'}</td>
                      <td data-label="Member"><strong>{c.memberName}</strong><div className="muted small">{c.memberCode}</div></td>
                      <td data-label="Product">{c.product?.name}</td>
                      <td data-label="Loan ID">{c.loanId}</td>
                      <td data-label="Status"><span className={`badge ${STATUS[c.status].tone}`}>{STATUS[c.status].label}</span></td>
                      <td data-label="Actions" className="actions-col"><button className="btn sm" onClick={() => setOpenId(c.id)}>{isAdmin && c.status === 'submitted' ? 'Resolve' : canAdd && c.status === 'resolved' ? 'Deliver' : 'View'}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page || page} totalPages={data.totalPages} total={data.total} limit={LIMIT} onPage={setPage} />
          </>
        )}
      </div>
      {creating && <NewComplaint branches={branches} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {openId && <ComplaintDialog id={openId} isAdmin={isAdmin} canAdd={canAdd} onClose={() => setOpenId(null)} onChanged={load} />}
    </>
  );
}
