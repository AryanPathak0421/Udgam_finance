import mongoose from 'mongoose';
import { DayClose, DENOMINATIONS } from '../models/DayClose.js';
import { Branch } from '../models/Branch.js';
import { asString, parseDateOnly, startOfToday, escapeRegex, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';
import { isAdmin } from './groupController.js';
import { cashbookData } from './cashbookController.js';
import { branchWorkingDate } from '../services/dayOpen.js';

/**
 * Day close. The denomination of a branch (the count of every note and coin) is made against the cash closing of its Cashbook; once it is made
 * the day of the branch is closed (no more entries for that date). The admin sees the Cashbook and the denomination side by side, branch wise
 * and day wise, and approves: only then does the branch move from date 1 to date 2. While the closing and the denomination do not match, it cannot
 * be approved and the branch stays on its date.
 */
const DAY = 24 * 3600 * 1000;
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const invalid = (errors) => new HttpError(422, 'Please correct the highlighted fields', errors);
const paise = (rupees) => Math.round(rupees * 100);

/** The branch of a request: admin chooses any, others one of their own (the only one when they have one). */
async function branchOf(req, wanted) {
  const mine = (req.user.branches || []).map(String);
  const id = mongoose.isValidObjectId(wanted) ? String(wanted) : mine.length === 1 ? mine[0] : '';
  if (!id) throw invalid({ branch: 'Select the branch' });
  if (!isAdmin(req.user) && !mine.includes(id)) throw new HttpError(403, 'You can only use your own branches');
  const b = await Branch.findById(id).select('code name').lean();
  if (!b) throw invalid({ branch: 'Branch not found' });
  return b;
}

/** The cash side of the Cashbook of a branch for one date (cash only: it is the cash in hand that is counted). */
async function cashOf(req, branchId, date) {
  const d = await cashbookData(req, { branch: String(branchId), from: iso(date), to: iso(date), mode: 'cash', skipDue: true });
  return { opening: paise(d.opening), receipts: paise(d.totals.receipts), payments: paise(d.totals.payments), closing: paise(d.closing) };
}

const present = (c, branch) => ({
  id: c._id, branch: branch || (c.branch?._id ? { id: c.branch._id, code: c.branch.code, name: c.branch.name } : null), date: iso(c.date),
  counts: c.counts instanceof Map ? Object.fromEntries(c.counts) : { ...(c.counts || {}) }, denomination: c.denominationPaise / 100,
  cashbook: { opening: c.openingPaise / 100, receipts: c.receiptsPaise / 100, payments: c.paymentsPaise / 100, closing: c.closingPaise / 100 },
  difference: c.differencePaise / 100, match: c.differencePaise === 0, status: c.status, remark: c.remark || '',
  submittedBy: c.submittedByCode || '', submittedAt: c.submittedAt, decidedBy: c.decidedByCode || '', decidedAt: c.decidedAt, rejectReason: c.rejectReason || '',
});

/** Where a branch stands: its working date (the day after the last approved close), a close waiting for approval, and the cash closing of the date to close. */
export async function status(req, res) {
  const branch = await branchOf(req, asString(req.query.branch));
  const [lastApproved, pending, recent, rejectedClose] = await Promise.all([
    DayClose.findOne({ branch: branch._id, status: 'approved' }).sort({ date: -1 }).lean(),
    DayClose.findOne({ branch: branch._id, status: 'submitted' }).sort({ date: -1 }).lean(),
    DayClose.find({ branch: branch._id }).sort({ date: -1 }).limit(10).lean(),
    DayClose.findOne({ branch: branch._id, status: 'rejected' }).sort({ date: -1 }).lean(),
  ]);
  const workingDate = await branchWorkingDate(branch._id);
  const today = startOfToday();
  let date = pending ? pending.date : workingDate || parseDateOnly(asString(req.query.date)) || today;
  if (date > today) date = today;
  const canClose = !pending && (!workingDate || workingDate <= today);
  const cash = await cashOf(req, branch._id, date);
  res.json({
    branch: { id: branch._id, code: branch.code, name: branch.name }, workingDate: iso(workingDate), lastClosed: iso(lastApproved?.date), date: iso(date), dateFixed: Boolean(workingDate || pending),
    canClose, waiting: pending ? present(pending, null) : null, rejected: rejectedClose ? present(rejectedClose, null) : null,
    reason: pending ? `The close of ${iso(pending.date)} is waiting for the admin's approval` : workingDate && workingDate > today ? `The day ${iso(lastApproved?.date)} is closed. The next day opens on ${iso(workingDate)}` : '',
    cashbook: { opening: cash.opening / 100, receipts: cash.receipts / 100, payments: cash.payments / 100, closing: cash.closing / 100 },
    denominations: DENOMINATIONS, recent: recent.map((c) => present(c, null)),
  });
}

/** The cash closing of the Cashbook for a date the branch chooses (the first close only; after that the date follows the last approved one). */
export async function cashClosing(req, res) {
  const branch = await branchOf(req, asString(req.query.branch));
  const date = parseDateOnly(asString(req.query.date)) || startOfToday();
  const cash = await cashOf(req, branch._id, date);
  res.json({ date: iso(date), cashbook: { opening: cash.opening / 100, receipts: cash.receipts / 100, payments: cash.payments / 100, closing: cash.closing / 100 } });
}

const readCounts = (raw) => {
  const counts = {};
  let total = 0;
  for (const d of DENOMINATIONS) {
    const v = raw?.[d.key];
    const n = v === undefined || v === null || v === '' ? 0 : Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw invalid({ [d.key]: 'Enter a whole number (0 or more)' });
    counts[d.key] = n;
    total += n * d.value * 100;
  }
  return { counts, total };
};

/** The branch makes the denomination of a day: the day is closed from now on and waits for the admin. */
export async function submit(req, res) {
  const b = req.body || {};
  const branch = await branchOf(req, asString(b.branch));
  const today = startOfToday();
  const lastApproved = await DayClose.findOne({ branch: branch._id, status: 'approved' }).sort({ date: -1 }).lean();
  const waiting = await DayClose.findOne({ branch: branch._id, status: 'submitted' }).lean();
  if (waiting) throw new HttpError(409, `The close of ${iso(waiting.date)} is already waiting for the admin's approval`);
  let date = parseDateOnly(asString(b.date)) || today;
  const working = await branchWorkingDate(branch._id);
  if (working) date = working; // the branch goes date by date (a day the admin revoked first)
  if (date > today) throw invalid({ date: 'A day can be closed only on or after that day' });
  const { counts, total } = readCounts(b.counts);
  const cash = await cashOf(req, branch._id, date);
  // the day is closed only with a denomination that matches the cash closing of the Cashbook: a mismatched count would lock the day (no entry can be made) without the branch being able to correct it
  // (a branch with no cash at all closes its day with a zero count)
  if (total !== cash.closing) {
    const diff = (total - cash.closing) / 100;
    const hint = cash.closing < 0 ? ' The Cashbook closing is below zero (more cash was paid than received): enter the missing cash received (for example Cash fund) first.' : total === 0 ? ' Enter the notes and coins you hold.' : '';
    throw new HttpError(422, `The denomination ₹${total / 100} does not match the cash closing ₹${cash.closing / 100} of the Cashbook (${diff > 0 ? 'more' : 'less'} by ₹${Math.abs(diff)}). Count again, or correct the Cashbook; the day is not closed.${hint}`, { counts: `Difference ₹${diff}: the day is closed only when the count matches the Cashbook closing` });
  }
  const doc = {
    branch: branch._id, date, counts, denominationPaise: total, openingPaise: cash.opening, receiptsPaise: cash.receipts, paymentsPaise: cash.payments, closingPaise: cash.closing,
    differencePaise: total - cash.closing, status: 'submitted', remark: asString(b.remark).slice(0, 200), submittedBy: req.user._id, submittedByCode: req.user.employeeCode || '', submittedAt: new Date(),
  };
  // a day that was rejected is made again over the same record
  const saved = await DayClose.findOneAndUpdate({ branch: branch._id, date, status: { $ne: 'approved' } }, { $set: doc, $unset: { decidedByCode: '', decidedAt: '', rejectReason: '' } }, { upsert: true, new: true, setDefaultsOnInsert: true }).catch((err) => {
    if (err.code === 11000) throw new HttpError(409, 'This day is already closed');
    throw err;
  });
  await audit(req, { action: 'dayClose.submit', entity: 'DayClose', entityId: saved._id, after: { branch: branch.code, date: iso(date), denomination: total / 100, closing: cash.closing / 100, difference: (total - cash.closing) / 100 } });
  res.status(201).json({ close: present(saved, { id: branch._id, code: branch.code, name: branch.name }) });
}

/** The closes of every branch and day (admin): the Cashbook and the denomination side by side. */
export async function list(req, res) {
  const filter = {};
  if (!isAdmin(req.user)) filter.branch = { $in: (req.user.branches || []).map((x) => new mongoose.Types.ObjectId(String(x))) };
  const wanted = asString(req.query.branch);
  if (mongoose.isValidObjectId(wanted)) {
    if (!isAdmin(req.user) && !(req.user.branches || []).some((x) => String(x) === wanted)) throw new HttpError(403, 'You can only see your own branches');
    filter.branch = new mongoose.Types.ObjectId(wanted);
  }
  const st = asString(req.query.status);
  if (['submitted', 'approved', 'rejected', 'revoked'].includes(st)) filter.status = st;
  const from = parseDateOnly(asString(req.query.from));
  const to = parseDateOnly(asString(req.query.to));
  if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const q = asString(req.query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ submittedByCode: rx }, { remark: rx }];
  }
  const rows = await DayClose.find(filter).sort({ date: -1, createdAt: -1 }).limit(300).populate('branch', 'code name');
  res.json({ items: rows.map((c) => present(c, null)), denominations: DENOMINATIONS });
}

