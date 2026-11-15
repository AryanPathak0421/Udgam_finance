import mongoose from 'mongoose';
import { BankAccount } from '../models/BankAccount.js';
import { HttpError, asString } from '../utils/http.js';

const last4 = (n) => String(n || '').slice(-4);
export const accountLabel = (a) => `${a.bankName} — ${a.accountHolderName} (A/c ••••${last4(a.accountNumber)})`;

/** The bank accounts a payment can go to (active ones, filtered by branch if specified). */
export async function bankAccountOptions(branch) {
  const filter = { isDeleted: false, isActive: true };
  if (branch && branch !== 'ho' && mongoose.isValidObjectId(branch)) {
    filter.$or = [
      { branches: branch },
      { branches: { $size: 0 } },
      { branches: { $exists: false } },
      { branches: null },
    ];
  }
  const rows = await BankAccount.find(filter)
    .select('accountHolderName accountNumber bankName ifsc branches')
    .sort({ bankName: 1, accountHolderName: 1 })
    .lean();
  return rows.map((a) => ({
    id: a._id,
    label: accountLabel(a),
    bankName: a.bankName,
    accountHolderName: a.accountHolderName,
    accountNumber: a.accountNumber,
    ifsc: a.ifsc || '',
    branches: a.branches || [],
  }));
}

/**
 * Bank transfer needs the account the money went to (Account detail). Returns the account id to store, or undefined for any other mode
 * (or when the company has no bank account set up yet, so nothing can be chosen).
 */
export async function readBankAccount(body, payMode, field = 'bankAccount') {
  if (payMode !== 'bank') return undefined;
  const id = asString(body?.[field]);
  if (!id) {
    if (!(await BankAccount.exists({ isDeleted: false, isActive: true }))) return undefined;
    throw new HttpError(422, 'Please correct the highlighted fields', { [field]: 'Select the bank account (Account detail)' });
  }
  if (!mongoose.isValidObjectId(id) || !(await BankAccount.exists({ _id: id, isDeleted: false, isActive: true }))) {
    throw new HttpError(422, 'Please correct the highlighted fields', { [field]: 'Select a bank account from the list' });
  }
  return id;
}
