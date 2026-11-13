import BankAccountSelect from '../components/BankAccountSelect.jsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import Pagination from '../components/ui/Pagination.jsx';
import { DetailList, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { compressImage } from '../utils/image.js';
import { todayIso } from '../utils/format.js';

const LIMIT = 25;
const SETTLERS = ['super_admin', 'admin', 'branch_manager', 'accountant'];
const MODE_LABEL = { cash: 'Cash', bank: 'Bank transfer', upi: 'UPI', cheque: 'Cheque' };
const MAX_DOC_BYTES = 800 * 1024;
const todayISO = () => todayIso();
const inr = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dmy = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-IN') : '—');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Opens the settlement receipt in its own window and prints it.
function printSettlement(s) {
  const death = s.kind === 'death';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(s.receiptNo)}</title>
  <style>body{font-family:Arial,sans-serif;max-width:680px;margin:24px auto;color:#111;font-size:14px}h1{margin:0;font-size:20px}.muted{color:#555}
  .head{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}table{width:100%;border-collapse:collapse;margin:8px 0}
  td{padding:5px 6px;border-bottom:1px solid #ddd}.n{text-align:right}.tot td{font-weight:bold;border-top:2px solid #111}
  .sign{display:flex;justify-content:space-between;margin-top:48px}.sign div{border-top:1px solid #111;padding-top:4px;width:40%;text-align:center}</style></head><body>
  <div class="head"><div><h1>Udgam Microfinance</h1><div class="muted">${death ? 'Death settlement' : 'Loan settlement'}</div></div><div style="text-align:right"><b>${esc(s.receiptNo)}</b><br>${dmy(s.settledOn)}</div></div>
  <table><tr><td>Loan ID</td><td><b>${esc(s.loanId || s.formId)}</b></td><td>Branch</td><td>${esc(s.branch ? `${s.branch.code} — ${s.branch.name}` : '')}</td></tr>
  <tr><td>Borrower</td><td><b>${esc(s.memberCode)}</b> ${esc(s.memberName)}</td><td>${s.group ? 'Group' : ''}</td><td>${esc(s.group)}</td></tr>
  ${death ? `<tr><td>Date of death</td><td>${dmy(s.deathDate)}</td><td>Verified by</td><td>${esc(s.verifier?.code)} ${esc(s.verifier?.name)}</td></tr>${s.claimRef ? `<tr><td>Insurance claim</td><td colspan="3">${esc(s.claimRef)}</td></tr>` : ''}` : `<tr><td>Paid by</td><td>${esc(MODE_LABEL[s.payMode] || '—')}${s.reference ? ` · ${esc(s.reference)}` : ''}</td><td></td><td></td></tr>`}
  </table>
  <table><tr><td>Outstanding at settlement</td><td class="n">${inr(s.outstanding)}</td></tr>
  <tr><td>${death ? 'Settled against insurance (written off)' : 'Waived'}</td><td class="n">${inr(s.waiver)}</td></tr>
  <tr class="tot"><td>Amount received</td><td class="n">${inr(s.amount)}</td></tr></table>
  ${s.remark ? `<p>Remark: ${esc(s.remark)}</p>` : ''}
  <div class="sign"><div>${death ? 'Verifier' : "Borrower's signature"}</div><div>Authorised signatory</div></div>
  <script>window.onload=function(){window.print()}</script></body></html>`;
  const w = window.open('', '_blank', 'width=780,height=900');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}

// Opens the NOC (No Objection Certificate / Loan Clearance) and prints/downloads it.
function printNoc(s) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>NOC - ${esc(s.loanId || s.formId)}</title>
  <style>
    body { font-family: 'Times New Roman', Times, serif, Arial; max-width: 720px; margin: 30px auto; color: #111; line-height: 1.6; padding: 20px; }
    .header { text-align: center; border-bottom: 2px solid #222; padding-bottom: 12px; margin-bottom: 20px; }
    .header h1 { margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: 1px; color: #003366; }
    .header .sub { font-size: 13px; color: #555; margin-top: 4px; }
    .title-box { text-align: center; margin: 24px 0 20px; }
    .title-box h2 { display: inline-block; font-size: 18px; margin: 0; padding: 6px 20px; border: 1.5px solid #222; text-transform: uppercase; letter-spacing: 1.5px; background: #f9f9f9; }
    .meta-row { display: flex; justify-content: space-between; margin-bottom: 16px; font-size: 13px; }
    .content p { font-size: 14.5px; text-align: justify; margin: 12px 0; }
    .table-details { width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 13.5px; }
    .table-details td { padding: 6px 10px; border: 1px solid #bbb; }
    .table-details td.label { font-weight: bold; width: 35%; background: #fcfcfc; }
    .clearance-badge { border: 2px dashed #2e7d32; background: #e8f5e9; padding: 10px; text-align: center; margin: 20px 0; font-weight: bold; color: #1b5e20; font-size: 15px; border-radius: 4px; }
    .signature-area { display: flex; justify-content: space-between; margin-top: 60px; font-size: 14px; }
    .signature-box { text-align: center; width: 42%; border-top: 1.5px solid #222; padding-top: 6px; }
    .seal-box { text-align: center; width: 30%; border: 1px dashed #aaa; padding: 20px 10px; font-size: 12px; color: #777; border-radius: 4px; margin-top: -15px; }
    @media print {
      body { margin: 0; padding: 15mm; }
      @page { size: A4; margin: 10mm; }
    }
  </style>
  </head>
  <body>
    <div class="header">
      <h1>Udgam Microfinance</h1>
      <div class="sub">Registered Financial Institution · Dedicated to Financial Inclusion & Social Upliftment</div>
      <div class="sub">Branch: ${esc(s.branch ? `${s.branch.code} — ${s.branch.name}` : 'Main Branch')}</div>
    </div>

    <div class="meta-row">
      <div><strong>Ref No:</strong> UDG/NOC/${esc(s.receiptNo)}</div>
      <div><strong>Date:</strong> ${dmy(s.settledOn)}</div>
    </div>

    <div class="title-box">
      <h2>No Objection Certificate (NOC)</h2>
      <div style="font-size: 12px; color: #555; margin-top: 4px;">LOAN CLOSURE & FULL CLEARANCE CERTIFICATE</div>
    </div>

    <div class="content">
      <p><strong>TO WHOMSOEVER IT MAY CONCERN</strong></p>
      
      <p>This is to certify that Mr./Ms. <strong>${esc(s.memberName)}</strong> (Member Code: <strong>${esc(s.memberCode)}</strong>)${s.group ? `, member of group <strong>${esc(s.group)}</strong>` : ''}, had availed a loan facility from <strong>Udgam Microfinance</strong> under Loan Account No. <strong>${esc(s.loanId || s.formId)}</strong>.</p>

      <table class="table-details">
        <tr><td class="label">Borrower Name</td><td>${esc(s.memberName)}</td></tr>
        <tr><td class="label">Borrower / Member ID</td><td>${esc(s.memberCode)}</td></tr>
        <tr><td class="label">Loan Account Number</td><td><strong>${esc(s.loanId || s.formId)}</strong></td></tr>
        <tr><td class="label">Branch Name & Code</td><td>${esc(s.branch ? `${s.branch.code} — ${s.branch.name}` : '—')}</td></tr>
        <tr><td class="label">Settlement / Closure Date</td><td>${dmy(s.settledOn)}</td></tr>
        <tr><td class="label">Settlement Receipt Number</td><td>${esc(s.receiptNo)}</td></tr>
        <tr><td class="label">Outstanding Balance as of Closure</td><td><strong>₹0.00 (NIL)</strong></td></tr>
        <tr><td class="label">Loan Status</td><td><strong style="color: #2e7d32;">CLOSED & FULLY SETTLED</strong></td></tr>
      </table>

      <div class="clearance-badge">
        CERTIFICATE OF ZERO OUTSTANDING DUES (NIL BALANCE)
      </div>

      <p>We hereby confirm and declare that the said loan account has been <strong>FULLY CLOSED AND SETTLED</strong> with <strong>ZERO (₹0.00) OUTSTANDING DUES</strong>. As of <strong>${dmy(s.settledOn)}</strong>, Udgam Microfinance has no further financial claims, dues, liens, or encumbrances against the borrower or their guarantors with respect to this loan account.</p>

      <p>All hypothecated documents, securities, and guarantees associated with this loan stand released and discharged with immediate effect. This certificate is issued upon the request of the borrower for their records and reference without any further liability on our part.</p>
    </div>

    <div class="signature-area">
      <div class="signature-box">
        <div><strong>Borrower's Acknowledgement</strong></div>
        <div style="font-size: 12px; color: #555; margin-top: 2px;">Name & Signature</div>
      </div>
      <div class="seal-box">
        [ Company Seal / Stamp ]
      </div>
      <div class="signature-box">
        <div><strong>Authorised Signatory / Branch Manager</strong></div>
        <div style="font-size: 12px; color: #555; margin-top: 2px;">Udgam Microfinance</div>
      </div>
    </div>

    <script>window.onload = function() { window.print(); };</script>
  </body></html>`;
  const w = window.open('', '_blank', 'width=800,height=920');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}

function SettlementDialog({ settlement: s, onClose }) {
  const toast = useToast();
  const [full, setFull] = useState(null);
  const [zoomImg, setZoomImg] = useState(null);
  useEffect(() => {
    if (s.kind === 'death') api.settlements.get(s.id).then((r) => setFull(r.settlement)).catch(() => {});
  }, [s]);
  const cert = full?.certificate;
  const houseVisitPhoto = full?.houseVisitPhoto;
  const deathPhotos = Array.isArray(full?.deathPhotos) ? full.deathPhotos : [];

  return (
    <>
      <Modal open title={`${s.kind === 'death' ? 'Death settlement' : s.kind === 'auto' ? 'Auto settlement' : 'Loan settlement'} ${s.receiptNo}`} onClose={onClose} size="lg"
        footer={<>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn" onClick={() => { if (!printSettlement(s)) toast.error('Allow pop-ups to print'); }}>Receipt</button>
          <button className="btn primary" onClick={() => { if (!printNoc(s)) toast.error('Allow pop-ups to print'); }}>NOC</button>
        </>}>
        <DetailList items={[
          ['Loan ID', s.loanId || s.formId], ['Branch', s.branch ? `${s.branch.code} — ${s.branch.name}` : ''], ['Borrower', `${s.memberCode} — ${s.memberName}`], ...(s.group ? [['Group', s.group]] : []),
          ['Settlement date', dmy(s.settledOn)], ['Outstanding', inr(s.outstanding)], [s.kind === 'death' ? 'Settled against insurance' : 'Waived', inr(s.waiver)], ['Amount received', inr(s.amount)],
          ...(s.kind === 'loan' && s.payMode ? [['Paid by', `${MODE_LABEL[s.payMode]}${s.reference ? ` · ${s.reference}` : ''}`]] : []),
          ...(s.kind === 'death' ? [['Date of death', dmy(s.deathDate)], ['Verified by', s.verifier ? `${s.verifier.code} — ${s.verifier.name}` : ''], ...(s.claimRef ? [['Insurance claim', s.claimRef]] : [])] : []),
          ...(s.remark ? [['Remark', s.remark]] : []), ['Status', s.status === 'cancelled' ? `Cancelled: ${s.cancelReason}` : s.status === 'pending' ? 'Pending Approval' : s.status === 'rejected' ? `Rejected: ${s.cancelReason}` : 'Settled (Approved)'],
        ]} />

        {s.kind === 'death' && (
          <div style={{ marginTop: 18, borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: '0.95rem', fontWeight: 600, color: '#1e293b' }}>
              Verification Documents &amp; Photos Uploaded from App
            </h4>

            {!full ? (
              <Spinner label="Loading verification documents and photos…" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* 1. Death Certificate */}
                <div style={{ background: '#f8fafc', padding: 10, borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 6, color: '#334155' }}>
                    1. Death Certificate
                  </div>
                  {cert?.startsWith('data:image') ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <img
                        src={cert}
                        alt="Death certificate"
                        style={{ width: 100, height: 75, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', border: '1px solid #cbd5e1' }}
                        onClick={() => setZoomImg({ url: cert, title: 'Death Certificate' })}
                        title="Click to zoom"
                      />
                      <button type="button" className="btn sm" onClick={() => setZoomImg({ url: cert, title: 'Death Certificate' })}>View Full Size</button>
                    </div>
                  ) : cert ? (
                    <a className="btn sm primary" href={cert} target="_blank" rel="noreferrer" download={`${s.receiptNo}-death-certificate`}>
                      Open / Download Document
                    </a>
                  ) : (
                    <span className="muted small">Not uploaded</span>
                  )}
                </div>

                {/* 2. Staff House Visit Photo */}
                <div style={{ background: '#f8fafc', padding: 10, borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 6, color: '#334155' }}>
                    2. Staff House Visit Verification Photo
                  </div>
                  {houseVisitPhoto ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <img
                        src={houseVisitPhoto}
                        alt="Staff House Visit"
                        style={{ width: 100, height: 75, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', border: '1px solid #cbd5e1' }}
                        onClick={() => setZoomImg({ url: houseVisitPhoto, title: 'Staff House Visit Verification Photo' })}
                        title="Click to zoom"
                      />
                      <button type="button" className="btn sm" onClick={() => setZoomImg({ url: houseVisitPhoto, title: 'Staff House Visit Verification Photo' })}>View Full Size</button>
                    </div>
                  ) : (
                    <span className="muted small">No house visit photo uploaded</span>
                  )}
                </div>

                {/* 3. Three Death Photos Clicked via App */}
                <div style={{ background: '#f8fafc', padding: 10, borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 6, color: '#334155' }}>
                    3. Death Spot / Cremation Photos (3 Photos clicked via App)
                  </div>
                  {deathPhotos.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {deathPhotos.map((photo, idx) => (
                        <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                          <img
                            src={photo}
                            alt={`Death photo ${idx + 1}`}
                            style={{ width: 90, height: 70, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', border: '1px solid #cbd5e1' }}
                            onClick={() => setZoomImg({ url: photo, title: `Death Photo ${idx + 1} of ${deathPhotos.length}` })}
                            title="Click to zoom"
                          />
                          <span className="muted small">Photo {idx + 1}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="muted small">No death photos uploaded</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Image Preview / Zoom Modal */}
      {zoomImg && (
        <Modal open title={zoomImg.title} onClose={() => setZoomImg(null)} size="lg"
          footer={<button className="btn" onClick={() => setZoomImg(null)}>Close</button>}>
          <div style={{ textAlign: 'center', maxHeight: '75vh', overflow: 'auto' }}>
            <img src={zoomImg.url} alt={zoomImg.title} style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: 6 }} />
          </div>
        </Modal>
      )}
    </>
  );
}

// Search a loan (Loan ID, form ID, borrower, group), then choose the borrower of it.
function LoanFinder({ onPick }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const q = useDebounce(search);
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    let live = true;
    setSearching(true);
    api.emi.search(q.trim(), true).then((r) => live && setResults(r.items)).catch(() => live && setResults([])).finally(() => live && setSearching(false));
    return () => {
      live = false;
    };
  }, [q]);
  return (
    <div className="panel">
      <div className="toolbar">
        <input type="search" className="toolbar-search" placeholder="Search by Loan ID, form ID, borrower or group code / name" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus aria-label="Search loan" />
      </div>
      {q.trim().length < 2 ? <EmptyState title="Search a loan" description="Type at least 2 letters of the Loan ID (for example LN00000001), borrower or group." /> : searching && !results.length ? <Spinner label="Searching…" /> : results.length === 0 ? (
        <EmptyState title="No loan found" description="Only open loans can be found here: paid out and not yet settled or fully repaid." />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Loan ID</th><th>Form ID</th><th>Borrower / Group</th><th>Branch</th><th>Scheme</th><th>Paid on</th><th className="actions-col">Actions</th></tr></thead>
            <tbody>
              {results.map((l) => (
                <tr key={l.id}>
                  <td data-label="Loan ID"><strong>{l.loanId || '—'}</strong></td>
                  <td data-label="Form ID">{l.formId}</td>
                  <td data-label="Borrower">{l.who}</td>
                  <td data-label="Branch">{l.branch}</td>
                  <td data-label="Scheme">{l.schemeName}</td>
                  <td data-label="Paid on">{dmy(l.paidOn)}</td>
                  <td data-label="Actions" className="actions-col"><button className="btn sm primary" onClick={() => onPick(l)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// The loan and its borrower(s): a group loan asks which member.
function BorrowerStep({ loan, onBack, children }) {
  const [members, setMembers] = useState(null);
  const [member, setMember] = useState('');
  useEffect(() => {
    api.emi.loan(loan.id).then((d) => {
      setMembers(d.borrowers);
      if (d.borrowers.length === 1) setMember(String(d.borrowers[0].member));
    }).catch(() => setMembers([]));
  }, [loan.id]);
  if (!members) return <Spinner label="Loading the loan…" />;
  return (
    <>
      <div style={{ marginBottom: 10 }}><button className="btn" onClick={onBack}>← Search another loan</button></div>
      {members.length > 1 && (
        <div className="panel" style={{ padding: 16, marginBottom: 14 }}>
          <h3 className="section-title">Which member?</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Member</th><th className="num">Outstanding</th><th>Status</th><th className="actions-col">Actions</th></tr></thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.code} style={String(m.member) === member ? { background: 'var(--primary-soft, #eef7f4)' } : undefined}>
                    <td data-label="Member"><strong>{m.code}</strong> {m.name}</td>
                    <td data-label="Outstanding" className="num">{inr(m.outstanding)}</td>
                    <td data-label="Status">{m.settled ? <span className="badge grey">Settled ({m.settled.kind})</span> : m.closed ? <span className="badge green">Paid up</span> : <span className="badge grey">Running</span>}</td>
                    <td data-label="Actions" className="actions-col"><button className="btn sm" disabled={m.settled || m.closed} onClick={() => setMember(String(m.member))}>{String(m.member) === member ? 'Selected' : 'Select'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {member ? children(member) : members.length > 1 ? <div className="muted">Select the member.</div> : null}
    </>
  );
}

// Loads what the settlement forms show (loan, outstanding, verifier).
function usePreview(loanId, member) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.settlements.preview({ loan: loanId, member }).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), [loanId, member]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, load };
}

function LoanSummary({ d }) {
  return (
    <div className="panel" style={{ padding: 16, marginBottom: 14 }}>
      <DetailList items={[
        ['Loan ID', d.loan.loanId || d.loan.formId], ['Form ID', d.loan.formId], ['Branch', d.loan.branch], ['Borrower', `${d.borrower.code} — ${d.borrower.name}`],
        ...(d.loan.group ? [['Group', d.loan.group]] : []), ['Scheme', d.loan.schemeName], ['Loan amount', inr(d.loan.amount)], ['Installments', `${d.loan.installments} (${d.loan.modeLabel})`], ['Paid out on', dmy(d.loan.paidOn)],
        ['Installments paid', `${d.state.paidInstallments} of ${d.loan.installments} — ${inr(d.state.paid)}`], ['Due now', inr(d.state.due)], ['Outstanding', inr(d.state.outstanding)],
        ...(d.state.nextDue ? [['Next installment', `${d.state.nextDue.no} on ${dmy(d.state.nextDue.dueDate)} — ${inr(d.state.nextDue.amount)}`]] : []),
      ]} />
    </div>
  );
}

// ---- loan settlement ---------------------------------------------------------------------------------------------------
function LoanSettleForm({ loanId, member, canSettle, onDone }) {
  const toast = useToast();
  const { data: d, error, load } = usePreview(loanId, member);
  const [form, setForm] = useState({ settledOn: todayISO(), amount: '', payMode: 'cash', bankAccount: '', reference: '', remark: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (d) setForm((f) => ({ ...f, amount: String(d.state.outstanding) }));
  }, [d?.state.outstanding]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!d) return <Spinner label="Loading…" />;
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const amount = Number(form.amount) || 0;
  const short = Math.round((d.state.outstanding - amount) * 100) / 100 !== 0;

  async function settle() {
    if (short) { setErrors({ amount: `The settlement amount must be exactly the outstanding ${inr(d.state.outstanding)}` }); return; }
    setBusy(true);
    setErrors({});
    try {
      const r = await api.settlements.settleLoan({ loan: loanId, member, ...form, settledOn: undefined });
      toast.success(`Loan settled — ${r.settlement.receiptNo}`);
      onDone(r.settlement);
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <LoanSummary d={d} />
      {d.state.settled ? <div className="notice">This loan is already settled ({d.state.settled.receiptNo}).</div> : d.state.outstanding <= 0 ? <div className="notice">All installments are paid. There is nothing to settle.</div> : !canSettle ? (
        <div className="muted">You can view the loan but not settle it.</div>
      ) : (
        <div className="panel" style={{ padding: 16 }}>
          <h3 className="section-title">Settle the loan</h3>
          <div className="form-grid">
            <FormField id="sdate" label="Settlement date" hint="Branch working date (Sundays & holidays skipped)" error={errors.settledOn}>
              <input id="sdate" type="date" value={d.today} disabled readOnly />
            </FormField>
            <FormField id="samount" label="Settlement amount received (₹)" required error={errors.amount} hint={`Must be exactly the outstanding ${inr(d.state.outstanding)}; a lower amount does not settle the loan`}>
              <input id="samount" inputMode="decimal" value={form.amount} onChange={(e) => { setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })); setErrors((x) => ({ ...x, amount: undefined })); }} />
            </FormField>
            <FormField id="smode" label="Paid by" required error={errors.payMode}>
              <select id="smode" value={form.payMode} onChange={set('payMode')}>
                {Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </FormField>
            <BankAccountSelect id="sbank" mode={form.payMode} value={form.bankAccount} onChange={(v) => setForm((f) => ({ ...f, bankAccount: v }))} error={errors.bankAccount} />
            <FormField id="sref" label="Reference no." hint="Optional">
              <input id="sref" value={form.reference} maxLength={60} onChange={set('reference')} />
            </FormField>
            <FormField id="sremark" label="Remark" error={errors.remark} className="span-2">
              <input id="sremark" value={form.remark} maxLength={300} onChange={set('remark')} />
            </FormField>
          </div>
          <button className="btn primary" disabled={busy} onClick={settle}>{busy ? 'Settling…' : `Settle loan — receive ${inr(amount)}`}</button>
        </div>
      )}
    </>
  );
}

// ---- death settlement --------------------------------------------------------------------------------------------------
function DeathSettleForm({ loanId, member, canSettle, onDone }) {
  const { user } = useAuth();
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);
  const toast = useToast();
  const { data: d, error, load } = usePreview(loanId, member);
  const [form, setForm] = useState({ deathDate: '', settledOn: todayISO(), remark: '', claimRef: '', certificate: '', certificateName: '', deathPhoto: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const photoRef = useRef(null);
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!d) return <Spinner label="Loading…" />;
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };

  async function pickPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = await compressImage(file, { maxSide: 1200, quality: 0.75 });
      setForm((f) => ({ ...f, deathPhoto: data }));
    } catch (ex) {
      toast.error(ex.message);
    }
  }

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      let data;
      if (file.type === 'application/pdf') {
        if (file.size > MAX_DOC_BYTES) throw new Error('The PDF must be 800 KB or smaller');
        data = await new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = () => reject(new Error('Could not read the file')); fr.readAsDataURL(file); });
      } else data = await compressImage(file, { maxSide: 1600, quality: 0.75 });
      setForm((f) => ({ ...f, certificate: data, certificateName: file.name }));
      setErrors((x) => ({ ...x, certificate: undefined }));
    } catch (ex) {
      setErrors((x) => ({ ...x, certificate: ex.message }));
    }
  }

  async function save() {
    const found = {};
    if (!form.deathDate) found.deathDate = 'Enter the date of death';
    if (!form.certificate) found.certificate = 'Upload the death certificate';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const r = await api.settlements.settleDeath({ loan: loanId, member, ...form, settledOn: undefined });
      if (r.pending) {
        toast.success(`Death settlement request submitted (${r.settlement.receiptNo}) — awaiting Admin approval`);
      } else {
        toast.success(`Death settlement saved — ${r.settlement.receiptNo}${r.memberBlocked ? '. The member is blocked.' : ''}`);
      }
      onDone(r.settlement);
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <LoanSummary d={d} />
      {d.state.settled ? <div className="notice">This loan is already settled ({d.state.settled.receiptNo}).</div> : d.state.outstanding <= 0 ? <div className="notice">All installments are paid. There is nothing to settle.</div> : !canSettle ? (
        <div className="muted">You can view the loan but not settle it.</div>
      ) : (
        <div className="panel" style={{ padding: 16 }}>
          <h3 className="section-title">{isAdmin ? 'Death settlement' : 'Death settlement request'} — {d.borrower.code} {d.borrower.name}</h3>
          <div className="form-grid">
            <FormField id="dbranch" label="Branch"><input id="dbranch" value={d.loan.branch} disabled /></FormField>
            <FormField id="ddeath" label="Date of death" required error={errors.deathDate}>
              <input id="ddeath" type="date" max={todayISO()} min={d.loan.paidOn} value={form.deathDate} onChange={set('deathDate')} />
            </FormField>
            <FormField id="dsettle" label="Settlement date" hint="Branch working date (Sundays & holidays skipped)" error={errors.settledOn}>
              <input id="dsettle" type="date" value={d.today} disabled readOnly />
            </FormField>
            <FormField id="dclaim" label="Insurance claim reference" hint="Optional" error={errors.claimRef}>
              <input id="dclaim" value={form.claimRef} maxLength={60} onChange={set('claimRef')} />
            </FormField>
            <FormField id="dver-code" label="Verifier employee code" hint="Taken from your login"><input id="dver-code" value={d.verifier.code} disabled /></FormField>
            <FormField id="dver-name" label="Verifier name" hint="Taken from your login"><input id="dver-name" value={d.verifier.name} disabled /></FormField>
            <FormField id="dcert" label="Death certificate" required error={errors.certificate} className="span-2" hint="PDF or image, up to 800 KB">
              <div className="stamp-upload">
                {form.certificate ? <div className="muted">{form.certificateName || 'Certificate attached'}</div> : <div className="stamp-empty">No file</div>}
                <div className="stamp-actions">
                  <input id="dcert" ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg" onChange={pick} hidden />
                  <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>{form.certificate ? 'Change' : 'Upload'}</button>
                  {form.certificate && <button type="button" className="btn sm danger-outline" onClick={() => setForm((f) => ({ ...f, certificate: '', certificateName: '' }))}>Remove</button>}
                </div>
              </div>
            </FormField>
            {/* Point 23: Upload death photo */}
            <FormField id="dphoto" label="Death photo / verification photo" className="span-2" hint="Optional photo of the deceased / verification">
              <div className="stamp-upload">
                {form.deathPhoto ? <img src={form.deathPhoto} alt="Death photo" style={{ height: 60, borderRadius: 4 }} /> : <div className="stamp-empty">No photo</div>}
                <div className="stamp-actions">
                  <input id="dphoto" ref={photoRef} type="file" accept="image/*" onChange={pickPhoto} hidden />
                  <button type="button" className="btn sm" onClick={() => photoRef.current?.click()}>{form.deathPhoto ? 'Change' : 'Upload photo'}</button>
                  {form.deathPhoto && <button type="button" className="btn sm danger-outline" onClick={() => setForm((f) => ({ ...f, deathPhoto: '' }))}>Remove</button>}
                </div>
              </div>
            </FormField>
            <FormField id="dremark" label="Remark" error={errors.remark} className="span-2">
              <input id="dremark" value={form.remark} maxLength={300} onChange={set('remark')} />
            </FormField>
          </div>
          {isAdmin ? (
            <div className="notice warn" style={{ margin: '10px 0' }}>
              The outstanding {inr(d.state.outstanding)} is settled against the loan insurance and no more EMI is due on this loan. After saving, <strong>{d.borrower.name} is blocked automatically</strong>.
            </div>
          ) : (
            <div className="notice" style={{ margin: '10px 0', borderColor: 'var(--brand, #1976d2)', background: 'var(--surface-2, #e8f4fd)' }}>
              <strong>Death settlement request:</strong> This request will be submitted to Admin for approval. Once approved by Admin, the loan will be closed and <strong>{d.borrower.name} will be blocked automatically</strong>.
            </div>
          )}
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : (isAdmin ? 'Save death settlement' : 'Submit death settlement request')}</button>
        </div>
      )}
    </>
  );
}

// ---- guarantor death: the loan carries on, the guarantor has to be changed before the next loan -------------------------------------
function GuarantorDeathForm({ loanId, member, canSettle, onDone }) {
  const toast = useToast();
  const { data: d, error, load } = usePreview(loanId, member);
  const [form, setForm] = useState({ deathDate: '', remark: '', certificate: '', certificateName: '', closeLoan: false });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!d) return <Spinner label="Loading…" />;

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      let data;
      if (file.type === 'application/pdf') {
        if (file.size > MAX_DOC_BYTES) throw new Error('The PDF must be 800 KB or smaller');
        data = await new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = () => reject(new Error('Could not read the file')); fr.readAsDataURL(file); });
      } else data = await compressImage(file, { maxSide: 1600, quality: 0.75 });
      setForm((f) => ({ ...f, certificate: data, certificateName: file.name }));
      setErrors((x) => ({ ...x, certificate: undefined }));
    } catch (ex) {
      setErrors((x) => ({ ...x, certificate: ex.message }));
    }
  }

  async function save() {
    const found = {};
    if (!form.deathDate) found.deathDate = 'Enter the date of death';
    if (!form.certificate) found.certificate = 'Upload the death certificate';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const r = await api.settlements.recordGuarantorDeath({ loan: loanId, member, ...form });
      if (r.loanClosed) {
        toast.success(r.message || 'Guarantor death recorded and loan closed under settlement!');
        onDone(r.settlement);
      } else {
        toast.success(`${r.message}. ${d.borrower.name} needs a new guarantor before the next loan.`);
        onDone(null);
      }
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const g = d.guarantor;
  return (
    <>
      <LoanSummary d={d} />
      {!g ? <div className="notice">This member has no guarantor.</div> : g.deceasedOn ? (
        <div className="notice">The death of the guarantor {g.name} is already recorded ({dmy(g.deceasedOn)}). Change the guarantor under Member Details → Guarantor &amp; Nominee.</div>
      ) : !canSettle ? <div className="muted">You can view the loan but not record a death.</div> : (
        <div className="panel" style={{ padding: 16 }}>
          <h3 className="section-title">Guarantor death — {g.name} (guarantor of {d.borrower.code} {d.borrower.name})</h3>
          <div className="form-grid">
            <FormField id="gname" label="Guarantor"><input id="gname" value={g.name} disabled /></FormField>
            <FormField id="gdeath" label="Date of death" required error={errors.deathDate}>
              <input id="gdeath" type="date" max={todayISO()} value={form.deathDate} onChange={(e) => { setForm((f) => ({ ...f, deathDate: e.target.value })); setErrors((x) => ({ ...x, deathDate: undefined })); }} />
            </FormField>
            <FormField id="gaction" label="Guarantor Demise Action" className="span-2">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="closeLoanOpt"
                    checked={form.closeLoan === true}
                    onChange={() => setForm((f) => ({ ...f, closeLoan: true }))}
                  />
                  <span><strong>Close this loan under Demise Settlement</strong> (Outstanding waived against insurance &amp; loan officially closed)</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="closeLoanOpt"
                    checked={form.closeLoan !== true}
                    onChange={() => setForm((f) => ({ ...f, closeLoan: false }))}
                  />
                  <span><strong>Keep loan active &amp; require Guarantor Change</strong> (Borrower continues paying EMI; requires new guarantor for future loans)</span>
                </label>
              </div>
            </FormField>
            <FormField id="gver-code" label="Verifier employee code" hint="Taken from your login"><input id="gver-code" value={d.verifier.code} disabled /></FormField>
            <FormField id="gver-name" label="Verifier name" hint="Taken from your login"><input id="gver-name" value={d.verifier.name} disabled /></FormField>
            <FormField id="gcert" label="Death certificate" required error={errors.certificate} className="span-2" hint="PDF or image, up to 800 KB">
              <div className="stamp-upload">
                {form.certificate ? <div className="muted">{form.certificateName || 'Certificate attached'}</div> : <div className="stamp-empty">No file</div>}
                <div className="stamp-actions">
                  <input id="gcert" ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg" onChange={pick} hidden />
                  <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>{form.certificate ? 'Change' : 'Upload'}</button>
                  {form.certificate && <button type="button" className="btn sm danger-outline" onClick={() => setForm((f) => ({ ...f, certificate: '', certificateName: '' }))}>Remove</button>}
                </div>
              </div>
            </FormField>
            <FormField id="gremark" label="Remark" error={errors.remark} className="span-2">
              <input id="gremark" value={form.remark} maxLength={300} onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))} />
            </FormField>
          </div>
          <div className="notice warn" style={{ margin: '10px 0' }}>
            {form.closeLoan ? (
              <>The outstanding on this loan will be <strong>waived and closed under Guarantor Demise Settlement</strong>.</>
            ) : (
              <>The loan is <strong>not</strong> settled and {d.borrower.name} keeps paying the EMI. Before a new loan requisition can be made for {d.borrower.name}, an admin has to change the guarantor.</>
            )}
          </div>
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : form.closeLoan ? 'Settle & Close Loan' : 'Record guarantor death'}</button>
        </div>
      )}
    </>
  );
}