async function load(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Close not found');
  const c = await DayClose.findById(req.params.id).populate('branch', 'code name');
  if (!c) throw new HttpError(404, 'Close not found');
  return c;
}

/** The admin approves: the Cashbook closing is worked out again and must still match the denomination. Then the branch moves on to the next date. */
export async function approve(req, res) {
  const c = await load(req);
  if (c.status !== 'submitted') throw new HttpError(409, `This close is already ${c.status}`);
  const cash = await cashOf(req, c.branch._id, c.date);
  if (cash.closing !== c.denominationPaise) {
    throw new HttpError(409, `The cash closing of the Cashbook is ₹${cash.closing / 100} but the denomination is ₹${c.denominationPaise / 100}. They must match; reject this close so the branch makes it again.`);
  }
  c.status = 'approved';
  c.decidedByCode = req.user.employeeCode || '';
  c.decidedAt = new Date();
  await c.save();
  await audit(req, { action: 'dayClose.approve', entity: 'DayClose', entityId: c._id, after: { branch: c.branch.code, date: iso(c.date), closing: c.closingPaise / 100 } });
  res.json({ close: present(c, null), nextDate: iso(await branchWorkingDate(c.branch._id)) });
}

/**
 * The admin takes back an approved day: the branch is on that date again and can work on it (a back date), and has to make the denomination again.
 * The days after it stay as they are; when this day is approved again the branch is back on the day after its last approved close.
 */
