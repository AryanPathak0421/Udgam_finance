import mongoose from 'mongoose';
import { AppUser } from '../models/AppUser.js';
import { AppEmiCollection, APP_EMI_STATUS } from '../models/AppEmiCollection.js';
import { Member } from '../models/Member.js';
import { User } from '../models/User.js';
import { Employee } from '../models/Hr.js';
import { asString, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';
import { branchFilter, showMobile } from './groupController.js';
import { borrowerState, receive, loadLoan } from './emiController.js';

/**
 * App Section: the staff who may use the mobile app (App User Creation), the members they register there (Member Joining Approval) and the EMI they
 * collect there (Loan EMI Collection Approval). Nothing from the app counts until it is approved.
 */
const invalid = (errors) => new HttpError(422, 'Please correct the highlighted fields', errors);
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const rupees = (p) => (p || 0) / 100;

function scope(req) {
  const filter = branchFilter(req.user);
  const wanted = asString(req.query.branch);
  if (mongoose.isValidObjectId(wanted)) {
    const own = filter.branch?.$in?.map(String);
    return own && !own.includes(wanted) ? { branch: { $in: [] } } : { branch: new mongoose.Types.ObjectId(wanted) };
  }
  return filter.branch ? { branch: { $in: filter.branch.$in.map((b) => new mongoose.Types.ObjectId(String(b))) } } : {};
}

// ---- App User Creation --------------------------------------------------------------------------------------------------

const presentUser = (a, u) => ({
  id: a._id, employeeCode: a.employeeCode, name: a.name || u?.name || '', email: u?.email || '', role: u?.role || '', mobile: u?.mobile || '', note: a.note || '', isActive: a.isActive,
  branches: (u?.branches || []).map((b) => (b._id ? { id: b._id, code: b.code, name: b.name } : { id: b })), createdBy: a.createdByCode || '', createdAt: a.createdAt, deactivatedAt: a.deactivatedAt,
});

export async function listAppUsers(req, res) {
  const rows = await AppUser.find({}).sort({ createdAt: -1 }).lean();
  const users = new Map((await User.find({ _id: { $in: rows.map((r) => r.user) } }).select('name email role mobile branches isActive').populate('branches', 'code name').lean()).map((u) => [String(u._id), u]));
  res.json({ items: rows.map((a) => ({ ...presentUser(a, users.get(String(a.user))), staffActive: users.get(String(a.user))?.isActive !== false })) });
}

/** Staff who can still be made app users: active, with an employee code, not yet app users. */
export async function staffOptions(_req, res) {
  const taken = (await AppUser.find({}).select('user').lean()).map((a) => a.user);
  const staff = await User.find({ _id: { $nin: taken }, isActive: true, employeeCode: { $exists: true, $ne: '' } }).select('name employeeCode role branches').populate('branches', 'code name').sort({ name: 1 }).lean();
  // employees registered in HR who have no staff login yet: they cannot be app users until a login is made for them (User Master)
  const noLogin = await Employee.find({ isDeleted: false, status: 'active', user: { $exists: false } }).select('employeeCode name branch').populate('branch', 'code name').sort({ name: 1 }).limit(500).lean();
  res.json({ items: staff.map((u) => ({ id: u._id, employeeCode: u.employeeCode, name: u.name, role: u.role, branches: (u.branches || []).map((b) => b.code).join(', '), branchCode: (u.branches || []).map((b) => b.code).join(', '), branchName: (u.branches || []).map((b) => b.name).join(', ') })), noLogin: noLogin.map((e) => ({ employeeCode: e.employeeCode, name: e.name, branchCode: e.branch?.code || '', branchName: e.branch?.name || '' })) });
}

export async function createAppUser(req, res) {
  const b = req.body || {};
  if (!mongoose.isValidObjectId(asString(b.user))) throw invalid({ user: 'Select the staff member' });
  const u = await User.findOne({ _id: b.user, isActive: true });
  if (!u || !u.employeeCode) throw invalid({ user: 'This staff member is not available (needs an active login and an employee code)' });
  if (await AppUser.exists({ user: u._id })) throw new HttpError(409, 'This staff member is already an app user', { user: 'Already an app user' });
  const a = await AppUser.create({ user: u._id, employeeCode: u.employeeCode, name: u.name, note: asString(b.note).slice(0, 100), createdBy: req.user._id, createdByCode: req.user.employeeCode || '' });
  await audit(req, { action: 'appUser.create', entity: 'AppUser', entityId: a._id, after: { employeeCode: a.employeeCode, name: a.name } });
  res.status(201).json({ appUser: presentUser(a, u) });
}

export async function setAppUserStatus(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'App user not found');
  const a = await AppUser.findById(req.params.id);
  if (!a) throw new HttpError(404, 'App user not found');
  a.isActive = Boolean(req.body?.isActive);
  a.deactivatedAt = a.isActive ? undefined : new Date();
  await a.save();
  await audit(req, { action: 'appUser.status', entity: 'AppUser', entityId: a._id, after: { employeeCode: a.employeeCode, isActive: a.isActive } });
  res.json({ isActive: a.isActive });
}

