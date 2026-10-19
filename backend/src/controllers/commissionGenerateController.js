import mongoose from 'mongoose';
import { Commission } from '../models/Commission.js';
import { EmployeeCommission } from '../models/EmployeeCommission.js';
import { GroupLeaderCommission } from '../models/GroupLeaderCommission.js';
import { generateEmployeeCommission, financialYearOf } from '../services/employeeCommission.js';
import { syncAllGroups } from '../services/groupLeaderPayout.js';
import { parseMonth } from '../services/groupLeaderCommission.js';
import { typeMeta } from '../config/commissionTypes.js';
import { branchFilter } from './groupController.js';
import { asString, escapeRegex, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';

const currentMonth = () => new Date().toISOString().slice(0, 7);

function readMonth(raw) {
  const month = asString(raw) || currentMonth();
  if (parseMonth(month) === null) throw new HttpError(422, 'Choose a valid month', { month: 'Choose a valid month' });
  if (month > currentMonth()) throw new HttpError(422, 'Commission cannot be generated for a future month', { month: 'Choose this month or an earlier month' });
  return month;
}

const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);

/** What has been generated for a month, for the Commission Generate screen. */
export async function overview(req, res) {
  const month = readMonth(req.query.month);
  const fy = await financialYearOf(month);
  const [leaderRule, employeeRules, leader, employee] = await Promise.all([
    fy ? Commission.countDocuments({ commissionFor: 'group_leader', isDeleted: false, isActive: true, financialYear: fy._id }) : 0,
    fy ? Commission.countDocuments({ commissionFor: { $nin: ['group_leader', 'employee'] }, isDeleted: false, isActive: true, financialYear: fy._id }) : 0,
    GroupLeaderCommission.find({ month, ...branchFilter(req.user) }).select('amountPaise status loans'),
    EmployeeCommission.find({ month }).select('amountPaise employeeCode'),
  ]);
  res.json({
    month,
    financialYear: fy ? { id: fy._id, name: fy.name } : null,
    groupLeader: {
      hasRule: leaderRule > 0,
      groups: leader.length,
      loans: sum(leader, (e) => e.loans),
      amount: sum(leader, (e) => e.amountPaise) / 100,
      pendingAmount: sum(leader.filter((e) => e.status === 'pending'), (e) => e.amountPaise) / 100,
      depositedAmount: sum(leader.filter((e) => e.status === 'deposited'), (e) => e.amountPaise) / 100,
    },
    employee: { hasRule: employeeRules > 0, employees: new Set(employee.map((e) => e.employeeCode)).size, entries: employee.length, amount: sum(employee, (e) => e.amountPaise) / 100 },
  });
}

/** Generates the group leader and/or the employee commission. `kind`: group_leader, employee or both. */
export async function run(req, res) {
  const month = readMonth(req.body?.month);
  const kind = asString(req.body?.kind) || 'both';
  if (!['group_leader', 'employee', 'both'].includes(kind)) throw new HttpError(422, 'Choose what to generate', { kind: 'Choose what to generate' });
  const out = { month, kind };
  if (kind !== 'employee') {
    out.groupLeader = await syncAllGroups(branchFilter(req.user));
    await audit(req, { action: 'commission.generate.groupLeader', entity: 'GroupLeaderCommission', entityId: month, after: out.groupLeader });
  }
  if (kind !== 'group_leader') {
    const e = await generateEmployeeCommission(month, req.user._id);
    out.employee = { ...e, total: e.totalPaise / 100 };
    await audit(req, { action: 'commission.generate.employee', entity: 'EmployeeCommission', entityId: month, after: { entries: e.entries, total: e.totalPaise / 100, rules: e.rules } });
  }
  res.json(out);
}

const present = (e) => {
  const unit = e.unit === 'amount' ? 'amount' : e.unit;
  return {
    id: e._id,
    employeeCode: e.employeeCode,
    employeeName: e.employeeName,
    commissionFor: e.commissionFor,
    commissionLabel: typeMeta(e.commissionFor)?.label || e.commissionFor,
    scope: e.scope,
    frequency: e.frequency,
    periodLabel: e.periodLabel,
    unit,
    measure: unit === 'amount' ? e.measure / 100 : e.measure,
    count: e.count,
    amount: e.amountPaise / 100,
    capped: e.capped,
  };
};

/** The employee commission generated for a month, with the total of each employee. */
export async function employeeList(req, res) {
  const month = readMonth(req.query.month);
  const filter = { month };
  if (mongoose.isValidObjectId(req.query.branch)) filter.branches = req.query.branch;
  const q = asString(req.query.q);
  if (q) filter.$or = [{ employeeCode: new RegExp(escapeRegex(q), 'i') }, { employeeName: new RegExp(escapeRegex(q), 'i') }];
  const entries = await EmployeeCommission.find(filter).sort({ employeeCode: 1, commissionFor: 1, periodFrom: 1 });
  const byEmployee = new Map();
  for (const e of entries) {
    if (!byEmployee.has(e.employeeCode)) byEmployee.set(e.employeeCode, { employeeCode: e.employeeCode, employeeName: e.employeeName, total: 0, items: [] });
    const g = byEmployee.get(e.employeeCode);
    g.items.push(present(e));
    g.total += e.amountPaise / 100;
  }
  res.json({ month, employees: [...byEmployee.values()], total: sum(entries, (e) => e.amountPaise) / 100 });
}
