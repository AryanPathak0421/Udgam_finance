import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Modal from '../components/ui/Modal.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import { DetailList, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import useDebounce from '../hooks/useDebounce.js';

const LIMIT = 25;
const CREATORS = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer'];
const inr = (n) => (n === null || n === undefined ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const TONE = { pending: 'grey', approved: 'green', rejected: 'danger', cancelled: 'grey' };
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

function Detail({ id, onClose }) {
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.loanRequisitions.get(id).then((x) => setR(x.requisition)).catch((e) => setError(e.message));
  }, [id]);
  return (
    <Modal open title={r ? `${r.formId} — ${r.borrowerName}` : 'Requisition'} onClose={onClose} size="lg" footer={<button className="btn" onClick={onClose}>Close</button>}>
      {error ? <ErrorState message={error} /> : !r ? <Spinner label="Loading…" /> : (
        <DetailList
          items={[
            ['Form ID', r.formId], ['Status', cap(r.status)], ['Branch', r.branch?.name], ['Loan date', r.loanDate],
            ['Borrower', `${r.borrower.code} — ${r.borrower.name}`], ['Age / Gender', `${r.borrower.age} / ${cap(r.borrower.gender)}`],
            ['Phone', r.borrower.mobile], ['Guarantor', r.borrower.guarantorName],
            ['Address', `${r.borrower.address}, ${r.borrower.district}, ${r.borrower.state} - ${r.borrower.pincode}`],
            ['Previous loan amount', inr(r.previousLoanAmount)],
            ['Scheme', `${r.schemeCode} — ${r.schemeName}`], ['Request amount', inr(r.amount)],
            ['Mode & term', `${r.modeLabel}, ${r.term} installments`], ['Interest rate', `${r.rate}% p.a. (${r.calculationType})`],
            ['EMI', inr(r.emi)], ['Total interest', inr(r.totalInterest)], ['Total payable', inr(r.totalPayable)],
            ['Processing fee', inr(r.processingFee)], ['Employee ID', r.employeeCode],
          ]}
        />
      )}
    </Modal>
  );
}

export default function RequisitionList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canCreate = CREATORS.includes(user?.role);
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [openId, setOpenId] = useState(null);
  const q = useDebounce(search);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.loanRequisitions.list({ page, limit: LIMIT, q, status, from, to }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, q, status, from, to]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPage(1), [q, status, from, to]);

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
                  <tr><th>Form ID</th><th>Loan date</th><th>Borrower</th><th>Branch</th><th>Scheme</th><th className="num">Amount</th><th className="num">EMI</th><th>Status</th><th className="actions-col">Actions</th></tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Form ID"><strong>{r.formId}</strong></td>
                      <td data-label="Loan date">{r.loanDate}</td>
                      <td data-label="Borrower">{r.borrowerCode} — {r.borrowerName}</td>
                      <td data-label="Branch">{r.branch?.name || '—'}</td>
                      <td data-label="Scheme">{r.schemeName}</td>
                      <td data-label="Amount" className="num">{inr(r.amount)}</td>
                      <td data-label="EMI" className="num">{inr(r.emi)}</td>
                      <td data-label="Status"><span className={`badge ${TONE[r.status]}`}>{cap(r.status)}</span></td>
                      <td data-label="Actions" className="actions-col"><button className="btn sm" onClick={() => setOpenId(r.id)}>View</button></td>
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
    </>
  );
}