export async function removeAppUser(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'App user not found');
  const a = await AppUser.findById(req.params.id);
  if (!a) throw new HttpError(404, 'App user not found');
  await a.deleteOne();
  await audit(req, { action: 'appUser.remove', entity: 'AppUser', entityId: a._id, after: { employeeCode: a.employeeCode } });
  res.json({ message: 'App access removed' });
}

// ---- Member Joining Approval ----------------------------------------------------------------------------------------------

const presentMember = (m, user) => ({
  id: m._id, code: m.code, formId: m.formId, name: m.name, mobile: showMobile(user, m.mobile), gender: m.gender, dob: iso(m.dob), husbandName: m.husbandName || '', address: m.address || '', pincode: m.pincode || '', district: m.district || '', state: m.state || '',
  aadhaar: m.aadhaar ? `XXXXXXXX${String(m.aadhaar).slice(-4)}` : '', branch: m.branch?._id ? { id: m.branch._id, code: m.branch.code, name: m.branch.name } : null, joiningDate: iso(m.joiningDate), registeredBy: m.employeeCode || '',
  status: m.joiningApproval?.status || 'approved', decidedBy: m.joiningApproval?.byCode || '', decidedAt: m.joiningApproval?.at || null, reason: m.joiningApproval?.reason || '',
});

export async function listMemberApprovals(req, res) {
  const st = asString(req.query.status) || 'pending';
  const filter = { isDeleted: false, 'joiningApproval.source': 'app', ...scope(req) };
  if (['pending', 'approved', 'rejected'].includes(st)) filter['joiningApproval.status'] = st;
  const q = asString(req.query.q).toLowerCase();
  const rows = await Member.find(filter).sort({ createdAt: -1 }).limit(1000).select('code formId name mobile gender dob husbandName address pincode district state aadhaar branch joiningDate employeeCode joiningApproval').populate('branch', 'code name').lean();
  const items = rows.map((m) => presentMember(m, req.user)).filter((m) => !q || [m.code, m.name, m.formId].some((v) => String(v).toLowerCase().includes(q)));
  res.json({ items });
}

async function loadAppMember(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Member not found');
  const m = await Member.findOne({ _id: req.params.id, isDeleted: false, 'joiningApproval.source': 'app', ...branchFilter(req.user) });
  if (!m) throw new HttpError(404, 'Member not found');
  if (m.joiningApproval.status !== 'pending') throw new HttpError(409, `This member is already ${m.joiningApproval.status}`);
  return m;
}
export async function approveMember(req, res) {
  const m = await loadAppMember(req);
  m.set('joiningApproval.status', 'approved');
  m.set('joiningApproval.byCode', req.user.employeeCode || '');
  m.set('joiningApproval.at', new Date());
  m.set('joiningApproval.reason', undefined);
  await m.save();
  await audit(req, { action: 'appMember.approve', entity: 'Member', entityId: m._id, after: { code: m.code } });
  res.json({ status: 'approved' });
}
export async function rejectMember(req, res) {
  const m = await loadAppMember(req);
  const reason = asString(req.body?.reason).slice(0, 200);
  if (reason.length < 3) throw invalid({ reason: 'Enter the reason' });
  m.set('joiningApproval.status', 'rejected');
  m.set('joiningApproval.byCode', req.user.employeeCode || '');
  m.set('joiningApproval.at', new Date());
  m.set('joiningApproval.reason', reason);
  await m.save();
  await audit(req, { action: 'appMember.reject', entity: 'Member', entityId: m._id, after: { code: m.code, reason } });
  res.json({ status: 'rejected' });
}

