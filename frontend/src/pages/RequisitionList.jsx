import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Modal from '../components/ui/Modal.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import { DetailList, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import useDebounce from '../hooks/useDebounce.js';

const LIMIT = 25;
const CREATORS = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer'];
const DELETERS = ['super_admin', 'admin', 'branch_manager'];
const inr = (n) => (n === null || n === undefined ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const TONE = { pending: 'grey', approved: 'green', rejected: 'danger', cancelled: 'grey' };
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

function Detail({ id, onClose }) {
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.loanRequisitions.get(id).then((x) => setR(x.requisition)).catch((e) => setError(e.message));
  }, [id]);

  const who = (x) => (x.group ? `${x.group.code} — ${x.group.name}` : `${x.borrower.code} — ${x.borrower.name}`);
  return (
    <Modal open title={r ? `${r.formId} — ${r.subjectName}` : 'Requisition'} onClose={onClose} size="lg" footer={<button className="btn" onClick={onClose}>Close</button>}>
      {error ? <ErrorState message={error} /> : !r ? <Spinner label="Loading…" /> : (
        <>
          <DetailList
            items={[
              ['Form ID', r.formId], ['Type', r.kindLabel], ['Status', cap(r.status)], ['Branch', r.branch?.name], ['Loan date', r.loanDate],
              [r.group ? 'Group' : 'Borrower', who(r)],
              ...(r.borrower
                ? [
                    ['Age / Gender', `${r.borrower.age} / ${cap(r.borrower.gender)}`], ['Phone', r.borrower.mobile], ['Guarantor', r.borrower.guarantorName],
                    ['Address', `${r.borrower.address}, ${r.borrower.district}, ${r.borrower.state} - ${r.borrower.pincode}`],
                    ['Previous loan amount', inr(r.previousLoanAmount)],
                  ]
                : [['Group leader', r.group.leaderName], ['Members', String(r.memberCount)]]),
              ...(r.business
                ? [
                    ['Loan type', r.business.loanType === 'msme' ? 'MSME loan' : 'Business loan'], ['Business name', r.business.businessName],
                    ['Civil score', String(r.business.civilScore ?? '')], ['Udgam number', r.business.udgamNumber], ['GST number', r.business.gstNumber],
                  ]
                : []),
              ['Scheme', `${r.schemeCode} — ${r.schemeName}`],
              [r.group ? 'Amount per member' : 'Request amount', inr(r.amount)],
              ...(r.group ? [['Group total', inr(r.totalAmount)]] : []),
              ['Mode & term', `${r.modeLabel}, ${r.term} installments`], ['Interest rate', `${r.rate}% p.a. (${r.calculationType})`],
              ['EMI', inr(r.emi)], ['Total interest', inr(r.totalInterest)], ['Total payable', inr(r.totalPayable)],
              ['Processing fee', inr(r.processingFee)], ['Insurance fee', inr(r.insuranceFee)], ['Security amount', inr(r.securityAmount)],
              ['Employee ID', r.employeeCode],
            ]}
          />
          {r.group?.members?.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="data-table">
                <thead><tr><th>#</th><th>Member code</th><th>Name</th></tr></thead>
                <tbody>{r.group.members.map((m, i) => <tr key={m.code}><td>{i + 1}</td><td data-label="Code"><strong>{m.code}</strong></td><td data-label="Name">{m.name}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {r.business && (
            <div className="stamp-view sign-row" style={{ marginTop: 12 }}>
              <div>
                <div className="detail-label">Shop photo</div>
                {r.business.shopPhoto ? <img src={r.business.shopPhoto} alt="Shop" className="stamp-img" /> : <span className="muted">—</span>}
              </div>
              <div>
                <div className="detail-label">Bank statement</div>
                {r.business.bankStatement ? (
                  <a className="btn sm" href={r.business.bankStatement} download={`${r.formId}-bank-statement`} target="_blank" rel="noreferrer">Open / download</a>
                ) : <span className="muted">—</span>}
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

export default function RequisitionList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const canCreate = CREATORS.includes(user?.role);
  const canDelete = DELETERS.includes(user?.role);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openId, setOpenId] = useState(null);
  const q = useDebounce(search);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.loanRequisitions.list({ page, limit: LIMIT, q, status, kind, from, to }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, q, status, kind, from, to]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [q, status, kind, from, to]);

  return (
    <>
      <PageHeader
        title="Requisition List"
        description="Loan requisitions that have been submitted."
        actions={canCreate && <button className="btn primary" onClick={() => navigate('/loan-requisition/personal')}>+ New Requisition</button>}
      />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <input type="search" className="toolbar-search" placeholder="Search form ID, borrower code or name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Loan kind">
            <option value="">All loan kinds</option>
            <option value="personal">Personal</option>
            <option value="group">Group</option>
            <option value="business">Business / MSME</option>
            <option value="product">Product</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </div>
        {loading && !data.items.length ? (
          <Spinner label="Loading…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : data.items.length === 0 ? (
          <EmptyState title="No requisitions found" description="Submitted requisitions appear here." />
        ) : (
          <>
            <div className={`table-wrap${loading ? ' dim' : ''}`}>
              <table className="data-table">
                <thead>
                  <tr><th>Form ID</th><th>Loan date</th><th>Type</th><th>Borrower / Group</th><th>Branch</th><th>Scheme</th><th className="num">Amount</th><th className="num">EMI</th><th>Status</th><th className="actions-col">Actions</th></tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Form ID"><strong>{r.formId}</strong></td>
                      <td data-label="Loan date">{r.loanDate}</td>
                      <td data-label="Type">{r.kindLabel}</td>
                      <td data-label="Borrower">{r.subjectCode} — {r.subjectName}</td>
                      <td data-label="Branch">{r.branch?.name || '—'}</td>
                      <td data-label="Scheme">{r.schemeName}</td>
                      <td data-label="Amount" className="num">
                        {inr(r.amount)}
                        {r.kind === 'group' && <div className="muted small">× {r.memberCount} = {inr(r.totalAmount)}</div>}
                      </td>
                      <td data-label="EMI" className="num">{inr(r.emi)}</td>
                      <td data-label="Status"><span className={`badge ${TONE[r.status]}`}>{cap(r.status)}</span></td>
                      <td data-label="Actions" className="actions-col">
                        <div className="row-actions">
                          <button className="btn sm" onClick={() => setOpenId(r.id)}>View</button>
                          {canDelete && r.status !== 'approved' && <button className="btn sm danger-outline" onClick={() => setRemoving(r)}>Delete</button>}
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
      {openId && <Detail id={openId} onClose={() => setOpenId(null)} />}
      <ConfirmDialog
        open={Boolean(removing)}
        title="Delete requisition?"
        message={removing ? `Delete requisition ${removing.formId} of ${removing.subjectName}? An approved requisition cannot be deleted.` : ''}
        confirmLabel="Delete"
        tone="danger"
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.loanRequisitions.remove(removing.id);
            toast.success('Requisition deleted');
            setRemoving(null);
            load();
          } catch (err) {
            toast.error(err.message);
            setRemoving(null);
          } finally {
            setBusy(false);
          }
        }}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}
