import { assertDayOpen, defaultWorkDate } from '../services/dayOpen.js';
import { readBankAccount } from '../services/bankAccountPick.js';
import mongoose from 'mongoose';
import { LoanSettlement } from '../models/LoanSettlement.js';
import { Member } from '../models/Member.js';
import { generateCode } from '../services/codeSequence.js';
import { asString, escapeRegex, parseDateOnly, parsePaging, HttpError } from '../utils/http.js';
import { toMinor } from '../utils/money.js';
import { audit } from '../utils/audit.js';
import { notifyApprovers } from '../services/notify.js';
import { branchFilter } from './groupController.js';
import { borrowerState, loadLoan, startOfToday } from './emiController.js';

const invalid = (errors) => new HttpError(422, 'Please correct the highlighted fields', errors);
const POPULATE = [{ path: 'branch', select: 'code name' }];
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const money = (p) => (p === undefined || p === null ? null : p / 100);
const DOC_RE = /^data:(application\/pdf|image\/png|image\/jpeg);base64,[A-Za-z0-9+/=]+$/;
const MAX_DOC_CHARS = 1_100_000; // ~800 KB file

/** The borrower of a loan (a group loan has one line per member). */
function findLine(p, memberId) {
  const line = p.lines.find((l) => String(l.member) === String(memberId)) || (p.lines.length === 1 && !memberId ? p.lines[0] : null);
  if (!line) throw invalid({ member: 'Select the borrower' });
  return line;
}

const present = (s, { full = false } = {}) => ({
  id: s._id, kind: s.kind, receiptNo: s.receiptNo, loanPaymentId: s.loanPayment, loanId: s.loanId || '', formId: s.formId,
  branch: s.branch?._id ? { id: s.branch._id, code: s.branch.code, name: s.branch.name } : null,
  auto: s.kind === 'auto', memberCode: s.memberCode, memberName: s.memberName, group: s.group || '', outstanding: money(s.outstandingPaise), amount: money(s.amountPaise), waiver: money(s.waiverPaise),
  payMode: s.payMode || '', reference: s.reference || '', settledOn: iso(s.settledOn), remark: s.remark || '', deathDate: iso(s.deathDate), claimRef: s.claimRef || '',
  verifier: s.verifier?.code ? { code: s.verifier.code, name: s.verifier.name } : null, status: s.status, cancelReason: s.cancelReason || '', createdAt: s.createdAt,
  ...(full ? { certificate: s.certificate || null } : { hasCertificate: s.kind === 'death' }),
});

/** What the settlement screens show for one borrower of a loan: the outstanding and who verifies. */
export async function preview(req, res) {
  const p = await loadLoan(req, req.query.loan);
  const line = findLine(p, req.query.member);
  const asOf = startOfToday();
  const st = await borrowerState(p, line, asOf);
  const nextDue = st.left[0];
  const guarantor = line.member ? (await Member.findById(line.member).select('guarantor.name guarantor.mobile guarantor.deceasedOn guarantor.deathRecordedByCode'))?.guarantor : null;
  res.json({
    loan: { id: p._id, loanId: p.loanId || '', formId: p.formId, kind: p.kind, branch: p.branch ? `${p.branch.code} — ${p.branch.name}` : '', group: p.group?.code ? `${p.group.code} — ${p.group.name}` : '', schemeName: p.schemeName, modeLabel: p.modeLabel, installments: p.installments, paidOn: iso(p.paidOn), amount: money(line.amountPaise) },
    borrower: { member: line.member, code: line.code, name: line.name },
    state: {
      settled: st.settled || null,
      paid: money(st.totals.paid), outstanding: money(st.totals.outstanding), due: money(st.totals.due), remainingInstallments: st.left.length, paidInstallments: st.schedule.filter((s) => s.status === 'paid').length,
      nextDue: nextDue ? { no: nextDue.no, dueDate: nextDue.dueDate, amount: money(nextDue.remainingPaise) } : null,
    },
    guarantor: guarantor?.name ? { name: guarantor.name, mobile: guarantor.mobile || '', deceasedOn: iso(guarantor.deceasedOn), recordedBy: guarantor.deathRecordedByCode || '' } : null,
    verifier: { code: req.user.employeeCode || '', name: req.user.name || '' },
    today: iso(asOf),
    canWaive: false,
  });
}

