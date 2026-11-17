import BankAccountSelect from '../components/BankAccountSelect.jsx';
import { PhotoField } from './NewBorrower.jsx';
import { workDateOf } from '../utils/workDate.js';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';

const MODE_LABEL = { cash: 'Cash', bank: 'Bank', upi: 'UPI', cheque: 'Cheque', security: 'Security' };
const inr = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dmy = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-IN') : '—');
const today = () => {
  const d = new Date();
  const localStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  try {
    const istStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
    return istStr > localStr ? istStr : localStr;
  } catch {
    return localStr;
  }
};

const groupByDay = (rows) => {
  const map = {};
  for (const r of rows) {
    if (!r.date) continue;
    const dObj = new Date(`${r.date}T00:00:00`);
    const dayLabel = `${dObj.toLocaleDateString('en-IN', { weekday: 'short' })}, ${dObj.toLocaleDateString('en-IN')}`;
    map[dayLabel] = (map[dayLabel] || 0) + (Number(r.amount) || 0);
  }
  return map;
};

// One side of the cashbook: a line for everything that is received (or paid), the amount, and what it is made of when clicked.
function Side({ title, lines, rows, total, totalLabel, openRow, closeRow, tone, extra, canDelete, onDelete }) {
  const [open, setOpen] = useState('');
  return (
    <div className="panel" style={{ padding: 14, flex: '1 1 420px', minWidth: 0 }}>
      <h3 className="section-title">{title}</h3>
      <div className="table-wrap">
        <table className="data-table">
          <tbody>
            {openRow}
            {lines.map((l) => {
              const mine = rows.filter((r) => r.cat === l.key);
              return (
                <Fragment key={l.key}>
                  <tr style={l.memo ? { opacity: 0.65, fontStyle: 'italic' } : undefined}>
                    <td data-label="Particulars">
                      {mine.length > 0 ? <button type="button" className="link-btn" onClick={() => setOpen(open === l.key ? '' : l.key)}>{open === l.key ? '▾' : '▸'} {l.label}</button> : l.label}
                      {l.memo && <div className="muted small">for information, not in the total</div>}
                    </td>
                    <td data-label="Entries" className="num muted small">{l.count || ''}</td>
                    <td data-label="Amount" className="num">{inr(l.amount)}</td>
                  </tr>
                  {open === l.key && mine.length > 0 && (
                    <tr>
                      <td colSpan={3} style={{ background: 'var(--surface-2, #f6f8f8)' }}>
                        {(l.key.includes('weekly') || l.key.includes('daily') || l.key.includes('collection')) && (
                          <div style={{ marginBottom: 10, padding: '8px 12px', background: '#fff', borderRadius: 6, border: '1px solid var(--border-color, #e2e8f0)' }}>
                            <strong style={{ fontSize: '0.8rem', color: 'var(--text-color, #111)', display: 'block', marginBottom: 4 }}>
                              {l.key.includes('weekly') ? '📅 Weekly Collection (Day-wise Breakdown):' : '📅 Daily Collection (Per Day Breakdown):'}
                            </strong>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              {Object.entries(groupByDay(mine)).map(([dayDate, sumAmt]) => (
                                <span key={dayDate} className="badge grey" style={{ fontSize: '0.78rem', background: '#f1f5f9', border: '1px solid #cbd5e1' }}>
                                  <strong>{dayDate}:</strong> {inr(sumAmt)}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        <table className="data-table" style={{ margin: 0 }}>
                          <thead><tr><th>Date</th><th>Particulars</th><th>Mode</th><th className="num">Amount</th>{canDelete && <th />}</tr></thead>
                          <tbody>
                            {mine.map((r, i) => (
                              <tr key={i}>
                                <td data-label="Date">{dmy(r.date)}</td>
                                <td data-label="Particulars">{r.particulars || '—'}<div className="muted small">{r.branch}{r.ref ? ` · ${r.ref}` : ''}</div></td>
                                <td data-label="Mode">{MODE_LABEL[r.mode] || r.mode || '—'}</td>
                                <td data-label="Amount" className="num">{inr(r.amount)}</td>
                                {canDelete && <td>{r.manual && <button type="button" className="btn sm danger-outline" onClick={() => onDelete(r)}>Remove</button>}</td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            <tr style={{ borderTop: '2px solid currentColor' }}>
              <td><strong>{totalLabel}</strong></td><td />
              <td className="num"><span className={`badge ${tone}`}><strong>{inr(total)}</strong></span></td>
            </tr>
            {closeRow}
          </tbody>
        </table>
      </div>
      {extra}
    </div>
  );
}

// Add a line typed in by hand: cash fund, NPA, voucher, bank / cash deposit, fund transfer, staff salary, other.
function EntryDialog({ cats, ledgers, branches, isAdmin, defaultBranch, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ side: 'receive', category: '', branch: defaultBranch, date: today(), amount: '', mode: 'cash', bankAccount: '', remark: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [workNote, setWorkNote] = useState('');
  // the entry is made on the date the branch is on (the day after its last approved day close)
  useEffect(() => {
    workDateOf(form.branch).then((d) => { if (d) { setForm((f) => ({ ...f, date: d })); setWorkNote(d); } else setWorkNote(''); }).catch(() => {});
  }, [form.branch]);
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value, ...(k === 'side' ? { category: '' } : {}) })); setErrors((x) => ({ ...x, [k]: undefined })); };
  async function save() {
    setBusy(true);
    setErrors({});
    try {
      const isLedger = form.category.startsWith('ledger:');
      await api.cashbookEntry({ ...form, category: isLedger ? '' : form.category, ledger: isLedger ? form.category.slice(7) : undefined });
      toast.success('Entry added to the cashbook');
      onSaved();
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title="Add a cashbook entry" onClose={onClose} busy={busy}
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Close</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Add entry'}</button></>}>
      <div className="form-grid">
        <FormField id="cside" label="Side" required error={errors.side}>
          <select id="cside" value={form.side} onChange={set('side')}>
            <option value="receive">Receive side</option>
            <option value="payment">Payment side</option>
          </select>
        </FormField>
        <FormField id="ccat" label="For (Ledger / Voucher Name)" required error={errors.category}>
          <select id="ccat" value={form.category} onChange={set('category')}>
            <option value="">Select</option>
            {(ledgers?.[form.side] || []).length > 0 && (
              <optgroup label="Ledger master (Voucher name)">
                {ledgers[form.side].map((l) => <option key={l.id} value={`ledger:${l.id}`}>{l.name}</option>)}
              </optgroup>
            )}
            {/* the "Other cash entries" are not offered here any more: only the ledger master (voucher names) */}
          </select>
        </FormField>
        {(branches.length > 1 || isAdmin) && (
          <FormField id="cbranch" label="Cashbook of" required error={errors.branch}>
            <select id="cbranch" value={form.branch} onChange={set('branch')}>
              <option value="">Select</option>
              {isAdmin && <option value="ho">Head office</option>}
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
          </FormField>
        )}
        <FormField id="cdate" label="Date" required error={errors.date} hint={workNote ? 'Your branch works on this date only' : undefined}><input id="cdate" type="date" max={today()} value={form.date} readOnly={Boolean(workNote)} onChange={set('date')} /></FormField>
        <FormField id="camount" label="Amount (₹)" required error={errors.amount}>
          <input id="camount" inputMode="decimal" value={form.amount} onChange={(e) => { setForm((f) => ({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })); setErrors((x) => ({ ...x, amount: undefined })); }} />
        </FormField>
        <FormField id="cmode" label="By" required error={errors.mode}>
          <select id="cmode" value={form.mode} onChange={set('mode')}>
            {['cash', 'bank', 'upi', 'cheque'].map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
          </select>
        </FormField>
        <BankAccountSelect id="cbank" mode={form.mode} value={form.bankAccount} onChange={(v) => setForm((f) => ({ ...f, bankAccount: v }))} error={errors.bankAccount} />
        <FormField id="cremark" label="Remark" className="span-2" hint="For example the bank, the person or the voucher number"><input id="cremark" value={form.remark} maxLength={200} onChange={set('remark')} /></FormField>
      </div>
    </Modal>
  );
}

// Cashbook: the receive side and the payment side line by line, with the opening balance, the totals and the closing balance.
export default function Cashbook() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState('');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  useEffect(() => {
    workDateOf(branch && branch !== 'ho' ? branch : undefined).then((d) => {
      if (d) { setFrom(d); setTo(d); }
    }).catch(() => {});
  }, [branch]);
  const [mode, setMode] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api.groups.branchOptions().then((r) => {
      const items = r.items || [];
      setBranches(items);
      if (!isAdmin && items.length === 1) {
        setBranch(items[0].id);
      }
    }).catch(() => {});
  }, [isAdmin]);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.cashbook({ branch, from, to, mode }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [branch, from, to, mode]);
  useEffect(() => {
    load();
  }, [load]);

  async function remove(r) {
    try {
      await api.cashbookEntryDelete(r.entryId);
      toast.success('Entry removed');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <>
      <PageHeader title="Cashbook" description="Receive side and payment side line by line, with the opening balance, the totals and the closing balance. Click a line to see what it is made of. Cash fund, NPA, voucher, deposits, fund transfer and salary are added by hand." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          {(branches.length > 1 || isAdmin) && (
            <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch">
              <option value="">{isAdmin ? 'All branches and head office' : 'All my branches'}</option>
              {isAdmin && <option value="ho">Head office</option>}
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
          )}
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>From <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /></label>
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>To <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" /></label>
          <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Payment mode">
            <option value="">All modes</option>
            <option value="cash">Cash only</option>
            <option value="bank">Bank</option>
            <option value="upi">UPI</option>
            <option value="cheque">Cheque</option>
          </select>
          <button className="btn" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
          <button className="btn primary" onClick={() => setAdding(true)}>Add entry</button>
        </div>
        {loading && !data ? <Spinner label="Loading…" /> : error ? <ErrorState message={error} onRetry={load} /> : !data ? <EmptyState title="No data" /> : (() => {
          const receiveLines = data.receiveLines || [];
          const totalColl = receiveLines.filter((l) => l.key?.includes('collection')).reduce((s, l) => s + (l.amount || 0), 0);
          const weeklyColl = receiveLines.filter((l) => l.key?.includes('weekly') && l.key?.includes('collection')).reduce((s, l) => s + (l.amount || 0), 0);
          const dailyColl = receiveLines.filter((l) => l.key?.includes('daily') && l.key?.includes('collection')).reduce((s, l) => s + (l.amount || 0), 0);
          const payFormula = (data.totals?.grand || 0) - totalColl;
          return (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, margin: '14px 0 10px' }}>
                <div className="card" style={{ padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  <div className="small muted">Total Collection (Receive Side)</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#16a34a', margin: '4px 0' }}>{inr(totalColl)}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                    <span className="badge" style={{ fontSize: '0.72rem', background: '#e0f2fe', color: '#0369a1' }}>Weekly: {inr(weeklyColl)}</span>
                    <span className="badge" style={{ fontSize: '0.72rem', background: '#fef3c7', color: '#92400e' }}>Daily: {inr(dailyColl)}</span>
                  </div>
                </div>
                <div className="card" style={{ padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  <div className="small muted">Grand Receive Side (Opening + Receipts)</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0284c7', margin: '4px 0' }}>{inr(data.totals.grand)}</div>
                  <div className="small muted">Opening: {inr(data.opening)} · Receipts: {inr(data.totals.receipts)}</div>
                </div>
                <div className="card" style={{ padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  <div className="small muted">Payment Side Net Position</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#dc2626', margin: '4px 0' }}>{inr(payFormula)}</div>
                  <div className="small muted">Receive Side − Receive Collection</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
                <Side title="Receive side" lines={data.receiveLines} rows={data.receipts} total={data.totals.grand} totalLabel="Grand total (opening + receipts)" tone="green" canDelete={isAdmin} onDelete={remove}
                  openRow={<tr><td><strong>Opening balance</strong></td><td /><td className="num"><strong>{inr(data.opening)}</strong></td></tr>}
                  extra={<div className="muted small" style={{ marginTop: 6 }}>Receipts in the period {inr(data.totals.receipts)} · Total collections: {inr(totalColl)}</div>} />
                <Side title="Payment side" lines={data.paymentLines} rows={data.payments} total={data.totals.payments} totalLabel="Total" tone="danger" canDelete={isAdmin} onDelete={remove}
                  closeRow={<><tr><td><strong>Closing balance</strong></td><td /><td className="num"><span className="badge grey"><strong>{inr(data.closing)}</strong></span></td></tr><tr style={{ borderTop: '2px solid currentColor' }}><td><strong>Grand total (payments + closing)</strong></td><td /><td className="num"><span className="badge danger"><strong>{inr(data.totals.grand)}</strong></span></td></tr></>}
                  extra={
                    <div className="muted small" style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div>"Today due" is the balance due (Total scheduled due minus today's collection received) on {dmy(data.asOf)}.</div>
                      <div style={{ padding: '6px 10px', background: 'var(--surface-2, #f1f5f9)', borderRadius: 6, border: '1px dashed #cbd5e1', fontWeight: 600, color: '#334155' }}>
                        Receive side ({inr(data.totals.grand)}) − Receive collection ({inr(totalColl)}) = Payment side ({inr(payFormula)})
                      </div>
                    </div>
                  } />
              </div>
            </>
          );
        })()}
        <CashbookPhotos branch={branch} date={to || from || today()} />
      </div>
      {adding && data && (
        <EntryDialog cats={data.entryCategories} ledgers={data.ledgers} branches={branches} isAdmin={isAdmin} defaultBranch={branch && branch !== '' ? branch : branches.length === 1 ? branches[0].id : ''} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />
      )}
    </>
  );
}

function CashbookPhotos({ branch, date }) {
  const { user } = useAuth();
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);
  const toast = useToast();
  const [photos, setPhotos] = useState({ receivePhoto: '', paymentPhoto: '', uploadedBy: '', branchInfo: null });
  const [allPhotos, setAllPhotos] = useState([]);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const effectiveBranch = branch && branch !== 'ho' ? branch : (!isAdmin && user?.branches?.[0]?._id ? user.branches[0]._id : !isAdmin && user?.branches?.[0] ? user.branches[0] : undefined);

  useEffect(() => {
    let active = true;
    if (!date) return undefined;
    setLoading(true);
    api.cashbookPhotos({ branch: effectiveBranch, date })
      .then((r) => {
        if (active) {
          setPhotos({
            receivePhoto: r.receivePhoto || '',
            paymentPhoto: r.paymentPhoto || '',
            uploadedBy: r.uploadedBy || '',
            branchInfo: r.branch || null,
          });
          setLocked(Boolean(r.locked));
          setAllPhotos(r.allPhotos || []);
        }
      })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [effectiveBranch, date]);

  async function save() {
    setSaving(true);
    try {
      const res = await api.saveCashbookPhotos({
        branch: effectiveBranch,
        date,
        receivePhoto: photos.receivePhoto,
        paymentPhoto: photos.paymentPhoto,
      });
      toast.success('Cashbook photos saved');
      if (res.locked) setLocked(true);
    } catch (err) {
      toast.error(err.message || 'Failed to save photos');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel" style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h3 className="section-title" style={{ margin: 0 }}>Cashbook Photos</h3>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Physical cashbook page photos for {dmy(date)}. Side 1: Receive side · Side 2: Payment side.
            {photos.uploadedBy && <span> (Uploaded by: <strong>{photos.uploadedBy}</strong>)</span>}
          </p>
        </div>
        {!locked && (
          <button className="btn primary" onClick={save} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save photos'}
          </button>
        )}
      </div>

      {locked && (
        <div className="notice warn" style={{ margin: '0 0 14px' }}>
          🔒 <strong>Photos Locked:</strong> Cashbook photos have already been submitted. Branch users cannot edit photos after uploading once. Only Admin can update them.
        </div>
      )}

      {isAdmin && allPhotos.length > 1 && (
        <div style={{ marginBottom: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span className="small muted" style={{ alignSelf: 'center' }}>Uploaded Branches:</span>
          {allPhotos.map((ap, idx) => (
            <button
              key={idx}
              type="button"
              className="btn sm"
              style={{ fontSize: '0.75rem' }}
              onClick={() => {
                setPhotos({
                  receivePhoto: ap.receivePhoto || '',
                  paymentPhoto: ap.paymentPhoto || '',
                  uploadedBy: ap.uploadedBy || '',
                  branchInfo: ap.branch || null,
                });
              }}
            >
              {ap.branch?.name || ap.branch?.code || 'Branch'} ({ap.uploadedBy || 'Staff'})
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <Spinner label="Loading photos…" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          <div style={{ border: '1px solid var(--border-color, #e2e8f0)', borderRadius: 8, padding: 12, background: locked ? 'var(--surface-2, #f9fafb)' : 'transparent' }}>
            <h4 style={{ margin: '0 0 8px' }}>Cashbook 1st side (Receive side)</h4>
            <PhotoField
              id="cb_receive_photo"
              label="Side 1 Photo"
              value={photos.receivePhoto}
              disabled={locked}
              onChange={(v) => !locked && setPhotos((p) => ({ ...p, receivePhoto: v }))}
            />
          </div>
          <div style={{ border: '1px solid var(--border-color, #e2e8f0)', borderRadius: 8, padding: 12, background: locked ? 'var(--surface-2, #f9fafb)' : 'transparent' }}>
            <h4 style={{ margin: '0 0 8px' }}>Cashbook 2nd side (Payment side)</h4>
            <PhotoField
              id="cb_payment_photo"
              label="Side 2 Photo"
              value={photos.paymentPhoto}
              disabled={locked}
              onChange={(v) => !locked && setPhotos((p) => ({ ...p, paymentPhoto: v }))}
            />
          </div>
        </div>
      )}
    </div>
  );
}
