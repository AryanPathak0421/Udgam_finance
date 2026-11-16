/**
 * Loads "all inserts data.xlsx" (branches, members, groups, loans, settlements, security, group leader commission, employees,
 * death settlements) together with the monthly "EMI Collection Report" .xls sheets (Dec 2025 - Nov 2026) into the app.
 * It REPLACES what importCollectionSheets.mjs wrote earlier (those loans were estimates; these are the real ones).
 *
 *   node scripts/importMasterData.mjs "<all inserts data.xlsx>" "<folder with the monthly .xls>" --dry   read, build, reconcile; nothing is written
 *   node scripts/importMasterData.mjs "<all inserts data.xlsx>" "<folder with the monthly .xls>"         write
 *   node scripts/importMasterData.mjs --remove                                                          remove what this script wrote
 *   options: --dns=8.8.8.8 (resolve mongodb+srv with another DNS server), --force
 *
 * Facts found in the workbook that this script relies on (checked against the data):
 *  - Excel turned the dd/mm/yyyy dates that it could read as mm/dd into serial NUMBERS with day and month swapped (every numeric date
 *    has a day <= 12, every text date has a day > 12). A numeric date is therefore swapped back; a text date is read as dd/mm/yyyy.
 *  - A loan's term and interest are those of its "Table" = the loan scheme of the same name (the existing schemes DLY01 ... are used).
 *  - The collections of the monthly sheets are allocated from installment 1 of the loan; collected + settlement = the loan's payable
 *    amount for 2448 of the 2587 settled loans, so nothing before December 2025 is assumed for them.
 *  - For the loans that are not settled, installments due before 1 Dec 2025 that no collection covers are taken as collected in the old
 *    system (a "legacy opening" EMI record, left out of the Cashbook).
 * Every record carries `legacyImport: true` and `masterDataImport: true`.
 */
import 'dotenv/config';
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { createRequire } from 'module';
import { calculateLoan, MODES } from '../src/services/loanCalculator.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const REMOVE = args.includes('--remove');
const FORCE = args.includes('--force');
const dnsArg = args.find((a) => a.startsWith('--dns='));
if (dnsArg) dns.setServers(dnsArg.slice(6).split(','));
const [bookPath, sheetsDir] = args.filter((a) => !a.startsWith('--'));
const FLAG = 'masterDataImport';
const OLD_FLAG = 'collectionSheetImport';
const OPENING_CUTOFF = new Date('2025-12-01T00:00:00.000Z');
const MONTHS = ['DECEMBER 2025', 'JANUARY 2026', 'FEBUARY 2026', 'MARCH 2026', 'APRIL 2026', 'MAY 2026', 'JUNE 2026', 'JULY 2026', 'AUGUST 2026', 'SEPTEMBER 2026', 'OCTUBER 2026', 'NOVEMBER 2026'];
const OWN = ['branches', 'users', 'groups', 'members', 'loanrequisitions', 'loanpayments', 'emipayments', 'loansettlements', 'securitywithdrawals', 'groupleadercommissions', 'employees', 'departments', 'designations'];

// ---- helpers ----------------------------------------------------------------------------------------------------------------------
const DAY = 86400000;
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const up = (s) => str(s).toUpperCase();
const norm = (s) => up(s).replace(/[^A-Z0-9]+/g, '');
const title = (s) => str(s).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const num = (x) => (typeof x === 'number' ? x : Number(String(x || '0').replace(/,/g, '')) || 0);
const paise = (x) => Math.round(num(x) * 100);
const oid = () => new mongoose.Types.ObjectId();
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
const textDate = (s) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str(s)); return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null; };
const serial = (n) => new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * DAY);
// numeric dates were day/month swapped by Excel (a numeric date with a day over 12 was typed as a real date and is left as it is)
const dateOf = (v) => {
  if (typeof v === 'number') { const d = serial(v); return d.getUTCDate() > 12 ? d : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCDate() - 1, d.getUTCMonth() + 1)); }
  return textDate(v);
};
const modal = (items) => { const c = new Map(); items.forEach((x) => c.set(x, (c.get(x) || 0) + 1)); return [...c.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0]; };
const stamp = (d = new Date()) => ({ createdAt: d, updatedAt: d, legacyImport: true, [FLAG]: true });
const DAYS = { MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6, SUNDAY: 7 };
const sheetRows = (wb, name) => {
  const key = wb.SheetNames.find((n) => n.trim().toLowerCase() === name);
  if (!key) throw new Error(`The workbook has no sheet "${name}"`);
  return XLSX.utils.sheet_to_json(wb.Sheets[key], { header: 1, raw: true, defval: '' });
};

