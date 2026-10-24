import { Employee } from '../models/Hr.js';
import { User } from '../models/User.js';

const MOBILE_RE = /^[6-9]\d{9}$/;
let running = null;

/**
 * Makes an HR record (Employee) of every staff login that has none: name, mobile and branch are taken over, the employee code is the staff ID.
 * Without it the HR sections (employee list, attendance, leave, salary ...) would stay empty for the staff that existed before the HR module.
 * Safe to run again: it only adds what is missing. Returns how many were made.
 */
export async function syncEmployeesFromUsers() {
  const linked = new Set((await Employee.find({ isDeleted: false, user: { $exists: true } }).select('user').lean()).map((e) => String(e.user)));
  const codes = new Set((await Employee.find({ isDeleted: false }).select('employeeCode').lean()).map((e) => e.employeeCode));
  const users = await User.find({ employeeCode: { $exists: true, $ne: '' } }).select('name employeeCode mobile branches isActive').lean();
  let made = 0;
  for (const u of users) {
    if (linked.has(String(u._id)) || codes.has(u.employeeCode)) continue;
    // eslint-disable-next-line no-await-in-loop
    await Employee.create({ employeeCode: u.employeeCode, user: u._id, name: u.name, mobile: MOBILE_RE.test(u.mobile || '') ? u.mobile : undefined, branch: (u.branches || [])[0], status: u.isActive === false ? 'left' : 'active', createdByCode: 'AUTO' });
    made += 1;
  }
  return made;
}

/** A cheap check first (two counts): the sync runs only when a staff login has no HR record yet. */
export async function ensureEmployees() {
  if (running) return running;
  running = (async () => {
    try {
      const [users, linked] = await Promise.all([User.countDocuments({ employeeCode: { $exists: true, $ne: '' } }), Employee.countDocuments({ isDeleted: false, user: { $exists: true } })]);
      return linked >= users ? 0 : await syncEmployeesFromUsers();
    } catch (err) {
      console.error('employee sync failed', err.message);
      return 0;
    } finally {
      running = null;
    }
  })();
  return running;
}
