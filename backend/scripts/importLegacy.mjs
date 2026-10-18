/**
 * Loads the data of the old system ("reports udgams data.xlsx": member detail, group detail, loan disbursement, collection data,
 * employee name, security, loan settlement) into the app.
 *
 *   node scripts/importLegacy.mjs "C:\path\reports udgams data.xlsx"            import (replaces an earlier import)
 *   node scripts/importLegacy.mjs "C:\path\reports udgams data.xlsx" --dry      read and check only, nothing is written
 *   node scripts/importLegacy.mjs --remove                                      remove everything this script imported
 *
 * Every imported record carries `legacyImport: true`, so a re-run (or --remove) takes exactly those records out and leaves
 * what was made in the app alone. The file itself is never copied into the project.
 *
 * What the file does not say is worked out or marked, see the "assumptions" printed at the end:
 *  - the term and the interest of a loan come from its "Table" (read from the collections: daily 120 installments, 20% flat; ...);
 *  - installments due before 1 Jan 2026 that have no collection in the file are treated as collected in the old system
 *    (one "legacy opening" EMI record per loan, left out of the Cashbook);
 *  - members have no mobile number, nominee or documents; groups have no leader.
 */
import 'dotenv/config';
import fs from 'fs';
import zlib from 'zlib';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { calculateLoan, MODES } from '../src/services/loanCalculator.js';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const REMOVE = args.includes('--remove');
const file = args.find((a) => !a.startsWith('--'));
const ASSUME_PAID_BEFORE = new Date('2026-01-01T00:00:00.000Z');
const COLLECTIONS = ['branches', 'users', 'groups', 'members', 'loanschemes', 'loanrequisitions', 'loanpayments', 'emipayments', 'loansettlements', 'securitywithdrawals'];