// ---- Loan EMI Collection Approval -----------------------------------------------------------------------------------------

/** EMI collected in the app: checked like any collection, then kept as a request until it is approved. */
export async function queueAppEmi(req, p, line, { amountPaise, count, type, paidOn, payMode, reference, bankAccount }) {
  const st = await borrowerState(p, line, paidOn);
  if (st.settled) throw new HttpError(409, 'This loan has been settled. No EMI is due.');
  const waiting = (await AppEmiCollection.aggregate([{ $match: { loanPayment: p._id, memberCode: line.code, status: 'pending' } }, { $group: { _id: null, t: { $sum: '$amountPaise' } } }]))[0]?.t || 0;
  let pay = amountPaise;
  let kind;
  let covers;
  if (pay === undefined) {
    // by number of installments, like the Loan ID screens: due installments (regular) or installments ahead (advance)
    kind = type === 'advance' ? 'advance' : 'regular';
    if (kind === 'regular') {
      if (!st.due.length) throw new HttpError(409, 'No installment is due now. Pay in advance instead.');
      covers = count === undefined ? st.due.length : count;
      if (!Number.isInteger(covers) || covers < 1 || covers > st.due.length) throw invalid({ count: `Choose 1 to ${st.due.length} due installment${st.due.length === 1 ? '' : 's'}` });
      pay = st.due.slice(0, covers).reduce((s, x) => s + x.remainingPaise, 0);
    } else {
      if (st.due.length) throw new HttpError(409, `${st.due.length} installment${st.due.length === 1 ? ' is' : 's are'} due. Collect the due EMI first, then pay in advance.`);
      covers = count;
      if (!Number.isInteger(covers) || covers < 1 || covers > st.left.length) throw invalid({ count: `Choose 1 to ${st.left.length} installment${st.left.length === 1 ? '' : 's'} to pay in advance` });
      pay = st.left.slice(0, covers).reduce((s, x) => s + x.remainingPaise, 0);
    }
  }
  if (!Number.isInteger(pay) || pay < 100) throw invalid({ amount: 'Enter the amount received (₹1 or more, up to 2 decimals)' });
  if (kind === 'advance') {
    if (pay + waiting > st.totals.outstanding) throw invalid({ amount: `The borrower owes only ₹${Math.max(st.totals.outstanding - waiting, 0) / 100}${waiting ? ` (₹${waiting / 100} is already waiting for approval)` : ''}` });
  } else if (pay + waiting > st.totals.due) {
    throw invalid({ amount: `Only ₹${Math.max(st.totals.due - waiting, 0) / 100} is due${waiting ? ` (₹${waiting / 100} is already waiting for approval)` : ''}` });
  }
  amountPaise = pay;
  return AppEmiCollection.create({
    type: kind, installments: covers,
    loanPayment: p._id, loanId: p.loanId || p.formId, branch: p.branch._id, memberCode: line.code, memberName: line.name, group: p.group?.code ? `${p.group.code} — ${p.group.name}` : '', amountPaise, collectedOn: paidOn,
    payMode, bankAccount, reference: asString(reference).slice(0, 60), collectedBy: req.user._id, collectedByCode: req.user.employeeCode || '',
  });
}

const presentEmi = (c) => ({
  id: c._id, loanId: c.loanId, branch: c.branch?._id ? { id: c.branch._id, code: c.branch.code, name: c.branch.name } : null, memberCode: c.memberCode, memberName: c.memberName, group: c.group || '', amount: rupees(c.amountPaise),
  collectedOn: iso(c.collectedOn), type: c.type || '', installments: c.installments || null, payMode: c.payMode, reference: c.reference || '', collectedBy: c.collectedByCode || '', submittedAt: c.createdAt, status: c.status, decidedBy: c.decidedByCode || '', decidedAt: c.decidedAt,
  reason: c.rejectReason || '', receiptNo: c.receiptNo || '',
});