async function prepare(req, b) {
  const p = await loadLoan(req, b.loan);
  const line = findLine(p, b.member);
  // a settlement is made on the working date of the branch (today): there is no other date
  const settledOn = await defaultWorkDate(p.branch?._id || p.branch, req.user);
  if (b.settledOn && iso(parseDateOnly(asString(b.settledOn))) !== iso(settledOn)) throw invalid({ settledOn: 'The settlement date is the working date of the branch and cannot be changed' });
  if (settledOn < p.paidOn) throw invalid({ settledOn: 'The settlement cannot be before the loan was paid out' });
  const st = await borrowerState(p, line, settledOn);
  if (st.settled) throw new HttpError(409, `This loan is already settled (${st.settled.receiptNo})`);
  if (!st.left.length) throw new HttpError(409, 'All installments of this loan are already paid, so there is nothing to settle');
  return { p, line, settledOn, outstandingPaise: st.totals.outstanding };
}

async function save(req, p, line, data) {
  if (data.status !== 'pending') {
    await assertDayOpen(p.branch._id, data.settledOn, req.user);
  }
  try {
    return await LoanSettlement.create({
      ...data, receiptNo: await generateCode('settlementReceipt'), loanPayment: p._id, loanId: p.loanId, formId: p.formId, branch: p.branch._id, member: line.member, memberCode: line.code,
      memberName: line.name, group: p.group?.code ? `${p.group.code} — ${p.group.name}` : '', createdBy: req.user._id,
    });
  } catch (err) {
    if (err.code === 11000) throw new HttpError(409, 'This loan has just been settled. Reload and check.');
    throw err;
  }
}

/** Loan settlement: the borrower closes the loan by paying what is left (a lower amount needs a waiver, by a manager). */
export async function settleLoan(req, res) {
  const b = req.body || {};
  const { p, line, settledOn, outstandingPaise } = await prepare(req, b);
  const amountPaise = toMinor(typeof b.amount === 'number' ? String(b.amount) : asString(b.amount));
  if (amountPaise === null || amountPaise < 0) throw invalid({ amount: 'Enter the settlement amount received (0 or more, up to 2 decimals)' });
  // A loan is closed only by paying everything that is outstanding: ₹9,999 does not settle a loan of ₹10,000.
  if (amountPaise !== outstandingPaise) throw invalid({ amount: `The settlement amount must be exactly the outstanding ₹${outstandingPaise / 100}. ${amountPaise < outstandingPaise ? `₹${amountPaise / 100} is not enough to settle the loan.` : 'It cannot be more than that.'}` });
  const waiverPaise = 0;
  const remark = asString(b.remark).slice(0, 300);
  let payMode;
  let bankAccount;
  if (amountPaise > 0) {
    payMode = asString(b.payMode);
    if (!['cash', 'bank', 'upi', 'cheque'].includes(payMode)) throw invalid({ payMode: 'Select how the amount is paid' });
    bankAccount = await readBankAccount(b, payMode);
  }
  const s = await save(req, p, line, { kind: 'loan', outstandingPaise, amountPaise, waiverPaise, payMode, bankAccount, reference: asString(b.reference).slice(0, 60), settledOn, remark });
  await s.populate(POPULATE);
  await audit(req, { action: 'settlement.loan', entity: 'LoanSettlement', entityId: s._id, after: { receiptNo: s.receiptNo, loanId: p.loanId, member: line.code, outstanding: outstandingPaise / 100, received: amountPaise / 100, waiver: waiverPaise / 100 } });
  notifyApprovers({
    branch: s.branch?._id || s.branch,
    title: 'Loan settled',
    message: `Loan ${p.loanId} for ${line.name || line.code} settled (Receipt ${s.receiptNo}). Received: ₹${amountPaise / 100}, Waived: ₹${waiverPaise / 100}.`,
    extraUsers: [req.user._id],
  });
  res.status(201).json({ settlement: present(s) });
}

/**
 * Death settlement: the borrower died. The outstanding is settled (written off against the insurance), the verifying
 * employee and the death certificate are kept, and the member is blocked automatically.
 */
