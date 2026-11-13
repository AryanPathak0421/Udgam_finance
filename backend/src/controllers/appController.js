import mongoose from 'mongoose';
import { AppUser } from '../models/AppUser.js';
import { AppEmiCollection, APP_EMI_STATUS } from '../models/AppEmiCollection.js';
import { Member } from '../models/Member.js';
import { User } from '../models/User.js';
import { Employee } from '../models/Hr.js';
import { LoanPayment } from '../models/LoanPayment.js';
import { EmiPayment } from '../models/EmiPayment.js';
import { generateCode } from '../services/codeSequence.js';
import { ProductSaleOrder } from '../modules/employee/employeeAppModel.js';
import { StockProduct } from '../models/StockProduct.js';
import { blockedCodes } from '../services/blockedStaff.js';
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
  // 1. Auto-sync legacy and active employees:
  // If an Employee has an EmployeeMpin or active employee/user account, ensure they exist in AppUser
  try {
    const existingAppUsers = await AppUser.find({}).lean();
    const existingUserIds = new Set(existingAppUsers.map((a) => String(a.user)));
    const existingCodes = new Set(existingAppUsers.map((a) => (a.employeeCode || '').toUpperCase()));

    const allEmployees = await Employee.find({
      isDeleted: { $ne: true },
      isBlocked: { $ne: true },
    }).populate('branch', 'code name').lean();

    for (const emp of allEmployees) {
      const codeUpper = (emp.employeeCode || '').toUpperCase();
      if (!existingCodes.has(codeUpper)) {
        let u = null;
        if (emp.user) {
          u = await User.findById(emp.user);
        }
        if (!u && emp.email) {
          u = await User.findOne({ email: emp.email.toLowerCase() });
        }
        if (!u && codeUpper) {
          u = await User.findOne({ employeeCode: new RegExp(`^${codeUpper}$`, 'i') });
        }
        if (!u && codeUpper) {
          u = await User.create({
            name: emp.name,
            email: emp.email || `${codeUpper.toLowerCase()}@udgam.local`,
            mobile: emp.mobile,
            employeeCode: codeUpper,
            password: 'Password@123',
            role: 'field_officer',
            branches: emp.branch?._id ? [emp.branch._id] : [],
            isActive: true,
          }).catch(() => null);
        }
        if (u) {
          if (!u.employeeCode && codeUpper) {
            u.employeeCode = codeUpper;
            await u.save();
          }
          if (!existingUserIds.has(String(u._id))) {
            const a = await AppUser.create({
              user: u._id,
              employeeCode: codeUpper,
              name: emp.name || u.name,
              isActive: true,
              createdByCode: 'AUTO',
            }).catch(() => null);
            if (a) {
              existingUserIds.add(String(u._id));
              existingCodes.add(codeUpper);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('listAppUsers auto-sync failed', err.message);
  }

  const rows = await AppUser.find({}).sort({ createdAt: -1 }).lean();
  const userIds = rows.map((r) => r.user).filter(Boolean);
  const usersList = await User.find({ _id: { $in: userIds } })
    .select('name email role mobile branches isActive employeeCode')
    .populate('branches', 'code name')
    .lean();
  const users = new Map(usersList.map((u) => [String(u._id), u]));

  const empList = await Employee.find({
    isDeleted: false,
    employeeCode: { $in: rows.map((r) => r.employeeCode) },
  }).populate('branch', 'code name').lean();
  const empMap = new Map(empList.map((e) => [(e.employeeCode || '').toUpperCase(), e]));

  res.json({
    items: rows.map((a) => {
      const u = users.get(String(a.user));
      const emp = empMap.get((a.employeeCode || '').toUpperCase());
      const rawBranches = u?.branches?.length ? u.branches : (emp?.branch ? [emp.branch] : []);
      const branches = rawBranches.map((b) =>
        b._id ? { id: b._id, code: b.code, name: b.name } : { id: b, code: emp?.branch?.code || '—', name: emp?.branch?.name || '' }
      );
      return {
        id: a._id,
        employeeCode: a.employeeCode,
        name: a.name || u?.name || emp?.name || '',
        email: u?.email || emp?.email || '',
        role: u?.role || emp?.designation || 'field_officer',
        mobile: u?.mobile || emp?.mobile || '',
        note: a.note || '',
        isActive: a.isActive,
        branches,
        createdBy: a.createdByCode || '',
        createdAt: a.createdAt,
        deactivatedAt: a.deactivatedAt,
        staffActive: u ? u.isActive !== false : (emp?.status === 'active' && !emp.isBlocked),
      };
    }),
  });
}

/** Staff who can still be made app users: active, with an employee code, not yet app users. */
export async function staffOptions(_req, res) {
  const taken = await AppUser.find({}).select('user employeeCode').lean();
  const takenUserIds = new Set(taken.map((a) => String(a.user)));
  const takenCodes = new Set(taken.map((a) => (a.employeeCode || '').toUpperCase()));
  const blocked = await blockedCodes();

  // 1. All employees in HR (active, legacy, and existing staff)
  const employees = await Employee.find({
    isDeleted: { $ne: true },
    isBlocked: { $ne: true },
  })
    .populate('branch', 'code name')
    .populate('designation', 'name')
    .sort({ name: 1 })
    .lean();

  const employeeByCode = new Map(employees.map((e) => [e.employeeCode.toUpperCase(), e]));
  const employeeByUserId = new Map(employees.filter((e) => e.user).map((e) => [String(e.user), e]));

  // 2. All Users not yet in AppUser (including legacyImport and active users)
  const users = await User.find({
    _id: { $nin: Array.from(takenUserIds) },
  })
    .select('name employeeCode role branches mobile email isActive legacyImport')
    .populate('branches', 'code name')
    .sort({ name: 1 })
    .lean();

  const staffItems = [];
  const seenCodes = new Set();
  const seenIds = new Set();

  for (const u of users) {
    const code = (u.employeeCode || '').toUpperCase();
    if (code && (takenCodes.has(code) || blocked.includes(code))) continue;

    const emp = (code ? employeeByCode.get(code) : null) || employeeByUserId.get(String(u._id));
    const finalCode = code || emp?.employeeCode || `EMP${String(u._id).slice(-4).toUpperCase()}`;

    if (takenCodes.has(finalCode) || seenCodes.has(finalCode)) continue;
    seenCodes.add(finalCode);
    seenIds.add(String(u._id));

    const branches = u.branches && u.branches.length ? u.branches : (emp?.branch ? [emp.branch] : []);
    staffItems.push({
      id: u._id,
      employeeCode: finalCode,
      name: u.name || emp?.name,
      role: u.role || 'field_officer',
      branches: branches.map((b) => b.code || b).join(', '),
      branchCode: branches.map((b) => b.code || b).join(', '),
      branchName: branches.map((b) => b.name || '').join(', '),
    });
  }

  // Also include any active Employee who doesn't have a user account yet or whose user wasn't caught
  for (const emp of employees) {
    const code = emp.employeeCode.toUpperCase();
    if (takenCodes.has(code) || seenCodes.has(code) || blocked.includes(code)) continue;

    seenCodes.add(code);
    staffItems.push({
      id: emp.user || emp._id,
      employeeCode: code,
      name: emp.name,
      role: emp.designation?.name || 'field_officer',
      branches: emp.branch?.code || '—',
      branchCode: emp.branch?.code || '—',
      branchName: emp.branch?.name || '—',
    });
  }

  res.json({
    items: staffItems,
    noLogin: [],
  });
}

export async function createAppUser(req, res) {
  const b = req.body || {};
  const targetId = asString(b.user);
  if (!mongoose.isValidObjectId(targetId)) throw invalid({ user: 'Select the staff member' });

  // targetId can be a User ID or an Employee ID
  let u = await User.findById(targetId);
  let emp = null;

  if (!u) {
    emp = await Employee.findById(targetId).populate('branch');
    if (emp) {
      u = await User.findOne({
        $or: [
          { employeeCode: new RegExp(`^${emp.employeeCode}$`, 'i') },
          ...(emp.email ? [{ email: emp.email.toLowerCase() }] : []),
          ...(emp.user ? [{ _id: emp.user }] : []),
        ],
      });
      if (!u) {
        u = await User.create({
          name: emp.name,
          email: emp.email || `${emp.employeeCode.toLowerCase()}@udgam.local`,
          mobile: emp.mobile,
          employeeCode: emp.employeeCode,
          password: 'Password@123',
          role: 'field_officer',
          branches: emp.branch?._id ? [emp.branch._id] : [],
          isActive: true,
        });
      }
      if (!emp.user) {
        emp.user = u._id;
        await emp.save();
      }
    }
  } else {
    emp = await Employee.findOne({
      $or: [
        { user: u._id },
        ...(u.employeeCode ? [{ employeeCode: new RegExp(`^${u.employeeCode}$`, 'i') }] : []),
        ...(u.email ? [{ email: u.email.toLowerCase() }] : []),
      ],
      isDeleted: false,
    }).populate('branch');
  }

  if (!u) throw invalid({ user: 'Staff member record not found' });

  if (!u.employeeCode && emp?.employeeCode) {
    u.employeeCode = emp.employeeCode;
    await u.save();
  }
  if (!u.employeeCode) {
    u.employeeCode = `EMP${String(u._id).slice(-4).toUpperCase()}`;
    await u.save();
  }

  if (!u.isActive) {
    u.isActive = true;
    await u.save();
  }

  const blocked = await blockedCodes();
  if (blocked.includes(u.employeeCode)) {
    throw invalid({ user: 'This staff member is blocked from using the app' });
  }

  if (await AppUser.exists({ user: u._id })) {
    throw new HttpError(409, 'This staff member is already an app user', { user: 'Already an app user' });
  }

  const a = await AppUser.create({
    user: u._id,
    employeeCode: u.employeeCode,
    name: u.name || emp?.name,
    note: asString(b.note).slice(0, 100),
    createdBy: req.user._id,
    createdByCode: req.user.employeeCode || '',
    isActive: true,
  });

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
  const filter = { isDeleted: false, ...scope(req) };
  if (['pending', 'approved', 'rejected'].includes(st)) {
    filter.$or = [
      { 'joiningApproval.source': 'app', 'joiningApproval.status': st },
      { 'joiningApproval.status': st },
    ];
  }
  const q = asString(req.query.q).toLowerCase();
  const rows = await Member.find(filter).sort({ createdAt: -1 }).limit(1000).select('code formId name mobile gender dob husbandName address pincode district state aadhaar branch joiningDate employeeCode joiningApproval').populate('branch', 'code name').lean();
  const items = rows.map((m) => presentMember(m, req.user)).filter((m) => !q || [m.code, m.name, m.formId].some((v) => String(v).toLowerCase().includes(q)));
  res.json({ items });
}

async function loadAppMember(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Member not found');
  const m = await Member.findOne({
    _id: req.params.id,
    isDeleted: false,
    $or: [{ 'joiningApproval.source': 'app' }, { employeeCode: { $exists: true, $ne: '' } }],
    ...branchFilter(req.user),
  });
  if (!m) throw new HttpError(404, 'Member not found');
  if (m.joiningApproval?.status && m.joiningApproval.status !== 'pending') {
    throw new HttpError(409, `This member is already ${m.joiningApproval.status}`);
  }
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

  // Point 11: Date-wise filtering for Loan EMI Collection Approval
  const fromStr = asString(req.query.from);
  const toStr = asString(req.query.to);
  const singleDate = asString(req.query.date);
  if (fromStr || toStr) {
    filter.collectedOn = {};
    if (fromStr) filter.collectedOn.$gte = new Date(`${fromStr}T00:00:00.000Z`);
    if (toStr) filter.collectedOn.$lte = new Date(`${toStr}T23:59:59.999Z`);
  } else if (singleDate) {
    filter.collectedOn = {
      $gte: new Date(`${singleDate}T00:00:00.000Z`),
      $lte: new Date(`${singleDate}T23:59:59.999Z`),
    };
  }

  const q = asString(req.query.q).toLowerCase();
  const rows = await AppEmiCollection.find(filter).sort({ createdAt: -1 }).limit(1000).populate('branch', 'code name').lean();

  const collectorCodes = [...new Set(rows.map((r) => r.collectedByCode).filter(Boolean))];
  const collectorUserIds = [...new Set(rows.map((r) => r.collectedBy).filter(Boolean))];
  const [empDocs, userDocs] = await Promise.all([
    Employee.find({ employeeCode: { $in: collectorCodes } }).select('employeeCode name').lean(),
    User.find({ _id: { $in: collectorUserIds } }).select('employeeCode name username').lean(),
  ]);
  const nameByCode = new Map(empDocs.map((e) => [String(e.employeeCode).toUpperCase(), e.name]));
  const nameById = new Map(userDocs.map((u) => [String(u._id), u.name || u.username]));
  userDocs.forEach((u) => { if (u.employeeCode) nameByCode.set(String(u.employeeCode).toUpperCase(), u.name || u.username); });

  const items = rows.map((r) => {
    const item = presentEmi(r);
    item.collectorName = nameByCode.get(String(r.collectedByCode || '').toUpperCase()) || nameById.get(String(r.collectedBy)) || r.collectedByCode || '';
    return item;
  }).filter((c) => !q || [c.loanId, c.memberCode, c.memberName, c.collectedBy, c.collectorName, c.group].some((v) => String(v).toLowerCase().includes(q)));

  const onlineReceive = items.filter((c) => ['bank', 'upi', 'cheque'].includes(c.payMode)).reduce((s, c) => s + c.amount, 0);
  const offlineReceive = items.filter((c) => c.payMode === 'cash').reduce((s, c) => s + c.amount, 0);
  const npaReceive = items.filter((c) => c.type === 'npa').reduce((s, c) => s + c.amount, 0);
  const advanceReceive = items.filter((c) => c.type === 'advance').reduce((s, c) => s + c.amount, 0);

  const productAgg = await ProductSaleOrder.aggregate([
    { $match: { isDeleted: false, ...branchFilter(req.user) } },
    { $group: { _id: null, totalPaise: { $sum: '$totalAmountPaise' } } },
  ]).catch(() => [{ totalPaise: 0 }]);
  const productBookingAmount = (productAgg[0]?.totalPaise || 0) / 100;

  const totalAmount = items.reduce((s, c) => s + c.amount, 0);
  const grandTotal = totalAmount + productBookingAmount;

  res.json({
    items,
    summary: {
      requests: items.length,
      amount: totalAmount,
      onlineReceive,
      offlineReceive,
      npaReceive,
      advanceReceive,
      productBookingAmount,
      grandTotal,
    },
  });
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
  let collector = c.collectedBy ? await User.findById(c.collectedBy) : null;
  if (!collector && c.collectedByCode) {
    collector = await User.findOne({ employeeCode: c.collectedByCode });
  }
  if (!collector) collector = req.user;

  // Item 21 Fix: Resilient loan lookup so admin approval never gets blocked with 404 or missing line
  let p = null;
  if (c.loanPayment) {
    p = await loadLoan(req, c.loanPayment).catch(() => null);
    if (!p) {
      p = await LoanPayment.findById(c.loanPayment).populate('lines.member branch').catch(() => null);
    }
  }
  if (!p && c.loanId) {
    p = await LoanPayment.findOne({
      $or: [
        { loanId: c.loanId },
        { formId: c.loanId },
        ...(mongoose.isValidObjectId(c.loanId) ? [{ _id: c.loanId }] : []),
      ],
    }).populate('lines.member branch').catch(() => null);
  }

  const line = p?.lines?.find((l) => (
    l.code?.toUpperCase() === c.memberCode?.toUpperCase() ||
    String(l.member?._id || l.member) === String(c.member)
  )) || p?.lines?.[0] || {
    code: c.memberCode,
    name: c.memberName,
    member: c.member,
  };

  let doc;
  if (c.receiptNo) {
    const existing = await EmiPayment.findOne({ receiptNo: c.receiptNo });
    if (existing) doc = existing;
  }
  if (!doc && p) {
    const matching = await EmiPayment.findOne({
      loanPayment: p._id,
      memberCode: line.code,
      amountPaise: c.amountPaise,
      createdAt: { $gte: new Date(c.createdAt.getTime() - 86400000), $lte: new Date(c.createdAt.getTime() + 86400000) },
    });
    if (matching) doc = matching;
  }

  if (!doc && p) {
    try {
      doc = await receive(
        { user: collector, ip: req.ip, headers: req.headers },
        p,
        line,
        {
          amountPaise: c.amountPaise,
          type: c.type || 'regular',
          paidOn: c.collectedOn || new Date(),
          payMode: c.payMode,
          reference: c.reference,
          bankAccount: c.bankAccount,
          dueOnly: false,
          employeeCode: c.collectedByCode || collector.employeeCode,
        }
      );
    } catch {
      try {
        doc = await receive(
          { user: collector, ip: req.ip, headers: req.headers },
          p,
          line,
          {
            amountPaise: c.amountPaise,
            type: c.type || 'regular',
            paidOn: new Date(),
            payMode: c.payMode,
            reference: c.reference,
            bankAccount: c.bankAccount,
            dueOnly: false,
            employeeCode: c.collectedByCode || collector.employeeCode,
          }
        );
      } catch {
        // Fallback: If loan is closed or regular receive fails, create EmiPayment directly so collection is recorded
        const receiptNo = await generateCode('emiReceipt').catch(() => `REC${Date.now().toString().slice(-8)}`);
        doc = await EmiPayment.create({
          receiptNo,
          loanPayment: p._id,
          loanId: p.loanId || c.loanId,
          formId: p.formId,
          branch: p.branch?._id || p.branch || c.branch,
          type: c.type || 'regular',
          member: line.member?._id || line.member || c.member,
          memberCode: line.code || c.memberCode,
          memberName: line.name || c.memberName,
          group: p.group?.code ? `${p.group.code} — ${p.group.name}` : (c.group || ''),
          amountPaise: c.amountPaise,
          paidOn: c.collectedOn || new Date(),
          payMode: c.payMode || 'cash',
          reference: c.reference || '',
          employeeCode: c.collectedByCode || collector.employeeCode || '',
          createdBy: req.user._id,
          createdByCode: req.user.employeeCode || '',
          status: 'paid',
        });
      }
    }
  }

  c.status = 'approved';
  c.decidedByCode = req.user.employeeCode || '';
  c.decidedAt = new Date();
  c.receiptNo = doc?.receiptNo || c.receiptNo || (await generateCode('emiReceipt').catch(() => `REC${Date.now().toString().slice(-8)}`));
  await c.save();
  await audit(req, { action: 'appEmi.approve', entity: 'AppEmiCollection', entityId: c._id, after: { loan: c.loanId, member: c.memberCode, amount: c.amountPaise / 100, receiptNo: c.receiptNo } });
  res.json({ receiptNo: c.receiptNo });
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

// ---------------------------------------------------------------------------------------------------------------------------
// Product Bookings submitted from mobile app - filtered by branch and presented employee-wise
// ---------------------------------------------------------------------------------------------------------------------------
export async function listProductBookings(req, res) {
  const filter = scope(req);
  const statusWanted = asString(req.query.status);
  if (['pending', 'approved', 'rejected', 'completed'].includes(statusWanted)) {
    filter.status = statusWanted;
  }
  const q = asString(req.query.q).toLowerCase();

  const orders = await ProductSaleOrder.find(filter)
    .populate('branch', 'code name')
    .sort({ createdAt: -1 })
    .lean();

  const formatted = orders.map((o) => ({
    id: o._id,
    receiptNo: o.receiptNo,
    employeeCode: o.employeeCode,
    employeeName: o.employeeName || o.employeeCode,
    branch: o.branch?._id ? { id: o.branch._id, code: o.branch.code, name: o.branch.name } : null,
    memberCode: o.memberCode,
    memberName: o.memberName || 'Customer',
    productCode: o.productCode,
    productName: o.productName,
    quantity: o.quantity || 1,
    unitPrice: o.unitPrice,
    totalAmount: o.totalAmount,
    payMode: o.payMode || 'cash',
    status: o.status || 'pending',
    approvedByCode: o.approvedByCode || '',
    rejectReason: o.rejectReason || '',
    createdAt: o.createdAt,
  })).filter((o) => !q || [o.receiptNo, o.employeeCode, o.employeeName, o.memberCode, o.memberName, o.productName].some((v) => String(v || '').toLowerCase().includes(q)));

  // Group employee-wise
  const byEmployeeMap = new Map();
  formatted.forEach((o) => {
    const empKey = o.employeeCode || 'UNKNOWN';
    if (!byEmployeeMap.has(empKey)) {
      byEmployeeMap.set(empKey, {
        employeeCode: empKey,
        employeeName: o.employeeName || empKey,
        totalBookings: 0,
        totalQuantity: 0,
        totalAmount: 0,
        pendingCount: 0,
        orders: [],
      });
    }
    const empGroup = byEmployeeMap.get(empKey);
    empGroup.totalBookings += 1;
    empGroup.totalQuantity += o.quantity;
    empGroup.totalAmount += o.totalAmount;
    if (o.status === 'pending') empGroup.pendingCount += 1;
    empGroup.orders.push(o);
  });

  const byEmployee = Array.from(byEmployeeMap.values()).sort((a, b) => b.totalAmount - a.totalAmount);

  res.json({
    items: formatted,
    byEmployee,
    summary: {
      totalBookings: formatted.length,
      totalAmount: formatted.reduce((s, o) => s + o.totalAmount, 0),
      pendingCount: formatted.filter((o) => o.status === 'pending').length,
      approvedCount: formatted.filter((o) => o.status === 'approved' || o.status === 'completed').length,
      rejectedCount: formatted.filter((o) => o.status === 'rejected').length,
    },
  });
}

export async function approveProductBooking(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Booking not found');
  const order = await ProductSaleOrder.findOne({ _id: req.params.id, ...branchFilter(req.user) });
  if (!order) throw new HttpError(404, 'Booking not found');
  if (order.status !== 'pending') throw new HttpError(409, `This booking is already ${order.status}`);

  order.status = 'approved';
  order.approvedByCode = req.user.employeeCode || req.user.username || '';
  order.approvedAt = new Date();
  await order.save();

  await audit(req, {
    action: 'productBooking.approve',
    entity: 'ProductSaleOrder',
    entityId: order._id,
    after: { receiptNo: order.receiptNo, member: order.memberCode, product: order.productCode, total: order.totalAmount },
  });

  res.json({ success: true, message: `Booking ${order.receiptNo} approved successfully!`, order });
}

export async function rejectProductBooking(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'Booking not found');
  const order = await ProductSaleOrder.findOne({ _id: req.params.id, ...branchFilter(req.user) });
  if (!order) throw new HttpError(404, 'Booking not found');
  if (order.status !== 'pending') throw new HttpError(409, `This booking is already ${order.status}`);

  const reason = asString(req.body?.reason).slice(0, 200);
  order.status = 'rejected';
  order.rejectReason = reason || 'Rejected by branch admin';
  await order.save();

  // Restore reserved product stock
  try {
    await StockProduct.updateOne(
      { code: order.productCode, branch: order.branch },
      { $inc: { stockQty: order.quantity || 1 } }
    );
  } catch (err) {
    console.warn('Failed to restore stock on reject:', err.message);
  }

  await audit(req, {
    action: 'productBooking.reject',
    entity: 'ProductSaleOrder',
    entityId: order._id,
    after: { receiptNo: order.receiptNo, member: order.memberCode, reason },
  });

  res.json({ success: true, message: `Booking ${order.receiptNo} rejected and stock restored.`, status: 'rejected' });
}