export async function listEmiApprovals(req, res) {
  const st = asString(req.query.status) || 'pending';
  const filter = { ...scope(req) };
  if (APP_EMI_STATUS.includes(st)) filter.status = st;
  const q = asString(req.query.q).toLowerCase();
  const rows = await AppEmiCollection.find(filter).sort({ createdAt: -1 }).limit(1000).populate('branch', 'code name').lean();
  const items = rows.map(presentEmi).filter((c) => !q || [c.loanId, c.memberCode, c.memberName, c.collectedBy, c.group].some((v) => String(v).toLowerCase().includes(q)));
  res.json({ items, summary: { requests: items.length, amount: items.reduce((s, c) => s + c.amount, 0) } });
}

async function loadEmiRequest(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Collection not found');
  const c = await AppEmiCollection.findOne({ _id: req.params.id, ...branchFilter(req.user) });
  if (!c) throw new HttpError(404, 'Collection not found');
  if (c.status !== 'pending') throw new HttpError(409, `This collection is already ${c.status}`);
  return c;
}

/** Approved: the EMI is received now, as if the collector had entered it (the receipt carries the collector's employee code). */
export async function approveEmi(req, res) {
  const c = await loadEmiRequest(req);
  const collector = await User.findById(c.collectedBy);
  if (!collector) throw new HttpError(409, 'The staff member who collected this no longer exists');
  const p = await loadLoan(req, c.loanPayment);
  const line = p.lines.find((l) => l.code === c.memberCode);
  if (!line) throw new HttpError(409, 'The borrower is no longer on this loan');
  let doc;
  try {
    doc = await receive({ user: collector, ip: req.ip, headers: req.headers }, p, line, { amountPaise: c.amountPaise, type: c.type, paidOn: c.collectedOn, payMode: c.payMode, reference: c.reference, bankAccount: c.bankAccount, dueOnly: c.type !== 'advance' });
  } catch (err) {
    throw new HttpError(err.status || 409, `This collection cannot be received now: ${err.errors?.amount || err.message}. Reject it instead.`);
  }
  c.status = 'approved';
  c.decidedByCode = req.user.employeeCode || '';
  c.decidedAt = new Date();
  c.receiptNo = doc.receiptNo;
  await c.save();
  await audit(req, { action: 'appEmi.approve', entity: 'AppEmiCollection', entityId: c._id, after: { loan: c.loanId, member: c.memberCode, amount: c.amountPaise / 100, receiptNo: doc.receiptNo } });
  res.json({ receiptNo: doc.receiptNo });
}
export async function rejectEmi(req, res) {
  const c = await loadEmiRequest(req);
  const reason = asString(req.body?.reason).slice(0, 200);
  if (reason.length < 3) throw invalid({ reason: 'Enter the reason' });
  c.status = 'rejected';
  c.decidedByCode = req.user.employeeCode || '';
  c.decidedAt = new Date();
  c.rejectReason = reason;
  await c.save();
  await audit(req, { action: 'appEmi.reject', entity: 'AppEmiCollection', entityId: c._id, after: { loan: c.loanId, member: c.memberCode, reason } });
  res.json({ status: 'rejected' });
}

/** What the app user sees of their own submissions. */
export async function myAppRequests(req, res) {
  const rows = await AppEmiCollection.find({ collectedBy: req.user._id }).sort({ createdAt: -1 }).limit(100).populate('branch', 'code name').lean();
  const members = await Member.find({ 'joiningApproval.source': 'app', createdBy: req.user._id, isDeleted: false }).sort({ createdAt: -1 }).limit(100).select('code name joiningApproval').lean();
  res.json({
    emi: rows.map(presentEmi),
    members: members.map((m) => ({ id: m._id, code: m.code, name: m.name, status: m.joiningApproval?.status || 'approved', reason: m.joiningApproval?.reason || '' })),
  });
}