export async function settleDeath(req, res) {
  const b = { ...(req.body || {}) };
  // the settlement date is not editable: a death settlement is made on the day it is recorded
  if (b.settledOn && iso(parseDateOnly(asString(b.settledOn))) !== iso(startOfToday())) throw invalid({ settledOn: 'The settlement date is today and cannot be changed' });
  delete b.settledOn;
  const { p, line, settledOn, outstandingPaise } = await prepare(req, b);
  const today = startOfToday();
  // the settlement date is always today: only the date of death is entered
  if (settledOn.getTime() !== today.getTime()) throw invalid({ settledOn: 'The settlement date is today and cannot be changed' });
  const deathDate = parseDateOnly(asString(b.deathDate));
  if (!deathDate) throw invalid({ deathDate: 'Enter the date of death' });
  if (deathDate > today) throw invalid({ deathDate: 'The date of death cannot be in the future' });
  if (deathDate < p.paidOn) throw invalid({ deathDate: 'The date of death is before the loan was paid out' });
  if (settledOn < deathDate) throw invalid({ settledOn: 'The settlement cannot be before the date of death' });
  const remark = asString(b.remark).slice(0, 300);
  const certificate = typeof b.certificate === 'string' ? b.certificate : '';
  if (!certificate) throw invalid({ certificate: 'Upload the death certificate' });
  if (!DOC_RE.test(certificate)) throw invalid({ certificate: 'The death certificate must be a PDF or an image' });
  if (certificate.length > MAX_DOC_CHARS) throw invalid({ certificate: 'The death certificate must be 800 KB or smaller' });

  // Check if there is already an active or pending settlement for this member on this loan
  const existing = await LoanSettlement.findOne({
    loanPayment: p._id,
    memberCode: line.code,
    status: { $in: ['active', 'pending'] },
  });
  if (existing) {
    if (existing.status === 'pending') {
      throw new HttpError(409, `A death settlement request is already pending approval (${existing.receiptNo})`);
    }
    throw new HttpError(409, `This loan is already settled (${existing.receiptNo})`);
  }

  // The verifier is the signed-in employee (code and name come from the account, not from the form).
  const verifier = { code: req.user.employeeCode || '', name: req.user.name || '' };
  const isAdminUser = ['super_admin', 'admin'].includes(req.user.role);
  const status = isAdminUser ? 'active' : 'pending';

  const s = await save(req, p, line, {
    kind: 'death', outstandingPaise, amountPaise: 0, waiverPaise: outstandingPaise, settledOn, remark, deathDate, certificate, claimRef: asString(b.claimRef).slice(0, 60), verifier, status,
  });
  // After an approved death settlement the member is blocked (the same record the Block / Unblock screen keeps).
  let blocked = false;
  if (status === 'active' && line.member) {
    const m = await Member.findById(line.member).select('isBlocked');
    if (m && !m.isBlocked) {
      await Member.updateOne({ _id: m._id }, { $set: { isBlocked: true }, $push: { blockHistory: { action: 'block', reason: `Death settlement ${s.receiptNo} (died on ${iso(deathDate)})`, at: new Date(), by: req.user._id, byCode: verifier.code } } });
      blocked = true;
    }
  }
  await s.populate(POPULATE);
  await audit(req, {
    action: isAdminUser ? 'settlement.death' : 'settlement.deathRequest',
    entity: 'LoanSettlement',
    entityId: s._id,
    after: { receiptNo: s.receiptNo, loanId: p.loanId, member: line.code, deathDate: iso(deathDate), outstanding: outstandingPaise / 100, status, blocked },
  });
  notifyApprovers({
    branch: s.branch?._id || s.branch,
    title: isAdminUser ? 'Death settlement' : 'Death settlement request',
    message: isAdminUser
      ? `Loan ${p.loanId} for ${line.name || line.code} closed under death settlement (Receipt ${s.receiptNo}).`
      : `Death settlement request submitted for Loan ${p.loanId} (${line.name || line.code}) awaiting Admin approval.`,
    extraUsers: [req.user._id],
  });
  res.status(201).json({ settlement: present(s), pending: status === 'pending', memberBlocked: blocked });
}

/**
 * Guarantor death: the guarantor of a member has died. The loan itself carries on (the member keeps paying), but before the member
 * can have a new loan requisition the guarantor has to be changed (an admin does that under Member Details → Guarantor & Nominee).
 */
