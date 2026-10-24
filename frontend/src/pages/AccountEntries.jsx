import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import ConfirmDialog from '../components/ui/ConfirmDialog.jsx';
import BankAccountSelect from '../components/BankAccountSelect.jsx';
import { workDateOf } from '../utils/workDate.js';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';

const MODE_LABEL = { cash: 'Cash', bank: 'Bank', upi: 'UPI', cheque: 'Cheque' };
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
const branchText = (b) => (b ? `${b.code} — ${b.name}` : 'Head office');

// What each Accounts entry page is. Every entry shows in the Cashbook as well.
const CONFIG = {
  payment_voucher: {
    title: 'Payment Voucher Entry', post: 'payment-vouchers', button: 'New payment voucher', ledger: 'debit', ledgerLabel: 'Debit ledger (paid for)', mode: true,
    description: 'Money paid out against a debit ledger of the Ledger master. It shows on the payment side of the Cashbook.',
  },
  receive_voucher: {
    title: 'Receive Voucher Entry', post: 'receive-vouchers', button: 'New receive voucher', ledger: 'credit', ledgerLabel: 'Credit ledger (received from)', mode: true,
    description: 'Money received against a credit ledger of the Ledger master. It shows on the receive side of the Cashbook.',
  },
  bank_deposit: {
    title: 'Bank Deposit', post: 'bank-deposits', button: 'New bank deposit', bank: true,
    description: 'Cash of the branch put into a company bank account. It shows on the payment side of the Cashbook (Bank deposit) and in the Bank Book.',
  },
  bank_withdraw: {
    title: 'Bank Withdraw', post: 'bank-withdrawals', button: 'New bank withdraw', bank: true,
    description: 'Cash taken out of a company bank account for the branch. It shows on the receive side of the Cashbook (Bank withdrawal fund) and in the Bank Book.',
  },
  branch_transfer: {
    title: 'Branch to Branch Transfer', post: 'branch-transfers', button: 'New transfer', transfer: true,
    description: 'Cash sent from one branch to another. It shows on the payment side of the sending branch and on the receive side of the receiving branch.',
  },
};

