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
  useEffect(() => {
    if (mode !== 'bank' || cache) return undefined;
    let live = true;
    api.bankAccountOptions().then((r) => { cache = r.accounts || []; if (live) setAccounts(cache); }).catch(() => {});
    return () => { live = false; };
  }, [mode]);
  // a single account is chosen for the user
  useEffect(() => {
    if (mode === 'bank' && !value && accounts.length === 1) onChange(String(accounts[0].id));
  }, [mode, value, accounts, onChange]);
  if (mode !== 'bank' || accounts.length === 0) return null;
  const chosen = accounts.find((a) => String(a.id) === String(value));
  return (
    <FormField id={id} label="Account detail" required error={error} hint={chosen ? `${chosen.bankName}${chosen.ifsc ? ` · IFSC ${chosen.ifsc}` : ''}` : undefined}>
      <select id={id} value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select the bank account</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
      </select>
    </FormField>
  );
}