export async function recordGuarantorDeath(req, res) {
  const b = req.body || {};
  const p = await loadLoan(req, b.loan);
  const line = findLine(p, b.member);
  const m = await Member.findOne({ _id: line.member, isDeleted: false }).select('code name guarantor.name guarantor.deceasedOn');
  if (!m || !m.guarantor?.name) throw new HttpError(409, 'This member has no guarantor');
  if (m.guarantor.deceasedOn) throw new HttpError(409, `The death of the guarantor ${m.guarantor.name} is already recorded (${iso(m.guarantor.deceasedOn)})`);
  const today = startOfToday();
  const deathDate = parseDateOnly(asString(b.deathDate));
  if (!deathDate) throw invalid({ deathDate: 'Enter the date of death' });
  if (deathDate > today) throw invalid({ deathDate: 'The date of death cannot be in the future' });
  const certificate = typeof b.certificate === 'string' ? b.certificate : '';
  if (!certificate) throw invalid({ certificate: 'Upload the death certificate' });
  if (!DOC_RE.test(certificate)) throw invalid({ certificate: 'The death certificate must be a PDF or an image' });
  if (certificate.length > MAX_DOC_CHARS) throw invalid({ certificate: 'The death certificate must be 800 KB or smaller' });
  await Member.updateOne({ _id: m._id }, { $set: {
    'guarantor.deceasedOn': deathDate, 'guarantor.deathCertificate': certificate, 'guarantor.deathRemark': asString(b.remark).slice(0, 300),
    'guarantor.deathRecordedAt': new Date(), 'guarantor.deathRecordedByCode': req.user.employeeCode || '',
  } });
  await audit(req, { action: 'settlement.guarantorDeath', entity: 'Member', entityId: m._id, after: { member: m.code, guarantor: m.guarantor.name, deathDate: iso(deathDate), loanId: p.loanId } });
  res.status(201).json({ message: 'The death of the guarantor is recorded', member: { code: m.code, name: m.name }, guarantor: m.guarantor.name, deathDate: iso(deathDate) });
}

/** Members whose guarantor has died and who still have to change the guarantor. */
export async function guarantorDeathList(req, res) {
  const filter = { isDeleted: false, 'guarantor.deceasedOn': { $exists: true }, ...branchFilter(req.user) };
  if (mongoose.isValidObjectId(req.query.branch)) filter.branch = req.query.branch;
  const q = asString(req.query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ code: rx }, { name: rx }, { 'guarantor.name': rx }];
  }
  const items = await Member.find(filter).select('code name branch guarantor.name guarantor.mobile guarantor.deceasedOn guarantor.deathRemark guarantor.deathRecordedAt guarantor.deathRecordedByCode').populate('branch', 'code name').sort({ 'guarantor.deceasedOn': -1 }).limit(200);
  res.json({
    items: items.map((m) => ({
      memberId: m._id, code: m.code, name: m.name, branch: m.branch ? { code: m.branch.code, name: m.branch.name } : null, guarantor: m.guarantor.name, guarantorMobile: m.guarantor.mobile || '',
      diedOn: iso(m.guarantor.deceasedOn), recordedOn: iso(m.guarantor.deathRecordedAt), recordedBy: m.guarantor.deathRecordedByCode || '', remark: m.guarantor.deathRemark || '',
    })),
  });
}

export async function listSettlements(req, res) {
  const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 25 });
  const statusParam = asString(req.query.status);
  const status = ['active', 'cancelled', 'pending', 'rejected'].includes(statusParam)
    ? statusParam
    : (statusParam === 'all' ? { $in: ['active', 'cancelled', 'pending', 'rejected'] } : 'active');
  const filter = { ...branchFilter(req.user), kind: req.query.kind === 'death' ? 'death' : req.query.kind === 'auto' ? 'auto' : req.query.kind === 'manual' ? 'loan' : { $in: ['loan', 'auto'] }, status };
  if (mongoose.isValidObjectId(req.query.branch)) filter.branch = req.query.branch;
  const from = parseDateOnly(asString(req.query.from));
  const to = parseDateOnly(asString(req.query.to));
  if (from || to) {
    filter.settledOn = {};
    if (from) filter.settledOn.$gte = from;
    if (to) filter.settledOn.$lte = to;
  }
  const q = asString(req.query.q);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ receiptNo: rx }, { loanId: rx }, { formId: rx }, { memberCode: rx }, { memberName: rx }, { group: rx }];
  }
  const [items, total] = await Promise.all([
    LoanSettlement.find(filter).populate(POPULATE).sort({ createdAt: -1 }).skip(skip).limit(limit),
    LoanSettlement.countDocuments(filter),
  ]);
  res.json({ items: items.map((s) => present(s)), page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) });
}