// ---- reading the workbook (a zip of xml files; nothing in it is executed) --------------------------------------------------
function unzip(path) {
  const buf = fs.readFileSync(path);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i -= 1) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not an xlsx file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n += 1) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28); const elen = buf.readUInt16LE(p + 30); const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    const lnlen = buf.readUInt16LE(off + 26); const lelen = buf.readUInt16LE(off + 28);
    const start = off + 30 + lnlen + lelen;
    const raw = buf.subarray(start, start + csize);
    files.set(name, () => (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8'));
    p += 46 + nlen + elen + clen;
  }
  return files;
}
const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
function readWorkbook(path) {
  const files = unzip(path);
  const get = (n) => { const f = files.get(n); if (!f) throw new Error(`Missing ${n} in the file`); return f(); };
  const strings = [...get('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));
  const rels = new Map([...get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship [^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const sheets = {};
  for (const m of get('xl/workbook.xml').matchAll(/<sheet name="([^"]*)"[^>]*?r:id="([^"]+)"/g)) {
    const target = rels.get(m[2]).replace(/^\/?(xl\/)?/, 'xl/');
    const xml = get(target);
    const rows = [];
    for (const rm of xml.matchAll(/<row [^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const cells = [];
      for (const cm of (rm[1] || '').matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /r="([A-Z]+\d+)"/.exec(cm[1])?.[1];
        const t = /t="(\w+)"/.exec(cm[1])?.[1];
        const body = cm[2] || '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let val = v;
        if (t === 's') val = strings[Number(v)];
        else if (t === 'inlineStr') val = dec(/<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1] || '');
        else if (t === 'str') val = dec(v || '');
        if (ref && val !== undefined && val !== '') cells[colIndex(ref)] = String(val).trim();
      }
      if (cells.length) rows.push(cells);
    }
    sheets[dec(m[1]).trim().toLowerCase()] = rows;
  }
  return sheets;
}

// ---- small helpers ---------------------------------------------------------------------------------------------------------
const serialDate = (s) => (/^\d+(\.\d+)?$/.test(String(s || '')) ? new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000) : null);
const dmy = (s) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '')); return m ? new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))) : null; };
const anyDate = (s) => dmy(s) || serialDate(s);
const iso = (d) => (d ? d.toISOString().slice(0, 10) : '');
const paise = (x) => Math.round((Number(String(x || '0').replace(/,/g, '')) || 0) * 100);
const up = (s) => String(s || '').trim().toUpperCase();
const title = (s) => String(s || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const oid = () => new mongoose.Types.ObjectId();
const now = new Date();
const stamp = (d = now) => ({ createdAt: d, updatedAt: d, legacyImport: true });
const DAYS = { MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6, SUNDAY: 7 };

// What each "Table" of loans is, read from the collections: how many installments and how much interest in all (flat).
const TABLES = [
  { test: /PRODUCT/i, mode: 'daily', term: 120, ratio: 0.32, seen: true, type: 'product' },
  { test: /PERSONAL.*WLY/i, mode: 'weekly', term: 30, ratio: 0.2, seen: false, type: 'personal' },
  { test: /PERSONAL.*DLY/i, mode: 'daily', term: 120, ratio: 0.2, seen: false, type: 'personal' },
  { test: /40K TO ?100K.*WLY/i, mode: 'weekly', term: 50, ratio: 0.3, seen: true, type: 'group' },
  { test: /31K TO 39K.*WLY/i, mode: 'weekly', term: 30, ratio: 0.2, seen: false, type: 'group' },
  { test: /WLY/i, mode: 'weekly', term: 30, ratio: 0.2, seen: true, type: 'group' },
  { test: /DLY/i, mode: 'daily', term: 120, ratio: 0.2, seen: true, type: 'group' },
];
const tableOf = (name) => TABLES.find((t) => t.test.test(name)) || { mode: 'daily', term: 120, ratio: 0.2, seen: false, type: 'group', unknown: true };
const parseRange = (name) => {
  const m = /(\d+)\s*K\s*TO\s*(\d+)\s*K/i.exec(name);
  return m ? [Number(m[1]) * 1000, Number(m[2]) * 1000] : [1000, 100000];
};

// ---- the import -------------------------------------------------------------------------------------------------------------
async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { ignoreUndefined: true });
  const db = mongoose.connection.db;
  const col = (n) => db.collection(n);
  const dbName = db.databaseName;
  if (REMOVE) {
    for (const c of COLLECTIONS) console.log(`removed ${(await col(c).deleteMany({ legacyImport: true })).deletedCount} from ${c}`);
    await mongoose.disconnect();
    return;
  }
  if (!file) throw new Error('Give the path of the xlsx file');
  console.log(`Reading ${file}`);
  const wb = readWorkbook(file);
  const sheet = (n) => (wb[n] || wb[Object.keys(wb).find((k) => k.startsWith(n))] || []).slice(1);
  const S = { members: sheet('member detail'), groups: sheet('group detail'), loans: sheet('loan disburcement'), coll: sheet('collection data'), emps: sheet('employee name'), sec: sheet('security'), sets: sheet('loan settalment') };
  console.log(`Rows: members ${S.members.length}, groups ${S.groups.length}, loans ${S.loans.length}, collections ${S.coll.length}, employees ${S.emps.length}, security ${S.sec.length}, settlements ${S.sets.length}`);
  console.log(`Database: ${dbName}${DRY ? ' (dry run: nothing is written)' : ''}`);
  const report = { skipped: {}, notes: [] };
  const skip = (k, n = 1) => { report.skipped[k] = (report.skipped[k] || 0) + n; };

  if (!DRY) for (const c of COLLECTIONS) await col(c).deleteMany({ legacyImport: true });

  async function insert(name, docs) {
    if (DRY || !docs.length) return docs.length;
    let ok = 0;
    for (let i = 0; i < docs.length; i += 1000) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await col(name).insertMany(docs.slice(i, i + 1000), { ordered: false });
        ok += r.insertedCount;
      } catch (err) {
        ok += err.result?.insertedCount ?? err.insertedCount ?? 0;
        skip(`${name} not saved (duplicate key)`, docs.slice(i, i + 1000).length - (err.result?.insertedCount ?? err.insertedCount ?? 0));
      }
    }
    return ok;
  }

  // ---- branches
  const branchNames = new Set();
  const firstDate = new Map();
  const seenAt = (b, d) => { if (b && d && (!firstDate.get(b) || d < firstDate.get(b))) firstDate.set(b, d); };
  S.members.forEach((r) => { const b = up(r[1]); if (b) { branchNames.add(b); seenAt(b, dmy(r[4])); } });
  S.loans.forEach((r) => { const b = up(r[17]); if (b) { branchNames.add(b); seenAt(b, dmy(r[6])); } });
  S.groups.forEach((r) => { const b = up(r[5]); if (b) branchNames.add(b); });
  S.emps.forEach((r) => { const b = up(String(r[1] || '').replace(/-\d+$/, '')); if (b) branchNames.add(b); });
  const branchId = new Map();
  const existing = await col('branches').find({ isDeleted: false }).project({ code: 1 }).toArray();
  const branchDocs = [];
  for (const name of [...branchNames].sort()) {
    const have = existing.find((b) => b.code === name);
    if (have) { branchId.set(name, have._id); continue; }
    const id = oid();
    branchId.set(name, id);
    branchDocs.push({ _id: id, code: name, name: title(name), address: `${title(name)}, Bihar`, state: 'Bihar', city: title(name), openingDate: firstDate.get(name) || new Date('2024-07-01T00:00:00.000Z'), isActive: true, isDeleted: false, ...stamp() });
  }
  const bid = (name) => branchId.get(up(String(name || '').replace(/-\d+$/, '')));
  console.log(`branches: ${await insert('branches', branchDocs)} new (${branchNames.size} in the file)`);

  // ---- employees (staff accounts, switched off: an admin sets a password and switches them on)
  const empByCode = new Map(); const empByName = new Map();
  const userDocs = [];
  const existingUsers = new Set((await col('users').find({}).project({ employeeCode: 1, email: 1 }).toArray()).flatMap((u) => [u.employeeCode, u.email]));
  for (const r of S.emps) {
    const code = up(r[3]); const name = String(r[4] || '').trim();
    if (!code || !name) { skip('employees without code or name'); continue; }
    empByCode.set(code, name);
    if (!empByName.has(up(name))) empByName.set(up(name), code);
    const email = `${code.toLowerCase()}@legacy.udgam.invalid`;
    if (existingUsers.has(code) || existingUsers.has(email)) { skip('employees already in the app'); continue; }
    const b = bid(r[1]);
    userDocs.push({
      _id: oid(), name, email, employeeCode: code, role: /^company$/i.test(name) ? 'viewer' : 'collection_officer', branches: b ? [b] : [],
      password: await bcrypt.hash(crypto.randomBytes(18).toString('hex'), 10), isActive: false, failedAttempts: 0, legacyRank: Number(r[6]) || null, legacySponsor: r[7] || '', joinedOn: dmy(r[2]) || null, ...stamp(),
    });
  }
  console.log(`employees: ${await insert('users', userDocs)} staff records (switched off; no password is known)`);

  // ---- groups (members are added below), then members
  const groupDocs = new Map();
  const groupOfLoanMode = new Map(); // group code -> modes seen in its loans
  S.loans.forEach((r) => { const g = up(r[18]); if (g && g !== '--') { const t = tableOf(r[5] || ''); if (!groupOfLoanMode.has(g)) groupOfLoanMode.set(g, new Set()); groupOfLoanMode.get(g).add(t.mode); } });
  const takenNames = new Set();
  const addGroup = (code, name, b, extra = {}) => {
    code = up(code);
    if (!code || groupDocs.has(code)) return groupDocs.get(code);
    let nm = String(name || code).trim();
    const key = `${b}|${nm.toLowerCase()}`;
    if (takenNames.has(key)) nm = `${nm} (${code})`;
    takenNames.add(`${b}|${nm.toLowerCase()}`);
    const modes = groupOfLoanMode.get(code);
    const doc = {
      _id: oid(), code, name: nm, branch: b, leaderName: 'Not recorded', leaderMobile: '', members: [], isActive: true, isDeleted: false,
      meetingType: extra.meetingType || (modes?.size === 1 ? [...modes][0] : undefined), ...extra.rest, ...stamp(),
    };
    groupDocs.set(code, doc);
    return doc;
  };
  for (const r of S.groups) {
    const b = bid(r[5]);
    if (!b) { skip('groups without a branch'); continue; }
    const type = /^w/i.test(r[8] || '') ? 'weekly' : /^d/i.test(r[8] || '') ? 'daily' : undefined;
    const t = Number(r[7]);
    const hhmm = Number.isFinite(t) && r[7] !== undefined ? `${String(Math.floor((t % 1) * 24)).padStart(2, '0')}:${String(Math.floor((((t % 1) * 24) % 1) * 60)).padStart(2, '0')}` : undefined;
    const rest = { openingDate: serialDate(r[3]) || undefined, employeeCode: empByName.get(up(r[4])) || '', meetingTime: hhmm };
    if (type === 'weekly' && DAYS[up(r[6])]) rest.collectionDay = DAYS[up(r[6])];
    addGroup(r[1], r[2], b, { meetingType: type, rest });
  }

  const memberDocs = []; const memberByCode = new Map();
  const seenAadhaar = new Set(); const seenPan = new Set();
  let badPan = 0; let noAadhaar = 0;
  for (const r of S.members) {
    const code = up(r[2]);
    const b = bid(r[1]);
    if (!code || !b) { skip('members without id or branch'); continue; }
    if (memberByCode.has(code)) { skip('members with a repeated id'); continue; }
    const aadhaar = String(r[11] || '').replace(/\D/g, '');
    if (aadhaar.length !== 12) noAadhaar += 1;
    const aadhaarOk = aadhaar.length === 12 && !seenAadhaar.has(aadhaar);
    const dupAadhaar = aadhaar.length === 12 && seenAadhaar.has(aadhaar);
    if (dupAadhaar) skip('members whose Aadhaar number is already on another member (kept as legacyAadhaar only)');
    if (aadhaarOk) seenAadhaar.add(aadhaar);
    let pan = up(r[10]);
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) { if (pan) badPan += 1; pan = ''; }
    const panRaw = pan;
    const panDup = Boolean(pan && seenPan.has(pan));
    if (panDup) { skip('members whose PAN is already on another member (kept as legacyPan only)'); pan = ''; }
    if (pan) seenPan.add(pan);
    const pin = [...String(r[9] || '').matchAll(/\b(\d{6})\b/g)].map((m) => m[1]).pop() || '';
    const empCode = up(String(r[12] || '').split('-').pop());
    const gm = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(r[13] || '');
    const joined = dmy(r[4]) || new Date('2024-07-01T00:00:00.000Z');
    const doc = {
      _id: oid(), code, formId: code, branch: b, joiningDate: joined, name: String(r[3] || '').trim(), dob: serialDate(r[7]) || new Date('1990-01-01T00:00:00.000Z'),
      gender: /^f/i.test(r[5] || '') ? 'female' : /^m/i.test(r[5] || '') ? 'male' : 'other', mobile: '', occupation: '', education: '', address: String(r[9] || '').trim(),
      pincode: pin, state: 'Bihar', district: '', ...(aadhaarOk ? { aadhaar } : {}), ...(dupAadhaar ? { legacyAadhaar: aadhaar } : {}), ...(pan ? { pan } : {}), ...(panDup ? { legacyPan: panRaw } : {}), bankName: '', ifsc: '', accountNumber: '',
      employeeCode: empCode && empByCode.has(empCode) ? empCode : empCode || undefined,
      ...(r[8] ? { guarantor: { name: String(r[8]).trim(), savedAt: joined } } : {}),
      kycKeys: [], kycDocs: [], guarantorHistory: [], blockHistory: [], isBlocked: false, isActive: true, isDeleted: false, ...stamp(joined),
    };
    if (gm) {
      const g = addGroup(gm[2], gm[1], b);
      if (g) g.members.push({ member: doc._id, addedAt: joined });
    }
    memberByCode.set(code, doc);
    memberDocs.push(doc);
  }
  if (!DRY) {
    // only an Aadhaar number that is present has to be unique (members of the old system may have none yet)
    try { await col('members').dropIndex('aadhaar_1'); } catch { /* not there */ }
    await col('members').createIndex({ aadhaar: 1 }, { unique: true, partialFilterExpression: { isDeleted: false, aadhaar: { $type: 'string' } } });
  }
  console.log(`groups: ${await insert('groups', [...groupDocs.values()])} (${S.groups.length} in the sheet, the rest named only on members)`);
  console.log(`members: ${await insert('members', memberDocs)} (no Aadhaar on ${noAadhaar}, ${badPan} PAN numbers are not valid and were left out)`);

  // ---- loan schemes: one per "Table" (switched off; they only describe the old loans)
  const tables = [...new Set(S.loans.map((r) => String(r[5] || '').trim()))];
  const schemeOf = new Map();
  const schemeDocs = [];
  for (const name of tables) {
    const t = tableOf(name);
    const [lo, hi] = parseRange(name);
    const rBp = Math.round((t.ratio * MODES[t.mode].perYear * 10000) / t.term);
    const id = oid();
    const code = `LEG-${(name || 'UNNAMED').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    schemeOf.set(name, { id, code, name: name || 'Old system loan (no table named)', t, rBp });
    schemeDocs.push({
      _id: id, code, name: name || 'Old system loan (no table named)', loanType: t.type === 'product' ? 'product' : t.type, amountMinPaise: lo * 100, amountMaxPaise: hi * 100,
      termUnit: t.mode === 'daily' ? 'days' : 'weeks', termMin: t.term, termMax: t.term, ageMin: 18, ageMax: 100, roiMinBp: rBp, roiMaxBp: rBp, modes: [t.mode], calculationType: 'flat', emiType: 'equal',
      securityType: 'none', processingFee: { type: 'fixed', value: 0 }, cost: { type: 'fixed', value: 0 }, installmentRounding: 1, isActive: false, isDeleted: false, ...stamp(),
    });
  }
  console.log(`loan schemes: ${await insert('loanschemes', schemeDocs)} (switched off, they only describe the old loans)`);

  // ---- security: deposits go on the loan they were taken for (or the member's latest loan), withdrawals are records of their own
  const secByLoan = new Map(); const secByMember = new Map(); const withdrawals = [];
  for (const r of S.sec) {
    const mid = up(r[2]); const amt = paise(r[6]);
    if (!amt) continue;
    const isWd = /^w/i.test(r[5] || '');
    if (isWd) { withdrawals.push({ mid, amt, on: dmy(r[4]) }); continue; }
    const lid = up(r[1]);
    if (lid) secByLoan.set(lid, (secByLoan.get(lid) || 0) + amt);
    else secByMember.set(mid, (secByMember.get(mid) || 0) + amt);
  }

  // ---- loans: a requisition (approved, paid out) and its payment, with the schedule worked out from the table
  const loanRows = []; const seenLoan = new Set();
  for (const r of S.loans) {
    const lid = up(r[0]);
    if (!lid) { skip('loans without a Loan ID'); continue; }
    if (seenLoan.has(lid)) { skip('loans with a repeated Loan ID (the second one)'); continue; }
    const m = memberByCode.get(up(r[2]));
    if (!m) { skip('loans of a member that is not in the member sheet'); continue; }
    seenLoan.add(lid);
    loanRows.push({ r, lid, m });
  }
  // the member's latest loan takes the deposits that were not tied to a loan
  const latestOf = new Map();
  loanRows.forEach(({ r, lid, m }) => { const d = dmy(r[6]); const cur = latestOf.get(m.code); if (!cur || (d && d > cur.d)) latestOf.set(m.code, { lid, d }); });
  const reqDocs = []; const payDocs = []; const loanInfo = new Map();
  let unknownTable = 0; let receiptSeq = 0;
  for (const { r, lid, m } of loanRows) {
    const tname = String(r[5] || '').trim();
    const sc = schemeOf.get(tname);
    if (sc.t.unknown || !sc.t.seen) unknownTable += 1;
    const amountPaise = paise(r[7]);
    const loanDate = dmy(r[6]) || dmy(r[15]);
    const paidOn = dmy(r[15]) || loanDate;
    if (!amountPaise || !loanDate) { skip('loans without an amount or a date'); continue; }
    let calc;
    try {
      calc = calculateLoan({ principalPaise: amountPaise, annualRateBp: sc.rBp, calculationType: 'flat', emiType: 'equal', mode: sc.t.mode, term: sc.t.term, startDate: paidOn, roundingPaise: 100 });
    } catch {
      skip('loans too small for the installments of their table');
      continue;
    }
    const schedule = calc.schedule.map((s) => ({ no: s.no, dueDate: s.dueDate, installmentPaise: s.installment, principalPaise: s.principal, interestPaise: s.interest }));
    const gcode = up(r[18]);
    const gdoc = gcode && gcode !== '--' ? groupDocs.get(gcode) : null;
    const isGroup = Boolean(gdoc) || sc.t.type === 'group' || sc.t.type === 'product';
    const b = bid(r[17]) || m.branch;
    const proc = paise(r[9]) + paise(r[10]) + paise(r[12]); // processing + legal + GST
    const ins = paise(r[13]);
    const security = (secByLoan.get(lid) || 0) + (latestOf.get(m.code)?.lid === lid ? secByMember.get(m.code) || 0 : 0);
    const net = r[14] !== undefined ? paise(r[14]) : amountPaise - proc - ins;
    const empCode = gdoc?.employeeCode || m.employeeCode || 'LEGACY';
    const reqId = oid();
    const payMode = ['cash', 'bank', 'upi', 'cheque'].includes(String(r[16] || '').toLowerCase()) ? String(r[16]).toLowerCase() : 'cash';
    receiptSeq += 1;
    const common = { amountPaise, mode: sc.t.mode, term: sc.t.term, annualRateBp: sc.rBp, installmentPaise: calc.installmentAmount };
    reqDocs.push({
      _id: reqId, kind: isGroup ? 'group' : 'personal', formId: lid, branch: b, loanDate,
      ...(isGroup
        ? { group: gdoc?._id, groupInfo: { code: gdoc?.code || '', name: gdoc?.name || String(r[19] || ''), leaderName: '', employeeCode: gdoc?.employeeCode || '', meetingType: gdoc?.meetingType || sc.t.mode, members: [{ code: m.code, name: m.name }] }, members: [m._id], memberCount: 1, totalAmountPaise: amountPaise }
        : { member: m._id, borrower: { code: m.code, name: m.name, dob: m.dob, gender: m.gender, address: m.address, pincode: m.pincode, district: '', state: 'Bihar', mobile: '', guarantorName: m.guarantor?.name || '' } }),
      previousLoanPaise: 0, scheme: sc.id, schemeCode: sc.code, schemeName: sc.name, ...common, calculationType: 'flat', emiType: 'equal',
      totalInterestPaise: calc.totalInterest, totalPayablePaise: calc.totalPayable, processingFeePaise: proc, insuranceFeePaise: ins, securityAmountPaise: security, cashPaise: net, securityType: 'none',
      employeeCode: empCode, decidedAt: loanDate, decidedByCode: 'LEGACY', disbursedAt: paidOn, status: 'approved', memberForms: [], additionalProducts: [], isDeleted: false, ...stamp(loanDate),
    });
    payDocs.push({
      _id: oid(), receiptNo: `LEGRCP-${String(receiptSeq).padStart(6, '0')}`, loanId: lid, requisition: reqId, formId: lid, kind: isGroup ? 'group' : 'personal', branch: b,
      ...(gdoc ? { group: { code: gdoc.code, name: gdoc.name } } : {}), paidOn, emiStartDate: calc.firstDueDate, emiEndDate: calc.lastDueDate, installments: sc.t.term,
      modeLabel: MODES[sc.t.mode].label, mode: sc.t.mode, loanType: isGroup ? 'group' : 'personal', schemeName: sc.name, annualRateBp: sc.rBp, installmentPaise: calc.installmentAmount, payMode, reference: 'Old system', schedule,
      lines: [{ member: m._id, code: m.code, name: m.name, amountPaise, processingFeePaise: proc, insuranceFeePaise: ins, securityPaise: security, productPaise: 0, products: [], cashPaise: net, extraEmiPaise: 0 }],
      totalAmountPaise: amountPaise, totalCashPaise: net, status: 'paid', employeeCode: empCode, createdByCode: 'LEGACY', ...stamp(paidOn),
    });
    loanInfo.set(lid, { pay: payDocs[payDocs.length - 1], m, schedule, branch: b, group: gdoc ? `${gdoc.code} — ${gdoc.name}` : '', empCode });
  }
  console.log(`loans: ${await insert('loanrequisitions', reqDocs)} requisitions and ${await insert('loanpayments', payDocs)} payments`);

  // ---- settlements first (a settled loan needs no assumed history)
  const setDocs = []; const settled = new Set(); let setSeq = 0;
  for (const r of S.sets) {
    const lid = up(r[0]); const info = loanInfo.get(lid);
    if (!info) { skip('settlements of a loan that is not in the loan sheet'); continue; }
    if (settled.has(lid)) { skip('settlements repeated for a loan'); continue; }
    settled.add(lid);
    const on = serialDate(r[2]) || dmy(r[2]) || info.pay.paidOn;
    const amount = paise(r[4]) + paise(r[5]);
    setSeq += 1;
    setDocs.push({
      _id: oid(), kind: 'loan', receiptNo: `LEGSTL-${String(setSeq).padStart(6, '0')}`, loanPayment: info.pay._id, loanId: lid, formId: lid, branch: info.branch, member: info.m._id, memberCode: info.m.code, memberName: info.m.name,
      group: info.group, outstandingPaise: amount, amountPaise: amount, waiverPaise: 0, payMode: 'cash', reference: 'Old system', settledOn: on, remark: `Settlement in the old system: principal ${paise(r[4]) / 100}, interest ${paise(r[5]) / 100}`, status: 'active', ...stamp(on),
    });
  }
  console.log(`settlements: ${await insert('loansettlements', setDocs)}`);

  // ---- collections, and the "legacy opening" for the installments before 1 Jan 2026 the file does not show
  const collBy = new Map();
  for (const r of S.coll) {
    const lid = up(r[1]);
    if (!loanInfo.has(lid)) { skip('collections of a loan that is not in the loan sheet'); continue; }
    const amt = paise(r[8]);
    const on = dmy(r[5]);
    if (!amt || !on) { skip('collections without an amount or a date'); continue; }
    if (!collBy.has(lid)) collBy.set(lid, []);
    collBy.get(lid).push({ amt, on, emp: up(r[13]) });
  }
  const emiDocs = []; let emiSeq = 0; let openingLoans = 0;
  for (const [lid, info] of loanInfo) {
    const sched = info.schedule;
    const left = sched.map((s) => s.installmentPaise);
    const recorded = (collBy.get(lid) || []).sort((a, b) => a.on - b.on);
    const base = (amountPaise, on, items, extra = {}) => {
      emiSeq += 1;
      return {
        _id: oid(), receiptNo: `LEGEMI-${String(emiSeq).padStart(7, '0')}`, loanPayment: info.pay._id, loanId: lid, formId: lid, branch: info.branch, member: info.m._id, memberCode: info.m.code, memberName: info.m.name,
        group: info.group, installments: items.map((i) => i.no), items, amountPaise, paidOn: on, payMode: 'cash', reference: 'Old system', status: 'paid', ...extra, ...stamp(on),
      };
    };
    const allocate = (amount, onlyBefore) => {
      const items = []; let rest = amount;
      for (let i = 0; i < sched.length && rest > 0; i += 1) {
        if (left[i] <= 0) continue;
        if (onlyBefore && sched[i].dueDate >= onlyBefore) break;
        const take = Math.min(left[i], rest);
        left[i] -= take; rest -= take;
        items.push({ no: sched[i].no, dueDate: sched[i].dueDate, amountPaise: take });
      }
      return items;
    };
    // the installments before 2026 that have no collection in the file are taken as collected in the old system
    if (!settled.has(lid)) {
      const dueBefore = sched.filter((s) => s.dueDate < ASSUME_PAID_BEFORE).reduce((t, s) => t + s.installmentPaise, 0);
      const recordedTotal = recorded.reduce((t, c) => t + c.amt, 0);
      const opening = Math.max(dueBefore - recordedTotal, 0);
      if (opening > 0) {
        const items = allocate(opening, ASSUME_PAID_BEFORE);
        if (items.length) {
          emiDocs.push(base(items.reduce((t, i) => t + i.amountPaise, 0), new Date(ASSUME_PAID_BEFORE.getTime() - 86400000), items, { type: 'regular', legacy: true, employeeCode: info.empCode, createdByCode: 'LEGACY', reference: 'Collected in the old system before 1 Jan 2026 (assumed)' }));
          openingLoans += 1;
        }
      }
    }
    for (const c of recorded) {
      const items = allocate(c.amt, null);
      if (!items.length) { skip('collections beyond what the loan could still take'); continue; }
      const paid = items.reduce((t, i) => t + i.amountPaise, 0);
      emiDocs.push(base(paid, c.on, items, { type: items.some((i) => i.dueDate > c.on) ? 'advance' : 'regular', employeeCode: c.emp, createdByCode: c.emp || 'LEGACY' }));
    }
  }
  const saved = await insert('emipayments', emiDocs);
  console.log(`EMI records: ${saved} (${S.coll.length} collections from the file, plus ${openingLoans} "legacy opening" records)`);

  // ---- security withdrawals
  const wdDocs = []; let wdSeq = 0; let noLoanDeposits = 0; let noLoanAmount = 0;
  withdrawals.forEach(({ mid, amt, on }) => {
    const m = memberByCode.get(mid);
    if (!m) { skip('security withdrawals of an unknown member'); return; }
    if (amt < 100) return;
    wdSeq += 1;
    wdDocs.push({ _id: oid(), receiptNo: `LEGSWD-${String(wdSeq).padStart(6, '0')}`, member: m._id, memberCode: m.code, memberName: m.name, branch: m.branch, kind: 'withdraw', amountPaise: amt, interestPaise: 0, payMode: 'cash', reference: 'Old system', remark: 'Withdrawn in the old system', status: 'approved', otpRequired: false, decidedAt: on || now, decidedByCode: 'LEGACY', requestedByCode: 'LEGACY', ...stamp(on || now) });
  });
  console.log(`security withdrawals: ${await insert('securitywithdrawals', wdDocs)}`);
  for (const [mid, amt] of secByMember) if (!latestOf.has(mid)) { noLoanDeposits += 1; noLoanAmount += amt; }
  for (const [lid, amt] of secByLoan) if (!loanInfo.has(lid)) { noLoanDeposits += 1; noLoanAmount += amt; }

  // ---- what to know
  console.log('\n=== Skipped / not saved ===');
  Object.entries(report.skipped).forEach(([k, v]) => console.log(`  ${v}  ${k}`));
  if (!Object.keys(report.skipped).length) console.log('  nothing');
  console.log('\n=== Assumptions ===');
  console.log(`  Loan terms: daily 120 installments / 20% flat, weekly 30 weeks / 20% (40K-100K: 50 weeks / 30%), product daily 120 / 32% (as seen in the collections).`);
  console.log(`  ${unknownTable} loans are in a table whose term was not seen in the collections, so the nearest known table was used.`);
  console.log(`  Installments due before ${iso(ASSUME_PAID_BEFORE)} with no collection in the file are taken as collected ("${openingLoans}" loans got a legacy opening record; it is not in the Cashbook).`);
  console.log(`  Security: ${secByLoan.size} deposits are tied to a loan; deposits without a loan went to the member's latest loan; ${noLoanDeposits} deposit groups (₹${noLoanAmount / 100}) belong to members with no loan in the file and are not shown.`);
  console.log('  Members have no mobile, nominee or documents; groups have no leader; staff accounts are switched off with no known password.');
  await mongoose.disconnect();
}

main().catch(async (err) => { console.error('Import failed:', err.message); try { await mongoose.disconnect(); } catch { /* */ } process.exit(1); });