// ---- the monthly collection sheets ---------------------------------------------------------------------------------------------------
function readCollections() {
  const rows = []; const totals = new Map();
  for (const m of MONTHS) {
    const file = path.join(sheetsDir, `${m}.xls`);
    if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
    const wb = XLSX.readFile(file);
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
    let branch = '';
    for (let i = 0; i < grid.length; i += 1) {
      const r = grid[i];
      if (r[4] === 'Loan ID') continue;
      if (r[2] && r[2] !== 'Branch Wise') branch = up(r[2]);
      if (String(r[10]).startsWith('Total')) { totals.set(`${m}|${branch}`, paise(r[11])); continue; }
      if (!r[4]) continue;
      const date = textDate(r[8]);
      if (!date) throw new Error(`${m}: row ${i + 1} has no valid date (${r[8]})`);
      if (!(num(r[11]) > 0)) throw new Error(`${m}: row ${i + 1} has no amount`);
      rows.push({ month: m, seq: rows.length, branch, loan: up(r[4]), member: up(r[6]), name: str(r[7]), date, pay: paise(r[11]), collector: up(r[16]) });
    }
  }
  return { rows, totals };
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(process.env.MONGODB_URI, { ignoreUndefined: true });
  const db = mongoose.connection.db;
  const col = (n) => db.collection(n);
  console.log(`Database: ${db.databaseName}${DRY ? ' (dry run: nothing is written)' : ''}`);
  if (REMOVE) {
    for (const c of OWN) console.log(`removed ${(await col(c).deleteMany({ [FLAG]: true })).deletedCount} from ${c}`);
    await mongoose.disconnect();
    return;
  }
  if (!bookPath || !sheetsDir) throw new Error('Give the workbook and the folder of the monthly .xls files');
  const foreign = {};
  for (const c of ['branches', 'members', 'loanpayments', 'emipayments', 'groups']) foreign[c] = await col(c).countDocuments({ [FLAG]: { $ne: true }, [OLD_FLAG]: { $ne: true } });
  if (Object.values(foreign).some(Boolean) && !FORCE) throw new Error(`The database already holds other data (${JSON.stringify(foreign)}). Nothing was changed. Use --force only if that is intended.`);

  const wb = XLSX.readFile(bookPath);
  const S = {
    branches: sheetRows(wb, 'branchs').slice(1), members: sheetRows(wb, 'member detail').slice(1), groups: sheetRows(wb, 'group detail').slice(1),
    loans: sheetRows(wb, 'disburcement report').slice(1).filter((r) => str(r[0])), sets: sheetRows(wb, 'settalment report').slice(1).filter((r) => str(r[0])),
    sec: sheetRows(wb, 'security').slice(2), comm: sheetRows(wb, 'group leader comission').slice(1).filter((r) => str(r[10])), emps: sheetRows(wb, 'employee detail').slice(1).filter((r) => str(r[0])),
    deaths: sheetRows(wb, 'death settalment').slice(1).filter((r) => str(r[0])),
  };
  console.log(`workbook rows: branches ${S.branches.filter((r) => str(r[1])).length}, members ${S.members.length}, groups ${S.groups.length}, loans ${S.loans.length}, settlements ${S.sets.length}, security ${S.sec.length}, commission ${S.comm.length}, employees ${S.emps.length}, death settlements ${S.deaths.length}`);
  const { rows: coll, totals } = readCollections();
  console.log(`collection rows: ${coll.length}`);
  const report = { skipped: {}, notes: [] };
  const skip = (k, n = 1) => { report.skipped[k] = (report.skipped[k] || 0) + n; };

  // ---- branches
  const branchSheet = new Map(S.branches.filter((r) => str(r[1])).map((r) => [up(r[1]), r]));
  const branchNames = new Set(branchSheet.keys());
  const firstDate = new Map();
  const seenAt = (b, d) => { if (b && d && (!firstDate.get(b) || d < firstDate.get(b))) firstDate.set(b, d); };
  S.members.forEach((r) => { const b = up(r[1]); if (b) { branchNames.add(b); seenAt(b, dateOf(r[4])); } });
  S.loans.forEach((r) => { const b = up(r[17]); if (b) { branchNames.add(b); seenAt(b, textDate(r[6])); } });
  S.groups.forEach((r) => { const b = up(r[5]); if (b) branchNames.add(b); });
  S.emps.forEach((r) => { const b = up(r[8]); if (b) branchNames.add(b); });
  coll.forEach((r) => { if (r.branch) { branchNames.add(r.branch); seenAt(r.branch, r.date); } });
  const branchId = new Map(); const branchDocs = [];
  for (const name of [...branchNames].sort()) {
    const id = oid(); branchId.set(name, id);
    const bs = branchSheet.get(name);
    branchDocs.push({
      _id: id, code: name, name: title(name), address: str(bs?.[3]) || `${title(name)}, Bihar`, state: str(bs?.[8]) ? title(bs[8]) : 'Bihar', city: str(bs?.[7]) ? title(bs[7]) : title(name),
      openingDate: firstDate.get(name) || (bs && dateOf(bs[2])) || new Date('2025-01-01T00:00:00.000Z'), isActive: true, isDeleted: false,
      ...(bs ? { managerName: str(bs[4]), prefix: str(bs[5]), phone: str(bs[6]) } : {}), ...stamp(),
    });
  }
  const bid = (n) => branchId.get(up(n));
  const branchOf = (n) => bid(n);

  // ---- collectors (staff logins, switched off) and the name <-> code map
  const empByName = new Map(); const empName = new Map();
  S.members.forEach((r) => { const m = /^(.*)-([A-Za-z0-9]+)$/.exec(str(r[13])); if (m && m[1].trim()) { empName.set(up(m[2]), str(m[1])); if (!empByName.has(up(m[1]))) empByName.set(up(m[1]), up(m[2])); } });
  const collectorBranches = new Map();
  coll.forEach((r) => { if (r.collector) { if (!collectorBranches.has(r.collector)) collectorBranches.set(r.collector, []); collectorBranches.get(r.collector).push(r.branch); } });
  S.members.forEach((r) => { const m = /-([A-Za-z0-9]+)$/.exec(str(r[13])); const c = m && up(m[1]); if (c) { if (!collectorBranches.has(c)) collectorBranches.set(c, []); collectorBranches.get(c).push(up(r[1])); } });
  const existingUsers = new Set((await col('users').find({ [OLD_FLAG]: { $ne: true }, [FLAG]: { $ne: true } }).project({ employeeCode: 1, email: 1 }).toArray()).flatMap((u) => [u.employeeCode, u.email]));
  const userDocs = [];
  for (const [code, bs] of collectorBranches) {
    const email = `${code.toLowerCase()}@legacy.udgam.invalid`;
    if (existingUsers.has(code) || existingUsers.has(email)) continue;
    userDocs.push({ _id: oid(), name: empName.get(code) || code, email, employeeCode: code, role: 'collection_officer', branches: [branchId.get(modal(bs.filter(Boolean)))].filter(Boolean), password: await bcrypt.hash(crypto.randomBytes(18).toString('hex'), 10), isActive: false, failedAttempts: 0, ...stamp() });
  }

  // ---- HR employees (the "employee detail" sheet)
  const deptId = new Map(); const desigId = new Map(); const deptDocs = []; const desigDocs = []; const hrDocs = [];
  for (const r of S.emps) {
    const dn = str(r[2]); const gn = str(r[3]);
    if (dn && !deptId.has(dn.toLowerCase())) { const id = oid(); deptId.set(dn.toLowerCase(), id); deptDocs.push({ _id: id, name: dn.toUpperCase() === dn ? title(dn) : dn, isActive: true, isDeleted: false, ...stamp() }); }
    if (gn && !desigId.has(gn.toLowerCase())) { const id = oid(); desigId.set(gn.toLowerCase(), id); desigDocs.push({ _id: id, name: gn, department: deptId.get(dn.toLowerCase()), isActive: true, isDeleted: false, ...stamp() }); }
    hrDocs.push({ _id: oid(), employeeCode: up(r[0]), name: str(r[1]), mobile: str(r[5]).replace(/\D/g, '').slice(-10), department: deptId.get(dn.toLowerCase()), designation: desigId.get(gn.toLowerCase()), branch: branchOf(r[8]), joiningDate: dateOf(r[4]) || undefined, isActive: str(r[6]).toLowerCase() !== 'inactive', isDeleted: false,
      // the sheet's Action column is 'block' for an employee blocked in the old system and 'unblock' for one that works
      ...(str(r[6]).toLowerCase() === 'block' ? { isBlocked: true, blockReason: 'Blocked in the old system', blockedAt: new Date(), blockedByCode: 'LEGACY' } : {}), ...stamp() });
  }

  // ---- groups
  const loanModes = new Map();
  const TABLES = [
    { test: /PRODUCT/i, mode: 'daily', term: 120, ratio: 0.32, type: 'product' },
    { test: /PERSONAL.*WLY/i, mode: 'weekly', term: 30, ratio: 0.2, type: 'personal' },
    { test: /PERSONAL.*DLY/i, mode: 'daily', term: 120, ratio: 0.2, type: 'personal' },
    { test: /40K TO ?100K.*WLY/i, mode: 'weekly', term: 50, ratio: 0.3, type: 'group' },
    { test: /31K TO 39K.*WLY/i, mode: 'weekly', term: 50, ratio: 0.3, type: 'group' },
    { test: /WLY/i, mode: 'weekly', term: 30, ratio: 0.2, type: 'group' },
    { test: /DLY/i, mode: 'daily', term: 120, ratio: 0.2, type: 'group' },
  ];
  const tableOf = (name) => TABLES.find((t) => t.test.test(name || '')) || { mode: 'daily', term: 120, ratio: 0.2, type: 'group' };
  S.loans.forEach((r) => { const g = up(r[18]); if (g && g !== '--') { if (!loanModes.has(g)) loanModes.set(g, new Set()); loanModes.get(g).add(tableOf(str(r[5])).mode); } });
  const groupDocs = new Map(); const takenNames = new Set();
  const addGroup = (code, name, b, extra = {}) => {
    code = up(code);
    if (!code || groupDocs.has(code)) return groupDocs.get(code);
    let nm = str(name) || code;
    if (takenNames.has(`${b}|${nm.toLowerCase()}`)) nm = `${nm} (${code})`;
    takenNames.add(`${b}|${nm.toLowerCase()}`);
    const modes = loanModes.get(code);
    const doc = { _id: oid(), code, name: nm, branch: b, leaderName: 'Not recorded', leaderMobile: '', members: [], isActive: true, isDeleted: false, meetingType: extra.meetingType || (modes?.size === 1 ? [...modes][0] : undefined), ...extra.rest, ...stamp() };
    groupDocs.set(code, doc);
    return doc;
  };
  for (const r of S.groups) {
    const b = branchOf(r[5]);
    if (!b) { skip('groups without a branch'); continue; }
    const type = /^w/i.test(str(r[8])) ? 'weekly' : /^d/i.test(str(r[8])) ? 'daily' : undefined;
    const t = num(r[7]);
    const hhmm = r[7] !== '' ? `${String(Math.floor((t % 1) * 24)).padStart(2, '0')}:${String(Math.floor((((t % 1) * 24) % 1) * 60)).padStart(2, '0')}` : undefined;
    const rest = { openingDate: dateOf(r[3]) || undefined, employeeCode: empByName.get(up(r[4])) || '', meetingTime: hhmm };
    if (type === 'weekly' && DAYS[up(r[6])]) rest.collectionDay = DAYS[up(r[6])];
    addGroup(r[1], r[2], b, { meetingType: type, rest });
  }

  // ---- members
  const memberDocs = []; const memberByCode = new Map(); const seenAadhaar = new Set(); const seenPan = new Set(); let noAadhaar = 0; let badPan = 0; let mobiles = 0;
  for (const r of S.members) {
    const code = up(r[2]); const b = branchOf(r[1]);
    if (!code || !b) { skip('members without id or branch'); continue; }
    if (memberByCode.has(code)) { skip('members with a repeated id'); continue; }
    const aadhaar = str(r[11]).replace(/\D/g, '');
    if (aadhaar.length !== 12) noAadhaar += 1;
    const aadhaarOk = aadhaar.length === 12 && !seenAadhaar.has(aadhaar);
    const dupAadhaar = aadhaar.length === 12 && seenAadhaar.has(aadhaar);
    if (dupAadhaar) skip('members whose Aadhaar number is already on another member (kept as legacyAadhaar only)');
    if (aadhaarOk) seenAadhaar.add(aadhaar);
    let pan = up(r[10]);
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) { if (pan) badPan += 1; pan = ''; }
    const panRaw = pan; const panDup = Boolean(pan && seenPan.has(pan)); if (panDup) { skip('members whose PAN is already on another member (kept as legacyPan only)'); pan = ''; } if (pan) seenPan.add(pan);
    const pin = [...str(r[9]).matchAll(/\b(\d{6})\b/g)].map((m) => m[1]).pop() || '';
    const mobile = str(r[12]).replace(/\D/g, '').slice(-10);
    const okMobile = /^[6-9]\d{9}$/.test(mobile); if (okMobile) mobiles += 1;
    const ec = /-([A-Za-z0-9]+)$/.exec(str(r[13])); const empCode = ec ? up(ec[1]) : '';
    const joined = dateOf(r[4]) || new Date('2025-01-01T00:00:00.000Z');
    const doc = {
      _id: oid(), code, formId: code, branch: b, joiningDate: joined, name: str(r[3]), dob: dateOf(r[7]) || new Date('1990-01-01T00:00:00.000Z'),
      gender: /^f/i.test(str(r[5])) ? 'female' : /^m/i.test(str(r[5])) ? 'male' : 'other', ...(okMobile ? { mobile } : { mobile: '' }), occupation: '', education: '', address: str(r[9]), pincode: pin, state: 'Bihar', district: '',
      ...(str(r[8]) ? { husbandName: str(r[8]) } : {}), ...(aadhaarOk ? { aadhaar } : {}), ...(dupAadhaar ? { legacyAadhaar: aadhaar } : {}), ...(pan ? { pan } : {}), ...(panDup ? { legacyPan: panRaw } : {}), bankName: '', ifsc: '', accountNumber: '',
      employeeCode: empCode || undefined, kycKeys: [], kycDocs: [], guarantorHistory: [], blockHistory: [], isBlocked: false, isActive: true, isDeleted: false, ...stamp(joined),
    };
    const gm = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(str(r[14]));
    if (gm) {
      const gcodes = gm[2].split(',').map((s) => s.trim().toUpperCase()).filter(Boolean); const gnames = gm[1].split(',').map((s) => s.trim()).filter(Boolean);
      gcodes.forEach((c, idx) => { const g = addGroup(c, gnames[idx] || gnames[0] || c, b); if (g && !g.members.some((x) => String(x.member) === String(doc._id))) g.members.push({ member: doc._id, addedAt: joined }); });
    }
    memberByCode.set(code, doc); memberDocs.push(doc);
  }

  // ---- loan schemes: the loan's "Table" is a scheme of the app of the same name
  const schemes = await col('loanschemes').find({ isDeleted: false, [OLD_FLAG]: { $ne: true } }).toArray();
  const schemeByName = new Map(schemes.map((s) => [norm(s.name), s]));
  const ALIAS = { '40KTO100KPERSONALLOANWLY': 'PRSNL04', '20KTO30KPERSONALLOANWLY': 'PRSNL02', '50KTO100KPERSONALLOANDLY': 'PRSNLDLY03' };
  const schemeFor = (tname) => {
    const n = norm(tname);
    return schemeByName.get(n) || (ALIAS[n] && schemes.find((s) => s.code === ALIAS[n])) || null;
  };
  const tableNames = [...new Set(S.loans.map((r) => str(r[5])))].filter(Boolean);
  const unmapped = tableNames.filter((t) => !schemeFor(t));
  console.log(`tables: ${tableNames.length}, matched to a scheme of the app: ${tableNames.length - unmapped.length}${unmapped.length ? `; NOT matched: ${unmapped.join(' | ')}` : ''}`);
  if (unmapped.length) throw new Error('A loan table has no scheme in the app; nothing is written.');

  // ---- security
  const secByLoan = new Map(); const secByMember = new Map(); const withdrawals = [];
  for (const r of S.sec) {
    const mid = up(r[2]); const amt = paise(r[6]); if (!amt) continue;
    if (/^w/i.test(str(r[5]))) { withdrawals.push({ mid, amt, on: textDate(r[4]) }); continue; }
    const lid = up(r[1]);
    if (lid) secByLoan.set(lid, (secByLoan.get(lid) || 0) + amt); else secByMember.set(mid, (secByMember.get(mid) || 0) + amt);
  }

  // ---- a member that has loans and collections but is not in the member sheet: made from the collection sheets (code, name, branch only)
  const collMember = new Map();
  coll.forEach((c) => { if (!collMember.has(c.member)) collMember.set(c.member, []); collMember.get(c.member).push(c); });
  let madeFromSheets = 0;
  for (const r of S.loans) {
    const code = up(r[2]);
    if (!code || memberByCode.has(code) || !collMember.has(code)) continue;
    const cs = collMember.get(code); const bb = branchOf(modal(cs.map((c) => c.branch))); const joined = cs.reduce((d, c) => (c.date < d ? c.date : d), cs[0].date);
    const doc = { _id: oid(), code, formId: code, branch: bb, joiningDate: joined, name: cs[cs.length - 1].name, dob: new Date('1990-01-01T00:00:00.000Z'), gender: 'other', mobile: '', occupation: '', education: '', address: '', pincode: '', state: 'Bihar', district: '', bankName: '', ifsc: '', accountNumber: '', kycKeys: [], kycDocs: [], guarantorHistory: [], blockHistory: [], isBlocked: false, isActive: true, isDeleted: false, fromCollectionSheetOnly: true, ...stamp(joined) };
    memberByCode.set(code, doc); memberDocs.push(doc); madeFromSheets += 1;
  }
  if (madeFromSheets) report.notes.push(`${madeFromSheets} member(s) are not in the member sheet; made from the collection sheets`);

  // ---- loans
  const loanRows = []; const seenLoan = new Set();
  for (const r of S.loans) {
    const lid = up(r[0]); if (seenLoan.has(lid)) { skip('loans with a repeated Loan ID (the second one)'); continue; }
    const m = memberByCode.get(up(r[2]));
    if (!m) { skip('loans of a member that is not in the member sheet'); continue; }
    seenLoan.add(lid); loanRows.push({ r, lid, m });
  }
  const latestOf = new Map();
  loanRows.forEach(({ r, lid, m }) => { const d = textDate(r[6]); const cur = latestOf.get(m.code); if (!cur || (d && d > cur.d)) latestOf.set(m.code, { lid, d }); });
  const reqDocs = []; const payDocs = []; const loanInfo = new Map(); let receiptSeq = 0;
  for (const { r, lid, m } of loanRows) {
    const tname = str(r[5]); const sc = schemeFor(tname); const t = tableOf(tname);
    const mode = sc.modes?.[0] || t.mode; const term = sc.termMin || t.term; const rBp = sc.roiMinBp;
    const amountPaise = paise(r[7]); const loanDate = textDate(r[6]) || textDate(r[15]); const paidOn = textDate(r[15]) || loanDate;
    if (!amountPaise || !loanDate) { skip('loans without an amount or a date'); continue; }
    let calc;
    try { calc = calculateLoan({ principalPaise: amountPaise, annualRateBp: rBp, calculationType: 'flat', emiType: 'equal', mode, term, startDate: paidOn, roundingPaise: 100 }); } catch { skip('loans too small for the installments of their table'); continue; }
    const schedule = calc.schedule.map((s) => ({ no: s.no, dueDate: s.dueDate, installmentPaise: s.installment, principalPaise: s.principal, interestPaise: s.interest }));
    const gcode = up(r[18]); const gdoc = gcode && gcode !== '--' ? groupDocs.get(gcode) : null;
    const isGroup = Boolean(gdoc) || sc.loanType === 'group' || sc.loanType === 'product' || lid.startsWith('UDGRP');
    const b = branchOf(r[17]) || m.branch;
    const proc = paise(r[9]) + paise(r[12]); const legal = paise(r[10]); const ins = paise(r[13]);
    const security = (secByLoan.get(lid) || 0) + (latestOf.get(m.code)?.lid === lid ? secByMember.get(m.code) || 0 : 0);
    const net = r[14] !== '' ? paise(r[14]) : amountPaise - proc - legal - ins;
    const empCode = gdoc?.employeeCode || m.employeeCode || 'LEGACY';
    const reqId = oid();
    const payMode = ['cash', 'bank', 'upi', 'cheque'].includes(str(r[16]).toLowerCase()) ? str(r[16]).toLowerCase() : 'cash';
    receiptSeq += 1;
    reqDocs.push({
      _id: reqId, kind: isGroup ? 'group' : 'personal', formId: lid, branch: b, loanDate,
      ...(isGroup
        ? { ...(gdoc ? { group: gdoc._id } : {}), groupInfo: { code: gdoc?.code || '', name: gdoc?.name || str(r[19]), leaderName: '', employeeCode: gdoc?.employeeCode || '', meetingType: gdoc?.meetingType || mode, members: [{ code: m.code, name: m.name }] }, members: [m._id], memberCount: 1, totalAmountPaise: amountPaise }
        : { member: m._id, borrower: { code: m.code, name: m.name, dob: m.dob, gender: m.gender, address: m.address, pincode: m.pincode, district: '', state: 'Bihar', mobile: m.mobile || '', guarantorName: '' } }),
      previousLoanPaise: 0, scheme: sc._id, schemeCode: sc.code, schemeName: sc.name, amountPaise, mode, term, annualRateBp: rBp, installmentPaise: calc.installmentAmount, calculationType: 'flat', emiType: 'equal',
      totalInterestPaise: calc.totalInterest, totalPayablePaise: calc.totalPayable, processingFeePaise: proc, legalFeePaise: legal, insuranceFeePaise: ins, securityAmountPaise: security, cashPaise: net, securityType: 'none',
      employeeCode: empCode, decidedAt: loanDate, decidedByCode: 'LEGACY', disbursedAt: paidOn, status: 'approved', memberForms: [], additionalProducts: [], isDeleted: false, ...stamp(loanDate),
    });
    const pay = {
      _id: oid(), receiptNo: `LEGRCP-${String(receiptSeq).padStart(6, '0')}`, loanId: lid, requisition: reqId, formId: lid, kind: isGroup ? 'group' : 'personal', branch: b,
      ...(gdoc ? { group: { code: gdoc.code, name: gdoc.name } } : {}), paidOn, emiStartDate: calc.firstDueDate, emiEndDate: calc.lastDueDate, installments: term,
      modeLabel: MODES[mode].label, mode, loanType: isGroup ? 'group' : 'personal', schemeName: sc.name, annualRateBp: rBp, installmentPaise: calc.installmentAmount, payMode, reference: 'Old system', schedule,
      lines: [{ member: m._id, code: m.code, name: m.name, amountPaise, processingFeePaise: proc, legalFeePaise: legal, insuranceFeePaise: ins, securityPaise: security, productPaise: 0, products: [], cashPaise: net, extraEmiPaise: 0 }],
      totalAmountPaise: amountPaise, totalCashPaise: net, status: 'paid', employeeCode: empCode, createdByCode: 'LEGACY', ...stamp(paidOn),
    };
    payDocs.push(pay);
    loanInfo.set(lid, { pay, m, schedule, branch: b, group: gdoc ? `${gdoc.code} — ${gdoc.name}` : '', empCode, payable: calc.totalPayable });
  }

  // ---- settlements (the dates were swapped back); several rows of one loan are one settlement
  const setDocs = []; const settled = new Set(); let setSeq = 0;
  const deathLoans = new Set(S.deaths.map((r) => up(r[0])));
  for (const r of S.deaths) {
    const lid = up(r[0]); const info = loanInfo.get(lid);
    if (!info) { skip('death settlements of a loan that is not in the loan sheet'); continue; }
    if (settled.has(lid)) continue;
    settled.add(lid); setSeq += 1;
    const on = textDate(r[4]) || textDate(r[3]); const due = paise(r[5]) + paise(r[6]);
    setDocs.push({ _id: oid(), kind: 'death', receiptNo: `LEGSTL-${String(setSeq).padStart(6, '0')}`, loanPayment: info.pay._id, loanId: lid, formId: lid, branch: info.branch, member: info.m._id, memberCode: info.m.code, memberName: info.m.name, group: info.group, outstandingPaise: due, amountPaise: 0, waiverPaise: due, settledOn: on, deathDate: textDate(r[3]) || on, remark: 'Death settlement in the old system', status: 'active', ...stamp(on) });
  }
  const setByLoan = new Map();
  for (const r of S.sets) { const lid = up(r[0]); if (!setByLoan.has(lid)) setByLoan.set(lid, []); setByLoan.get(lid).push(r); }
  for (const [lid, rs] of setByLoan) {
    const info = loanInfo.get(lid);
    if (!info) { skip('settlements of a loan that is not in the loan sheet'); continue; }
    if (deathLoans.has(lid)) { skip('loan settlements left out because the loan has a death settlement'); continue; }
    settled.add(lid); setSeq += 1;
    const dates = rs.map((r) => dateOf(r[2])).filter(Boolean).sort((a, b) => a - b);
    const on = dates[dates.length - 1] || info.pay.paidOn;
    const prin = rs.reduce((t, r) => t + paise(r[4]), 0); const inte = rs.reduce((t, r) => t + paise(r[5]), 0); const amount = prin + inte;
    setDocs.push({ _id: oid(), kind: 'loan', receiptNo: `LEGSTL-${String(setSeq).padStart(6, '0')}`, loanPayment: info.pay._id, loanId: lid, formId: lid, branch: info.branch, member: info.m._id, memberCode: info.m.code, memberName: info.m.name, group: info.group, outstandingPaise: amount, amountPaise: amount, waiverPaise: 0, payMode: 'cash', reference: 'Old system', settledOn: on, remark: `Settlement in the old system: principal ${prin / 100}, interest ${inte / 100}`, status: 'active', ...stamp(on) });
  }
  const settleCheck = { equal: 0, other: 0 };
  for (const [lid, rs] of setByLoan) { const info = loanInfo.get(lid); if (!info || deathLoans.has(lid)) continue; const paid = coll.filter((c) => c.loan === lid).reduce((t, c) => t + c.pay, 0); const sa = rs.reduce((t, r) => t + paise(r[4]) + paise(r[5]), 0); if (Math.abs(info.payable - paid - sa) <= 200) settleCheck.equal += 1; else settleCheck.other += 1; }

  // ---- collections, allocated from installment 1, and the legacy opening for loans that are not settled
  const collBy = new Map();
  let missingLoan = 0;
  for (const c of coll) { if (!loanInfo.has(c.loan)) { missingLoan += 1; continue; } if (!collBy.has(c.loan)) collBy.set(c.loan, []); collBy.get(c.loan).push(c); }
  if (missingLoan) { console.log('Skipped so far:', JSON.stringify(report.skipped)); const ids=[...new Set(coll.filter((c)=>!loanInfo.has(c.loan)).map((c)=>c.loan))]; console.log('loans without a record:', ids.length, ids.slice(0,12).join(',')); throw new Error(`${missingLoan} collection rows belong to a loan that could not be built; nothing is written.`); }
  const emiDocs = []; let emiSeq = 0; let openingLoans = 0; let openingAmount = 0; let surplusRows = 0; let surplusAmount = 0;
  for (const [lid, info] of loanInfo) {
    const sched = info.schedule; const left = sched.map((s) => s.installmentPaise);
    const recorded = (collBy.get(lid) || []).sort((a, b) => a.date - b.date || a.seq - b.seq);
    const base = (amountPaise, on, items, extra = {}) => {
      emiSeq += 1;
      return { _id: oid(), receiptNo: `LEGEMI-${String(emiSeq).padStart(7, '0')}`, loanPayment: info.pay._id, loanId: lid, formId: lid, branch: info.branch, member: info.m._id, memberCode: info.m.code, memberName: info.m.name, group: info.group, installments: items.map((i) => i.no), items, amountPaise, paidOn: on, payMode: 'cash', reference: 'Old system', status: 'paid', legacy: false, npa: false, ...extra, ...stamp(on) };
    };
    const allocate = (amount, onlyBefore) => {
      const items = []; let rest = amount;
      for (let i = 0; i < sched.length && rest > 0; i += 1) {
        if (left[i] <= 0) continue;
        if (onlyBefore && sched[i].dueDate >= onlyBefore) break;
        const take = Math.min(left[i], rest); left[i] -= take; rest -= take;
        items.push({ no: sched[i].no, dueDate: sched[i].dueDate, amountPaise: take });
      }
      return { items, rest };
    };
    if (!settled.has(lid)) {
      const dueBefore = sched.filter((s) => s.dueDate < OPENING_CUTOFF).reduce((t, s) => t + s.installmentPaise, 0);
      const recordedTotal = recorded.reduce((t, c) => t + c.pay, 0);
      const opening = Math.max(dueBefore - recordedTotal, 0);
      if (opening > 0) {
        const { items } = allocate(opening, OPENING_CUTOFF);
        if (items.length) { const amt = items.reduce((t, i) => t + i.amountPaise, 0); emiDocs.push(base(amt, new Date(OPENING_CUTOFF.getTime() - DAY), items, { type: 'regular', legacy: true, employeeCode: info.empCode, createdByCode: 'LEGACY', reference: 'Collected in the old system before 1 Dec 2025 (assumed)' })); openingLoans += 1; openingAmount += amt; }
      }
    }
    for (const c of recorded) {
      const { items, rest } = allocate(c.pay, null);
      if (rest > 0) { surplusRows += 1; surplusAmount += rest; }
      emiDocs.push(base(c.pay, c.date, items, { type: items.some((i) => i.dueDate > c.date) ? 'advance' : 'regular', employeeCode: c.collector || undefined, createdByCode: c.collector || 'LEGACY', branch: branchOf(c.branch) || info.branch, reference: `Collection sheet ${c.month}`, ...(rest > 0 ? { surplusPaise: rest } : {}) }));
    }
  }

  // ---- reconcile with the Total rows of the monthly sheets
  const built = new Map();
  coll.forEach((c) => { const k = `${c.month}|${c.branch}`; built.set(k, (built.get(k) || 0) + c.pay); });
  let bad = 0;
  for (const [k, v] of totals) if (built.get(k) !== v) { bad += 1; console.log(`  MISMATCH ${k}: sheet ${v / 100} read ${(built.get(k) || 0) / 100}`); }
  const emiReal = emiDocs.filter((d) => !d.legacy).reduce((t, d) => t + d.amountPaise, 0);
  const sheetSum = coll.reduce((t, c) => t + c.pay, 0);
  console.log(`branch-month totals checked: ${totals.size}, mismatches: ${bad}; collected in the sheets Rs ${sheetSum / 100}, EMI records made Rs ${emiReal / 100} ${emiReal === sheetSum ? 'OK' : 'DIFFERENT'}`);
  if (bad || emiReal !== sheetSum) throw new Error('The totals do not agree with the sheets; nothing is written.');

  // ---- security withdrawals
  const wdDocs = []; let wdSeq = 0;
  withdrawals.forEach(({ mid, amt, on }) => {
    const m = memberByCode.get(mid);
    if (!m) { skip('security withdrawals of an unknown member'); return; }
    if (amt < 100) return;
    wdSeq += 1;
    wdDocs.push({ _id: oid(), receiptNo: `LEGSWD-${String(wdSeq).padStart(6, '0')}`, member: m._id, memberCode: m.code, memberName: m.name, branch: m.branch, kind: 'withdraw', amountPaise: amt, interestPaise: 0, payMode: 'cash', reference: 'Old system', remark: 'Withdrawn in the old system', status: 'approved', otpRequired: false, decidedAt: on || new Date(), decidedByCode: 'LEGACY', requestedByCode: 'LEGACY', ...stamp(on || new Date()) });
  });

  // ---- group leader commission (one record per group and month, paid out in cash)
  const commBy = new Map();
  for (const r of S.comm) {
    const gc = up(str(r[10]).split('-')[0]); const g = groupDocs.get(gc); const d = dateOf(r[0]); const amt = paise(r[11]);
    if (!g) { skip('commission entries of a group that is not in the group sheet'); continue; }
    if (!d || !amt) { skip('commission entries without a date or an amount'); continue; }
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; const k = `${gc}|${month}`;
    const cur = commBy.get(k) || { g, month, loans: 0, amount: 0, on: d };
    cur.loans += 1; cur.amount += amt; if (d > cur.on) cur.on = d; commBy.set(k, cur);
  }
  const commDocs = [...commBy.values()].map((c) => ({ _id: oid(), group: c.g._id, branch: c.g.branch, month: c.month, loans: c.loans, amountPaise: c.amount, status: 'deposited', depositedAt: c.on, otpAttempts: 0, ...stamp(c.on) }));

  // ---- report
  console.log(`\nbranches ${branchDocs.length}, staff logins ${userDocs.length}, HR employees ${hrDocs.length}, groups ${groupDocs.size}, members ${memberDocs.length} (mobile on ${mobiles}, no Aadhaar on ${noAadhaar}, ${badPan} invalid PAN left out)`);
  console.log(`loans ${reqDocs.length}, settlements ${setDocs.length} (${setDocs.filter((s) => s.kind === 'death').length} death), EMI records ${emiDocs.length} (${openingLoans} legacy openings, Rs ${openingAmount / 100}), security withdrawals ${wdDocs.length}, commission records ${commDocs.length}`);
  console.log(`settled loans where collected + settlement = payable: ${settleCheck.equal}, other: ${settleCheck.other}; collections above what the loan takes: ${surplusRows} rows (Rs ${surplusAmount / 100}); EMI rows marked advance: ${emiDocs.filter((d) => d.type === 'advance' && !d.legacy).length}`);
  console.log('\n=== Skipped / not saved ===');
  Object.entries(report.skipped).forEach(([k, v]) => console.log(`  ${v}  ${k}`));
  if (!Object.keys(report.skipped).length) console.log('  nothing');
  if (DRY) { console.log('\nDry run finished: nothing was written.'); await mongoose.disconnect(); return; }

  // ---- write: the estimate of the collection sheets and an earlier run of this script go first
  for (const c of OWN) { await col(c).deleteMany({ [OLD_FLAG]: true }); await col(c).deleteMany({ [FLAG]: true }); }
  await col('loanschemes').deleteMany({ [OLD_FLAG]: true });
  async function insert(name, docs, size = 1000) {
    let ok = 0;
    for (let i = 0; i < docs.length; i += size) { const r = await col(name).insertMany(docs.slice(i, i + size), { ordered: true }); ok += r.insertedCount; }
    console.log(`  ${name}: ${ok} of ${docs.length}`);
    if (ok !== docs.length) throw new Error(`${name}: not everything was saved`);
  }
  try { await col('members').dropIndex('aadhaar_1'); } catch { /* not there */ }
  await col('members').createIndex({ aadhaar: 1 }, { unique: true, partialFilterExpression: { isDeleted: false, aadhaar: { $type: 'string' } } });
  await insert('branches', branchDocs); await insert('users', userDocs); await insert('departments', deptDocs); await insert('designations', desigDocs); await insert('employees', hrDocs);
  await insert('groups', [...groupDocs.values()]); await insert('members', memberDocs); await insert('loanrequisitions', reqDocs, 200); await insert('loanpayments', payDocs, 100);
  await insert('loansettlements', setDocs); await insert('emipayments', emiDocs, 2000); await insert('securitywithdrawals', wdDocs); await insert('groupleadercommissions', commDocs);
  console.log('\nDone. Staff logins are switched off (no password is known).');
  await mongoose.disconnect();
}

main().catch(async (err) => { console.error('Import failed:', err.message); try { await mongoose.disconnect(); } catch { /* */ } process.exit(1); });