export async function approveDeathSettlement(req, res) {
  if (!['super_admin', 'admin'].includes(req.user.role)) throw new HttpError(403, 'Only admin can approve death settlement');
  const s = await LoanSettlement.findOne({ _id: req.params.id, status: 'pending', kind: 'death' });
  if (!s) throw new HttpError(404, 'Pending death settlement request not found');

  const settledOn = await defaultWorkDate(s.branch, req.user);
  await assertDayOpen(s.branch, settledOn, req.user);

  s.status = 'active';
  s.settledOn = settledOn;
  await s.save();

  let blocked = false;
  if (s.member) {
    const m = await Member.findById(s.member).select('isBlocked');
    if (m && !m.isBlocked) {
      await Member.updateOne(
        { _id: m._id },
        {
          $set: { isBlocked: true },
          $push: {
            blockHistory: {
              action: 'block',
              reason: `Death settlement approved ${s.receiptNo} (died on ${iso(s.deathDate)})`,
              at: new Date(),
              by: req.user._id,
              byCode: req.user.employeeCode || '',
            },
          },
        }
      );
      blocked = true;
    }
  }

  await audit(req, {
    action: 'settlement.deathApprove',
    entity: 'LoanSettlement',
    entityId: s._id,
    after: { receiptNo: s.receiptNo, loanId: s.loanId, member: s.memberCode, deathDate: iso(s.deathDate), blocked },
  });

  notifyApprovers({
    branch: s.branch,
    title: 'Death settlement approved',
    message: `Death settlement for Loan ${s.loanId} (${s.memberName || s.memberCode}) has been approved by Admin. Loan closed.`,
    extraUsers: [s.createdBy],
  });

  res.json({ message: 'Death settlement approved and loan closed', settlement: present(s), memberBlocked: blocked });
}

export async function rejectDeathSettlement(req, res) {
  if (!['super_admin', 'admin'].includes(req.user.role)) throw new HttpError(403, 'Only admin can reject death settlement');
  const reason = asString(req.body?.reason).trim();
  if (reason.length < 3) throw invalid({ reason: 'Enter reason for rejection (at least 3 characters)' });
  const s = await LoanSettlement.findOne({ _id: req.params.id, status: 'pending', kind: 'death' });
  if (!s) throw new HttpError(404, 'Pending death settlement request not found');

  s.status = 'rejected';
  s.cancelReason = reason;
  s.cancelledAt = new Date();
  await s.save();

  await audit(req, {
    action: 'settlement.deathReject',
    entity: 'LoanSettlement',
    entityId: s._id,
    after: { receiptNo: s.receiptNo, loanId: s.loanId, member: s.memberCode, reason },
  });

  notifyApprovers({
    branch: s.branch,
    title: 'Death settlement rejected',
    message: `Death settlement request for Loan ${s.loanId} (${s.memberName || s.memberCode}) was rejected by Admin. Reason: ${reason}`,
    extraUsers: [s.createdBy],
  });

  res.json({ message: 'Death settlement request rejected', settlement: present(s) });
}

export async function getSettlement(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Settlement not found');
  const s = await LoanSettlement.findOne({ _id: req.params.id, ...branchFilter(req.user) }).select('+certificate').populate(POPULATE);
  if (!s) throw new HttpError(404, 'Settlement not found');
  res.json({ settlement: present(s, { full: true }) });
}

/** Admin undoes a settlement made by mistake: the loan is open again. (A blocked member stays blocked: unblock under Block / Unblock.) */
export async function cancelSettlement(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Settlement not found');
  const s = await LoanSettlement.findOne({ _id: req.params.id, status: 'active' });
  if (!s) throw new HttpError(404, 'Settlement not found');
  if (s.kind === 'auto') throw new HttpError(409, 'An automatic settlement (every installment paid) cannot be cancelled');
  const reason = asString(req.body?.reason);
  if (reason.length < 3 || reason.length > 200) throw invalid({ reason: 'Enter the reason (3–200 characters)' });
  s.status = 'cancelled';
  s.cancelReason = reason;
  s.cancelledAt = new Date();
  await s.save();
  await audit(req, { action: 'settlement.cancel', entity: 'LoanSettlement', entityId: s._id, after: { receiptNo: s.receiptNo, kind: s.kind, reason } });
  res.json({ message: 'Settlement cancelled', memberStaysBlocked: s.kind === 'death' });
}
