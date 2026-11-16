/**
 * Loads the HR employees from "EMPLOYEE DATA TODAY.xlsx" (Sheet1: Code, Name, Department, Designation, Date Of Join, Phone, Action,
 * Branch Code, Branch Name). It REPLACES the HR employees (and their departments / designations) that importMasterData.mjs loaded
 * from the "employee detail" sheet, which carried other (E000xxx) codes.
 *
 *   node scripts/importEmployees.mjs "<EMPLOYEE DATA TODAY.xlsx>" --dry     read and check only
 *   node scripts/importEmployees.mjs "<EMPLOYEE DATA TODAY.xlsx>"           replace
 *   node scripts/importEmployees.mjs --remove                              remove what was loaded by this script / importMasterData
 *   options: --dns=8.8.8.8
 *
 *  - Action "block" = blocked in the old system, "unblock" = working.
 *  - Branch Code (1-8) is the code of the Branch sheet of all inserts data.xlsx; its name is read from the rows that have both.
 *  - Numeric dates were day/month swapped by Excel (every numeric date has a day <= 12) and are swapped back.
 *  - No app login is made for an employee (an admin does that under App Section -> Create app user).
 */
import 'dotenv/config';
import dns from 'dns';
import mongoose from 'mongoose';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const REMOVE = args.includes('--remove');
const dnsArg = args.find((a) => a.startsWith('--dns='));
if (dnsArg) dns.setServers(dnsArg.slice(6).split(','));
const file = args.find((a) => !a.startsWith('--'));
const FLAG = 'masterDataImport';

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const up = (s) => str(s).toUpperCase();
const title = (s) => str(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const oid = () => new mongoose.Types.ObjectId();
const DAY = 86400000;
const dateOf = (v) => {
  if (typeof v === 'number') { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * DAY); return d.getUTCDate() > 12 ? d : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCDate() - 1, d.getUTCMonth() + 1)); }
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str(v));
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null;
};
const stamp = () => { const d = new Date(); return { createdAt: d, updatedAt: d, legacyImport: true, [FLAG]: true }; };

await mongoose.connect(process.env.MONGODB_URI, { ignoreUndefined: true });
const db = mongoose.connection.db;
const col = (n) => db.collection(n);
console.log(`Database: ${db.databaseName}${DRY ? ' (dry run: nothing is written)' : ''}`);
try {
  if (REMOVE) {
    for (const c of ['employees', 'designations', 'departments']) console.log(`removed ${(await col(c).deleteMany({ [FLAG]: true })).deletedCount} from ${c}`);
  } else {
    if (!file) throw new Error('Give the path of the xlsx file');
    const wb = XLSX.readFile(file);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }).slice(1).filter((r) => str(r[0]));
    console.log(`employees in the file: ${rows.length}`);
    const codes = rows.map((r) => up(r[0]));
    if (new Set(codes).size !== codes.length) throw new Error('A code is repeated in the file');

    // branch code -> name, from the rows that have both; then the branch of the app
    const nameOfCode = new Map();
    rows.forEach((r) => { if (str(r[7]) && str(r[8])) nameOfCode.set(String(r[7]), up(r[8])); });
    const branches = await col('branches').find({ isDeleted: false }).project({ code: 1 }).toArray();
    const branchByName = new Map(branches.map((b) => [up(b.code), b._id]));
    const branchOf = (r) => { const n = nameOfCode.get(String(r[7])); return n ? branchByName.get(n) : undefined; };
    const noBranchName = [...new Set(rows.filter((r) => str(r[7]) && !nameOfCode.has(String(r[7]))).map((r) => r[7]))];
    const lost = [...nameOfCode.values()].filter((n) => !branchByName.has(n));
    if (noBranchName.length || lost.length) throw new Error(`Branch not found: codes ${noBranchName.join(',')} names ${lost.join(',')}`);

    // a code that already belongs to an employee that this script did not load
    const clash = await col('employees').find({ employeeCode: { $in: codes }, [FLAG]: { $ne: true }, isDeleted: { $ne: true } }).project({ employeeCode: 1 }).toArray();
    if (clash.length) throw new Error(`These codes already exist as other employees: ${clash.map((c) => c.employeeCode).join(', ')}`);

    // departments / designations: an existing one (not loaded by an import) is reused, the others are made
    const existing = async (c) => new Map((await col(c).find({ isDeleted: { $ne: true }, [FLAG]: { $ne: true } }).project({ name: 1 }).toArray()).map((d) => [str(d.name).toLowerCase(), d._id]));
    const deptId = await existing('departments'); const desigId = await existing('designations');
    const deptDocs = []; const desigDocs = []; const hr = [];
    for (const r of rows) {
      const dn = str(r[2]); const gn = str(r[3]);
      if (dn && !deptId.has(dn.toLowerCase())) { const id = oid(); deptId.set(dn.toLowerCase(), id); deptDocs.push({ _id: id, name: dn.toUpperCase() === dn ? title(dn) : dn, isActive: true, isDeleted: false, ...stamp() }); }
      if (gn && !desigId.has(gn.toLowerCase())) { const id = oid(); desigId.set(gn.toLowerCase(), id); desigDocs.push({ _id: id, name: gn, department: deptId.get(dn.toLowerCase()), isActive: true, isDeleted: false, ...stamp() }); }
      const blocked = str(r[6]).toLowerCase() === 'block';
      hr.push({
        _id: oid(), employeeCode: up(r[0]), name: str(r[1]), mobile: str(r[5]).replace(/\D/g, '').slice(-10), department: deptId.get(dn.toLowerCase()), designation: desigId.get(gn.toLowerCase()), branch: branchOf(r),
        joiningDate: dateOf(r[4]) || undefined, status: 'active', isActive: true, isDeleted: false,
        ...(blocked ? { isBlocked: true, blockReason: 'Blocked in the old system', blockedAt: new Date(), blockedByCode: 'LEGACY' } : {}), ...stamp(),
      });
    }
    console.log(`departments to make ${deptDocs.length}, designations to make ${desigDocs.length}, employees ${hr.length} (blocked ${hr.filter((e) => e.isBlocked).length}, with a branch ${hr.filter((e) => e.branch).length}, without a joining date ${hr.filter((e) => !e.joiningDate).length})`);
    if (DRY) {
      console.log('dry run: nothing written');
    } else {
      for (const c of ['employees', 'designations', 'departments']) console.log(`removed ${(await col(c).deleteMany({ [FLAG]: true })).deletedCount} earlier ${c}`);
      if (deptDocs.length) await col('departments').insertMany(deptDocs);
      if (desigDocs.length) await col('designations').insertMany(desigDocs);
      await col('employees').insertMany(hr);
      console.log(`written: ${deptDocs.length} departments, ${desigDocs.length} designations, ${hr.length} employees`);
    }
  }
} catch (err) {
  console.error('Failed:', err.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