export async function revoke(req, res) {
  const c = await load(req);
  if (c.status !== 'approved') throw new HttpError(409, 'Only an approved day can be revoked');
  const reason = asString(req.body?.reason).slice(0, 200);
  if (reason.length < 3) throw invalid({ reason: 'Enter the reason' });
  // only this day is taken back: the days after it stay approved, and the branch returns to its date once this day is approved again
  const later = { modifiedCount: 0 };
  c.status = 'revoked';
  c.rejectReason = reason;
  c.decidedByCode = req.user.employeeCode || '';
  c.decidedAt = new Date();
  await c.save();
  await audit(req, { action: 'dayClose.revoke', entity: 'DayClose', entityId: c._id, after: { branch: c.branch.code, date: iso(c.date), reason, laterRevoked: later.modifiedCount } });
  res.json({ close: present(c, null), laterRevoked: later.modifiedCount, workingDate: iso(await branchWorkingDate(c.branch._id)) });
}

/** The working date of each branch of the user (the other users work on that date only; the admin is not held to it). */
export async function workingDates(req, res) {
  if (isAdmin(req.user)) return res.json({ restricted: false, items: [] });
  const ids = (req.user.branches || []).map((b) => new mongoose.Types.ObjectId(String(b)));
  const branches = await Branch.find({ _id: { $in: ids } }).select('code name').lean();
  const dates = new Map(await Promise.all(ids.map(async (id) => [String(id), await branchWorkingDate(id)])));
  const waiting = new Map((await DayClose.find({ branch: { $in: ids }, status: 'submitted' }).select('branch date').lean()).map((x) => [String(x.branch), x.date]));
  res.json({
    restricted: true,
    items: branches.map((b) => ({ branch: { id: b._id, code: b.code, name: b.name }, workingDate: dates.get(String(b._id)) ? iso(dates.get(String(b._id))) : null, waitingForApproval: waiting.get(String(b._id)) ? iso(waiting.get(String(b._id))) : null })),
  });
}

/** The admin sends it back: the day is open again and the branch makes the denomination again. */
export async function reject(req, res) {
  const c = await load(req);
  if (c.status !== 'submitted') throw new HttpError(409, `This close is already ${c.status}`);
  const reason = asString(req.body?.reason).slice(0, 200);
  if (reason.length < 3) throw invalid({ reason: 'Enter the reason' });
  c.status = 'rejected';
  c.decidedByCode = req.user.employeeCode || '';
  c.decidedAt = new Date();
  c.rejectReason = reason;
  await c.save();
  await audit(req, { action: 'dayClose.reject', entity: 'DayClose', entityId: c._id, after: { branch: c.branch.code, date: iso(c.date), reason } });
  res.json({ close: present(c, null) });
}