function EntryForm({ kind, cfg, branches, ledgers, isAdmin, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({
    branch: branches.length === 1 ? branches[0].id : '',
    fromBranch: branches.length === 1 ? branches[0].id : (branches[0]?.id || ''),
    toBranch: '',
    ledger: '',
    amount: '',
    mode: 'cash',
    bankAccount: '',
    date: today(),
    remark: '',
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const searchBoxRef = useRef(null);
  const [workNote, setWorkNote] = useState('');
  // the entry is made on the date the branch is on (the day after its last approved day close)
  useEffect(() => {
    workDateOf(cfg.transfer ? f.fromBranch : f.branch).then((d) => { if (d) { setF((x) => ({ ...x, date: d })); setWorkNote(d); } else setWorkNote(''); }).catch(() => {});
  }, [f.branch, f.fromBranch]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };

  useEffect(() => {
    if (!isAdmin && cfg.transfer && !f.fromBranch && branches.length > 0) {
      setF((x) => ({ ...x, fromBranch: branches[0].id }));
    }
  }, [isAdmin, cfg.transfer, branches, f.fromBranch]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(event.target)) {
        setShowResults(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const myBranch = branches.find((b) => String(b.id) === String(f.fromBranch)) || branches[0];
  const allBranchesList = ledgers.allBranches || [];
  const selectedToBranch = allBranchesList.find((b) => String(b.id) === String(f.toBranch));

  const filteredBranches = searchQuery.trim()
    ? allBranchesList.filter((b) => {
        if (myBranch && String(b.id) === String(myBranch.id)) return false;
        const q = searchQuery.toLowerCase().trim();
        return (b.code || '').toLowerCase().includes(q) || (b.name || '').toLowerCase().includes(q);
      })
    : [];

  const branchSelect = (id, key, label, extra) => (
    <FormField id={id} label={label} required error={errors[key]}>
      <select id={id} value={f[key]} onChange={set(key)}>
        <option value="">Select</option>
        {isAdmin && <option value="ho">Head office</option>}
        {(extra || branches).map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
      </select>
    </FormField>
  );

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      const payload = {
        ...f,
        fromBranch: !isAdmin && cfg.transfer ? (f.fromBranch || myBranch?.id) : f.fromBranch,
        bankAccount: cfg.bank || f.mode === 'bank' ? f.bankAccount : undefined,
        ledger: cfg.ledger ? f.ledger : undefined,
      };
      if (cfg.transfer && !payload.toBranch) {
        setErrors({ toBranch: 'Please search and select a branch to transfer to' });
        toast.error('Please search and select a branch to transfer to');
        setBusy(false);
        return;
      }
      const r = await api.accounts.create(cfg.post, payload);
      toast.success(`${cfg.title} saved — ${r.voucherNo}`);
      onSaved();
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={cfg.button} onClose={onClose} busy={busy}
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Close</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="form-grid">
        {cfg.transfer ? (
          isAdmin ? (
            <>
              {branchSelect('afrom', 'fromBranch', 'From branch')}
              <FormField id="ato" label="To branch" required error={errors.toBranch}>
                <select id="ato" value={f.toBranch} onChange={set('toBranch')}>
                  <option value="">Select</option>
                  <option value="ho">Head office</option>
                  {(ledgers.allBranches || []).map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
                </select>
              </FormField>
            </>
          ) : (
            <>
              <FormField
                id="abranchsearch"
                label="Branch name Search"
                required
                error={errors.toBranch}
                hint={myBranch ? `Sending from: ${myBranch.code} — ${myBranch.name}` : undefined}
              >
                <div ref={searchBoxRef} style={{ position: 'relative' }}>
                  <input
                    id="abranchsearch"
                    type="text"
                    placeholder="Type branch name or code to search…"
                    value={searchQuery}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSearchQuery(val);
                      setShowResults(true);
                      if (!val.trim()) {
                        setF((x) => ({ ...x, toBranch: '' }));
                      }
                    }}
                    onFocus={() => {
                      if (searchQuery.trim().length >= 1) setShowResults(true);
                    }}
                    autoComplete="off"
                  />
                  {showResults && searchQuery.trim().length >= 1 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        zIndex: 50,
                        background: 'var(--bg, #fff)',
                        border: '1px solid var(--border, #ccc)',
                        borderRadius: '6px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                        maxHeight: '180px',
                        overflowY: 'auto',
                        marginTop: '4px',
                      }}
                    >
                      {filteredBranches.length === 0 ? (
                        <div style={{ padding: '8px 12px', color: 'var(--text-muted, #888)', fontSize: '0.9rem' }}>
                          No branch matching “{searchQuery}”
                        </div>
                      ) : (
                        filteredBranches.map((b) => (
                          <div
                            key={b.id}
                            onClick={() => {
                              setF((x) => ({ ...x, toBranch: b.id }));
                              setErrors((x) => ({ ...x, toBranch: undefined }));
                              setSearchQuery(`${b.code} — ${b.name}`);
                              setShowResults(false);
                            }}
                            style={{
                              padding: '8px 12px',
                              cursor: 'pointer',
                              borderBottom: '1px solid var(--border-subtle, #eee)',
                              fontSize: '0.9rem',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover, #f0f7ff)')}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                          >
                            <strong>{b.code}</strong> — {b.name}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </FormField>

              <FormField id="ato" label="To branch" required error={errors.toBranch}>
                <input
                  id="ato"
                  type="text"
                  readOnly
                  disabled
                  value={
                    selectedToBranch
                      ? `${selectedToBranch.code} — ${selectedToBranch.name}`
                      : 'Automatically shows branch selected from search'
                  }
                  style={{
                    background: 'var(--bg-subtle, #f5f5f5)',
                    color: selectedToBranch ? 'inherit' : 'var(--text-muted, #888)',
                    fontWeight: selectedToBranch ? 600 : 'normal',
                  }}
                />
              </FormField>
            </>
          )
        ) : (branches.length > 1 || isAdmin) && branchSelect('abranch', 'branch', 'Cashbook of')}
        {cfg.ledger && (
          <FormField id="aledger" label={cfg.ledgerLabel} required error={errors.ledger}>
            <select id="aledger" value={f.ledger} onChange={set('ledger')}>
              <option value="">Select</option>
              {(ledgers[cfg.ledger] || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </FormField>
        )}
        <FormField id="adate" label="Date" required error={errors.date} hint={workNote ? 'Your branch works on this date only' : undefined}><input id="adate" type="date" max={today()} value={f.date} readOnly={Boolean(workNote)} onChange={set('date')} /></FormField>
        <FormField id="aamount" label="Amount (₹)" required error={errors.amount}>
          <input id="aamount" inputMode="decimal" value={f.amount} onChange={(e) => { setF((x) => ({ ...x, amount: e.target.value.replace(/[^\d.]/g, '') })); setErrors((x) => ({ ...x, amount: undefined })); }} />
        </FormField>
        {cfg.mode && (
          <FormField id="amode" label="By" required error={errors.mode}>
            <select id="amode" value={f.mode} onChange={set('mode')}>
              {Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </FormField>
        )}
        {cfg.bank ? <BankAccountSelect id="abank" mode="bank" value={f.bankAccount} onChange={(v) => setF((x) => ({ ...x, bankAccount: v }))} error={errors.bankAccount} /> : cfg.mode && <BankAccountSelect id="abank" mode={f.mode} value={f.bankAccount} onChange={(v) => setF((x) => ({ ...x, bankAccount: v }))} error={errors.bankAccount} />}
        <FormField id="aremark" label="Narration" className="span-2" hint="Optional: the person, the slip or cheque number"><input id="aremark" value={f.remark} maxLength={200} onChange={set('remark')} /></FormField>
      </div>
    </Modal>
  );
}


export default function AccountEntries({ kind }) {
  const cfg = CONFIG[kind];
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);
  const [branches, setBranches] = useState([]);
  const [ledgers, setLedgers] = useState({ credit: [], debit: [] });
  const [allBranches, setAllBranches] = useState([]);
  const [branch, setBranch] = useState('');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {});
    api.accounts.options().then((r) => { setLedgers(r.ledgers); setAllBranches(r.branches || []); }).catch(() => {});
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.accounts.entries({ kind, branch, from, to }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [kind, branch, from, to]);
  useEffect(() => { load(); }, [load]);

  async function remove() {
    setBusy(true);
    try {
      await api.accounts.remove(removing.id);
      toast.success('Entry removed');
      setRemoving(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={cfg.title} description={cfg.description} />
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
          <button className="btn" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
          <button className="btn primary" onClick={() => setAdding(true)}>{cfg.button}</button>
        </div>
        {loading && !data ? <Spinner label="Loading…" /> : error ? <ErrorState message={error} onRetry={load} /> : !data || data.items.length === 0 ? (
          <EmptyState title="No entries" description="Nothing was entered for these dates." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Voucher no.</th><th>Date</th><th>{cfg.transfer ? 'From → To' : 'Branch'}</th>{cfg.ledger && <th>Ledger</th>}{(cfg.bank || cfg.mode) && <th>Bank account</th>}{cfg.mode && <th>By</th>}<th className="num">Amount</th><th>Narration</th><th>By</th>{isAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {data.items.map((e) => (
                  <tr key={e.id}>
                    <td data-label="Voucher no."><strong>{e.voucherNo}</strong>{e.voucherMonth && <div className="muted small">{e.voucherMonth}</div>}</td>
                    <td data-label="Date">{dmy(e.date)}</td>
                    <td data-label="Branch">{cfg.transfer ? `${branchText(e.branch)} → ${branchText(e.counterBranch)}` : branchText(e.branch)}</td>
                    {cfg.ledger && <td data-label="Ledger">{e.ledger || '—'}</td>}
                    {(cfg.bank || cfg.mode) && <td data-label="Bank account">{e.bankAccount || '—'}</td>}
                    {cfg.mode && <td data-label="By">{MODE_LABEL[e.mode] || e.mode}</td>}
                    <td data-label="Amount" className="num">{inr(e.amount)}</td>
                    <td data-label="Narration">{e.remark || '—'}</td>
                    <td data-label="Entered by">{e.by || '—'}</td>
                    {isAdmin && <td><button className="btn sm danger-outline" onClick={() => setRemoving(e)}>Remove</button></td>}
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid currentColor' }}>
                  <td colSpan={3 + (cfg.ledger ? 1 : 0) + (cfg.bank || cfg.mode ? 1 : 0) + (cfg.mode ? 1 : 0)}><strong>Total ({data.items.length})</strong></td>
                  <td className="num"><strong>{inr(data.sum)}</strong></td><td colSpan={isAdmin ? 3 : 2} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
      {adding && <EntryForm kind={kind} cfg={cfg} branches={branches} ledgers={{ ...ledgers, allBranches }} isAdmin={isAdmin} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      <ConfirmDialog open={Boolean(removing)} title="Remove this entry?" tone="danger" confirmLabel="Remove" loading={busy} onCancel={() => setRemoving(null)} onConfirm={remove}
        message={removing ? `${removing.voucherNo} of ${inr(removing.amount)} is taken out of the Cashbook${cfg.transfer ? ' of both branches' : ''}.` : ''} />
    </>
  );
}

export const PaymentVoucher = () => <AccountEntries kind="payment_voucher" />;
export const ReceiveVoucher = () => <AccountEntries kind="receive_voucher" />;
export const BankDeposit = () => <AccountEntries kind="bank_deposit" />;
export const BankWithdraw = () => <AccountEntries kind="bank_withdraw" />;
export const BranchTransfer = () => <AccountEntries kind="branch_transfer" />;
