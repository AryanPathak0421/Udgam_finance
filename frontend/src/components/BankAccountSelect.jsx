import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import FormField from './ui/FormField.jsx';

let cache = null; // the account list is the same for everyone, fetched once

/**
 * Account detail: appears when the payment mode is Bank transfer, to pick the company bank account the money went to.
 * Nothing is shown for the other modes (or when the company has no bank account set up yet).
 */
export default function BankAccountSelect({ id = 'bankacc', mode, value, onChange, error }) {
  const [accounts, setAccounts] = useState(cache || []);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    if (mode !== 'bank') return undefined;
    if (cache && cache.length > 0) {
      setAccounts(cache);
      setLoading(false);
      return undefined;
    }
    let live = true;
    setLoading(true);
    api.bankAccountOptions()
      .then((r) => {
        const list = r.accounts || [];
        cache = list;
        if (live) {
          setAccounts(list);
          setLoading(false);
        }
      })
      .catch(() => {
        if (live) setLoading(false);
      });
    return () => { live = false; };
  }, [mode]);

  // a single account is chosen for the user
  useEffect(() => {
    if (mode === 'bank' && !value && accounts.length === 1) {
      onChange(String(accounts[0].id));
    }
  }, [mode, value, accounts, onChange]);

  if (mode !== 'bank') return null;

  if (loading && accounts.length === 0) {
    return (
      <FormField id={id} label="Bank Account" required error={error}>
        <select id={id} disabled>
          <option>Loading bank accounts…</option>
        </select>
      </FormField>
    );
  }

  if (accounts.length === 0) {
    return (
      <FormField id={id} label="Bank Account" required error={error || 'No active bank account found'}>
        <div className="notice warn" style={{ margin: 0, padding: '8px 12px', fontSize: '13px' }}>
          No active company bank account found. Please add a bank account under Bank Account Master.
        </div>
      </FormField>
    );
  }

  const chosen = accounts.find((a) => String(a.id) === String(value));

  return (
    <FormField id={id} label="Bank Account" required error={error} className="span-2">
      <select id={id} value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select the bank account</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </select>
      {chosen && (
        <div style={{ marginTop: 6, padding: '8px 12px', background: 'var(--bg-subtle, #f8fafc)', border: '1px solid var(--border, #e2e8f0)', borderRadius: 6, fontSize: '13px', lineHeight: 1.5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginBottom: 2 }}>
            <span><strong>Bank:</strong> {chosen.bankName}</span>
            {chosen.ifsc && <span><strong>IFSC:</strong> {chosen.ifsc}</span>}
          </div>
          <div><strong>A/c No:</strong> <span style={{ fontFamily: 'monospace', fontWeight: 600, letterSpacing: '0.05em' }}>{chosen.accountNumber}</span></div>
          <div><strong>A/c Holder:</strong> {chosen.accountHolderName}</div>
        </div>
      )}
    </FormField>
  );
}

