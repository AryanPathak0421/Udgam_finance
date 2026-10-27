import { Employee } from '../models/Hr.js';

/**
 * The staff IDs of the employees that were blocked in HR. A blocked employee must not be offered (or accepted) anywhere an employee is chosen:
 * requisitions, members, groups, group transfer. (The staff brought over from the old system are kept in those lists even without a login,
 * so "login stopped" alone cannot tell a blocked employee from one that is just old.)
 */
export const blockedCodes = async () => (await Employee.distinct('employeeCode', { isBlocked: true, isDeleted: false })).filter(Boolean);