function GuarantorDeaths({ reloadKey }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    api.settlements.guarantorDeaths({}).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [reloadKey]);
  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <h3 className="section-title">Guarantor deaths</h3>
      {!items ? <Spinner label="Loading…" /> : items.length === 0 ? <EmptyState title="No guarantor death recorded" description="Members whose guarantor has died and still have to change the guarantor appear here." /> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Member</th><th>Branch</th><th>Guarantor</th><th>Died on</th><th>Recorded</th></tr></thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.memberId}>
                  <td data-label="Member"><strong>{x.code}</strong> {x.name}</td>
                  <td data-label="Branch">{x.branch?.name || '—'}</td>
                  <td data-label="Guarantor">{x.guarantor}{x.guarantorMobile && <div className="muted small">{x.guarantorMobile}</div>}</td>
                  <td data-label="Died on">{dmy(x.diedOn)}</td>
                  <td data-label="Recorded">{dmy(x.recordedOn)}{x.recordedBy && <div className="muted small">by {x.recordedBy}</div>}{x.remark && <div className="muted small">{x.remark}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- history of settlements --------------------------------------------------------------------------------------------
function History({ kind, reloadKey, onCancelled }) {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(kind === 'death' ? 'pending' : 'active');
  const [type, setType] = useState('all'); // loan settlements only, auto settle only, or both
  const [branch, setBranch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [busy, setBusy] = useState(false);
  const q = useDebounce(search);

  useEffect(() => {
    api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {});
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.settlements.list({ kind: kind === 'loan' && type !== 'all' ? type : kind, page, limit: LIMIT, status, branch, from, to, q }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [kind, type, page, status, branch, from, to, q]);
  useEffect(() => {
    load();
  }, [load, reloadKey]);
  useEffect(() => setPage(1), [status, type, branch, from, to, q]);

  async function approve(s) {
    if (!window.confirm(`Approve death settlement for ${s.memberCode} ${s.memberName || ''}? The loan will be closed and member blocked.`)) return;
    setBusy(true);
    try {
      const r = await api.settlements.approve(s.id);
      toast.success(r.message || 'Death settlement approved — loan closed and member blocked');
      load();
      if (onCancelled) onCancelled();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (reason.trim().length < 3) return setReasonError('Enter the rejection reason');
    setBusy(true);
    try {
      await api.settlements.reject(rejecting.id, reason.trim());
      toast.success('Death settlement request rejected');
      setRejecting(null);
      setReason('');
      load();
    } catch (err) {
      setReasonError(err.errors?.reason || err.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (reason.trim().length < 3) return setReasonError('Enter the reason');
    setBusy(true);
    try {
      const r = await api.settlements.cancel(cancelling.id, reason.trim());
      toast.success(r.memberStaysBlocked ? 'Settlement cancelled. The member stays blocked; unblock under Block / Unblock if needed.' : 'Settlement cancelled — the loan is open again');
      setCancelling(null);
      setReason('');
      load();
      if (onCancelled) onCancelled(); // the loan that is open on this page is open again
    } catch (err) {
      setReasonError(err.errors?.reason || err.message);
    } finally {
      setBusy(false);
    }
  }

  const death = kind === 'death';
  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <h3 className="section-title">{death ? 'Death settlements' : 'Loan settlements'}</h3>
      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        <input type="search" className="toolbar-search" placeholder="Search receipt, Loan ID, borrower or group" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search settlements" />
        {!death && (
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Settlement type">
            <option value="all">All settlements</option>
            <option value="manual">Loan settlement</option>
            <option value="auto">Auto settle</option>
          </select>
        )}
        {branches.length > 1 && (
          <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch">
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
          </select>
        )}
        <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="active">Settled (Approved)</option>
          {death && <option value="pending">Pending Approval</option>}
          <option value="cancelled">Cancelled</option>
          {death && <option value="rejected">Rejected</option>}
          <option value="all">All statuses</option>
        </select>
      </div>
      {loading && !data.items.length ? <Spinner label="Loading…" /> : error ? <ErrorState message={error} onRetry={load} /> : data.items.length === 0 ? (
        <EmptyState title={death ? 'No death settlement' : 'No loan settlement'} description="Settlements appear here." />
      ) : (
        <>
          <div className={`table-wrap${loading ? ' dim' : ''}`}>
            <table className="data-table">
              <thead>
                <tr><th>Receipt</th><th>Date</th><th>Loan ID</th><th>Borrower</th><th>Branch</th>{death && <th>Died on</th>}<th className="num">Outstanding</th><th className="num">{death ? 'Insurance' : 'Waived'}</th>{!death && <th className="num">Received</th>}{death && <th>Verified by</th>}<th className="actions-col">Actions</th></tr>
              </thead>
              <tbody>
                {data.items.map((s) => (
                  <tr key={s.id}>
                    <td data-label="Receipt">
                      <strong>{s.receiptNo}</strong>
                      {s.status === 'pending' && <div><span className="badge amber">Pending Approval</span></div>}
                      {s.status === 'rejected' && <div><span className="badge danger">Rejected</span></div>}
                      {s.status === 'cancelled' && <div><span className="badge danger">Cancelled</span></div>}
                      {s.auto && <div><span className="badge green">Auto settle</span></div>}
                    </td>
                    <td data-label="Date">{dmy(s.settledOn)}</td>
                    <td data-label="Loan ID">{s.loanId || s.formId}</td>
                    <td data-label="Borrower"><strong>{s.memberCode}</strong> {s.memberName}{s.group && <div className="muted small">{s.group}</div>}</td>
                    <td data-label="Branch">{s.branch?.name || '—'}</td>
                    {death && <td data-label="Died on">{dmy(s.deathDate)}</td>}
                    <td data-label="Outstanding" className="num">{inr(s.outstanding)}</td>
                    <td data-label="Waived" className="num">{inr(s.waiver)}</td>
                    {!death && <td data-label="Received" className="num">{inr(s.amount)}</td>}
                    {death && <td data-label="Verified by">{s.verifier?.code || '—'}</td>}
                    <td data-label="Actions" className="actions-col">
                      <div className="row-actions">
                        <button className="btn sm" onClick={() => setView(s)}>View</button>
                        {isAdmin && death && s.status === 'pending' && (
                          <>
                            <button className="btn sm primary" onClick={() => approve(s)} disabled={busy}>Approve</button>
                            <button className="btn sm danger-outline" onClick={() => { setRejecting(s); setReason(''); setReasonError(''); }} disabled={busy}>Reject</button>
                          </>
                        )}
                        {s.status === 'active' && (
                          <>
                            <button className="btn sm" title="Print Receipt" onClick={() => { if (!printSettlement(s)) toast.error('Allow pop-ups to print'); }}>Receipt</button>
                            <button className="btn sm primary" title="Download / Print NOC" onClick={() => { if (!printNoc(s)) toast.error('Allow pop-ups to print'); }}>NOC</button>
                          </>
                        )}
                        {isAdmin && s.status === 'active' && !s.auto && <button className="btn sm danger-outline" onClick={() => { setCancelling(s); setReason(''); setReasonError(''); }}>Cancel</button>}
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
      {view && <SettlementDialog settlement={view} onClose={() => setView(null)} />}
      {cancelling && (
        <Modal open title={`Cancel ${cancelling.receiptNo}?`} onClose={() => setCancelling(null)} busy={busy}
          footer={<><button className="btn" onClick={() => setCancelling(null)} disabled={busy}>Keep</button><button className="btn danger-outline" onClick={cancel} disabled={busy}>Cancel settlement</button></>}>
          <p style={{ marginTop: 0 }}>The loan of this borrower is open again and EMI is due as before.{death ? ' The member stays blocked until you unblock them.' : ''}</p>
          <FormField id="screason" label="Reason" required error={reasonError}>
            <input id="screason" value={reason} maxLength={200} autoFocus onChange={(e) => { setReason(e.target.value); setReasonError(''); }} />
          </FormField>
        </Modal>
      )}
      {rejecting && (
        <Modal open title={`Reject request ${rejecting.receiptNo}?`} onClose={() => setRejecting(null)} busy={busy}
          footer={<><button className="btn" onClick={() => setRejecting(null)} disabled={busy}>Cancel</button><button className="btn danger-outline" onClick={reject} disabled={busy}>Reject request</button></>}>
          <p style={{ marginTop: 0 }}>Rejecting this death settlement request means the loan will NOT be closed and will continue as active.</p>
          <FormField id="rjreason" label="Rejection reason" required error={reasonError}>
            <input id="rjreason" value={reason} maxLength={200} autoFocus onChange={(e) => { setReason(e.target.value); setReasonError(''); }} />
          </FormField>
        </Modal>
      )}
    </div>
  );
}

function SettlementPage({ kind }) {
  const { user } = useAuth();
  const canSettle = SETTLERS.includes(user?.role);
  const death = kind === 'death';
  const [loan, setLoan] = useState(null);
  const [done, setDone] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [who, setWho] = useState('member'); // death settlement: member death or guarantor death
  const guarantorCase = death && who === 'guarantor';
  const Form = guarantorCase ? GuarantorDeathForm : death ? DeathSettleForm : LoanSettleForm;

  return (
    <>
      <PageHeader
        title={death ? 'Death Settlement' : 'Loan Settlement'}
        description={death ? 'Search the Loan ID and open it, then choose who has died: the member (the loan is settled and the member is blocked) or the guarantor (the loan carries on; the guarantor has to be changed before the next loan). Enter the date of death and upload the death certificate.' : 'Search the Loan ID to see the outstanding and settle the loan in one go.'}
      />
      {loan ? (
        <BorrowerStep key={`${loan.id}-${reloadKey}`} loan={loan} onBack={() => { setLoan(null); setWho('member'); }}>
          {(member) => (
            <>
              {death && (
                <div className="panel" style={{ marginBottom: 14, padding: 12 }}>
                  <FormField id="who" label="Who has died" required>
                    <select id="who" value={who} onChange={(e) => setWho(e.target.value)}>
                      <option value="member">Member death</option>
                      <option value="guarantor">Guarantor death</option>
                    </select>
                  </FormField>
                </div>
              )}
              <Form key={`${loan.id}-${member}-${who}-${reloadKey}`} loanId={loan.id} member={member} canSettle={canSettle} onDone={(s) => { if (s) setDone(s); setReloadKey((k) => k + 1); }} />
            </>
          )}
        </BorrowerStep>
      ) : <LoanFinder onPick={setLoan} />}
      <History kind={kind} reloadKey={reloadKey} onCancelled={() => setReloadKey((k) => k + 1)} />
      {death && <GuarantorDeaths reloadKey={reloadKey} />}
      {done && <SettlementDialog settlement={done} onClose={() => setDone(null)} />}
    </>
  );
}

export const LoanSettlement = () => <SettlementPage kind="loan" />;
export const DeathSettlement = () => <SettlementPage kind="death" />;
