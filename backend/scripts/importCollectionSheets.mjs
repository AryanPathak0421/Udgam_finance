/**
 * Seeds the monthly "EMI Collection Report" sheets of the old system (rptLoanEMICollectionList, .xls) into an app database
 * that has no members / loans yet.
 *
 *   node scripts/importCollectionSheets.mjs "<folder with the .xls files>" --dry     read, build and reconcile only, nothing is written
 *   node scripts/importCollectionSheets.mjs "<folder with the .xls files>"           write (replaces an earlier run of this script)
 *   node scripts/importCollectionSheets.mjs --remove                                 remove everything this script wrote
 *   options: --dns=8.8.8.8 (resolve mongodb+srv with another DNS server), --force (run although the database has other data)
 *
 * The sheets hold collections only. What they do not say is DERIVED and the record is marked `estimated: true`:
 *  - a loan's installment = its most common Pay Amt, the mode (daily / weekly) = the gap between its payment dates,
 *    the interest = Interest / Principal of its rows, the term = the table of the old system (daily 120, weekly 30 at 20%, weekly 50 at 30%),
 *    longer when more was collected than the term takes; the loan amount follows from them;
 *  - the due dates are counted back from the first payment in the sheets (Sundays skipped for daily loans);
 *  - members have only a code, name and branch; no group, mobile, Aadhaar, nominee or documents.
 * Every collection row of the sheets becomes exactly one EmiPayment of the same date, amount, branch and collector (duplicates in the
 * sheets included, so that every branch total agrees with the "Total" row of the sheet).
 * Every record carries `legacyImport: true` and `collectionSheetImport: true`.
 */
import 'dotenv/config';
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { createRequire } from 'module';
import { BSON } from 'mongodb';
import { skipSundays } from '../src/services/loanCalculator.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const REMOVE = args.includes('--remove');
const FORCE = args.includes('--force');
const dnsArg = args.find((a) => a.startsWith('--dns='));
if (dnsArg) dns.setServers(dnsArg.slice(6).split(','));
const dir = args.find((a) => !a.startsWith('--'));
const FLAG = 'collectionSheetImport';
const COLLECTIONS = ['branches', 'users', 'members', 'loanschemes', 'loanrequisitions', 'loanpayments', 'emipayments'];
const MONTHS = ['DECEMBER 2025', 'JANUARY 2026', 'FEBUARY 2026', 'MARCH 2026', 'APRIL 2026', 'MAY 2026', 'JUNE 2026', 'JULY 2026', 'AUGUST 2026', 'SEPTEMBER 2026', 'OCTUBER 2026', 'NOVEMBER 2026'];

const DAY = 86400000;
const paise = (x) => Math.round((Number(x) || 0) * 100);
const up = (s) => String(s || '').trim().toUpperCase();
const title = (s) => String(s || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const oid = () => new mongoose.Types.ObjectId();
const iso = (d) => d.toISOString().slice(0, 10);
const dmy = (s) => { const m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(String(s)); return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null; };
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
const stamp = (d) => ({ createdAt: d, updatedAt: d, legacyImport: true, [FLAG]: true });
const modal = (items) => { const c = new Map(); items.forEach((x) => c.set(x, (c.get(x) || 0) + 1)); return [...c.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0]; };
// the day before: a daily installment never falls on a Sunday
const backWorkingDays = (d, k) => { let x = d; for (let i = 0; i < k; i += 1) { x = addDays(x, -1); if (x.getUTCDay() === 0) x = addDays(x, -1); } return x; };

// ---- 1. read the sheets --------------------------------------------------------------------------------------------------------
function readSheets() {
  const rows = []; const totals = new Map(); const seen = [];
  for (const m of MONTHS) {
    const file = path.join(dir, `${m}.xls`);
    if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
    const wb = XLSX.readFile(file);
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
    let branch = ''; let n = 0;
    for (let i = 0; i < grid.length; i += 1) {
      const r = grid[i];
      if (r[4] === 'Loan ID') continue;
      if (r[2] && r[2] !== 'Branch Wise') branch = String(r[2]).trim();
      if (String(r[10]).startsWith('Total')) { totals.set(`${m}|${up(branch)}`, { pay: paise(r[11]), principal: paise(r[14]), interest: paise(r[15]) }); continue; }
      if (!r[4]) continue;
      const date = dmy(r[8]);
      if (!date) throw new Error(`${m}: row ${i + 1} has no valid date (${r[8]})`);
      if (!(Number(r[11]) > 0)) throw new Error(`${m}: row ${i + 1} has no amount`);
      rows.push({ month: m, seq: rows.length, branch: up(branch), loan: up(r[4]), member: up(r[6]), name: String(r[7]).trim(), date, pay: paise(r[11]), principal: paise(r[14]), interest: paise(r[15]), collector: up(r[16]) });
      n += 1;
    }
    seen.push(`${m}: ${n} rows`);
  }
  console.log(seen.join('\n'));
  return { rows, totals };
}

// ---- 2. work the loans out -----------------------------------------------------------------------------------------------------
function buildLoans(rows) {
  const by = new Map();
  for (const r of rows) { if (!by.has(r.loan)) by.set(r.loan, []); by.get(r.loan).push(r); }
  const loans = [];
  for (const [id, rs] of by) {
    rs.sort((a, b) => a.date - b.date || a.seq - b.seq);
    const amounts = rs.map((r) => r.pay);
    let inst = modal(amounts);
    const instCount = amounts.filter((a) => a === inst).length;
    let confidence = 'normal';
    if (instCount < 2 && rs.length > 1) { inst = Math.min(...amounts); confidence = 'low'; } else if (rs.length === 1) confidence = 'low';
    const dates = [...new Set(rs.map((r) => +r.date))].sort((a, b) => a - b);
    const gaps = []; for (let i = 1; i < dates.length; i += 1) gaps.push((dates[i] - dates[i - 1]) / DAY);
    const gap = dates.length >= 3 ? modal(gaps) : 1;
    const mode = gap === 7 ? 'weekly' : 'daily';
    const sumPay = rs.reduce((t, r) => t + r.pay, 0);
    const sumPr = rs.reduce((t, r) => t + r.principal, 0); const sumIn = rs.reduce((t, r) => t + r.interest, 0);
    const ratio = sumPr ? sumIn / sumPr : 0.2;
    const rr = Math.round(ratio * 100) / 100;
    let base = mode === 'daily' ? 120 : (rr >= 0.3 ? 50 : 30);
    const needed = Math.ceil(sumPay / inst);
    const term = Math.max(base, needed);
    // principal / interest of one installment, from the sheet's own split of the usual installment
    const usual = rs.find((r) => r.pay === inst) || rs[0];
    const prPer = Math.round((inst * usual.principal) / usual.pay);
    // first-day installments are counted back from the first payment
    const d0 = rs[0].date;
    const firstDay = rs.filter((r) => +r.date === +d0).reduce((t, r) => t + r.pay, 0);
    const n0 = Math.min(term, Math.max(1, Math.ceil(firstDay / inst)));
    let start;
    if (mode === 'daily') start = backWorkingDays(d0, n0 - 1); else start = addDays(d0, -7 * (n0 - 1));
    const due = (j) => { // j = 1-based installment number
      if (mode === 'daily') return skipSundays(start, j - 1);
      const d = addDays(start, 7 * (j - 1)); return d.getUTCDay() === 0 ? addDays(d, 1) : d;
    };
    const schedule = [];
    for (let j = 1; j <= term; j += 1) schedule.push({ no: j, dueDate: due(j), installmentPaise: inst, principalPaise: prPer, interestPaise: inst - prPer });
    const branch = modal(rs.map((r) => r.branch));
    const last = rs[rs.length - 1];
    loans.push({ id, rows: rs, inst, mode, ratio: rr, term, schedule, branch, member: last.member, name: last.name, confidence, start, loanDate: addDays(start, mode === 'daily' && start.getUTCDay() === 1 ? -2 : -1), sumPay });
  }
  return loans;
}

// ---- 3. allocate every row on its loan's installments --------------------------------------------------------------------------
function buildEmis(loans) {
  const out = [];
  for (const L of loans) {
    const left = L.schedule.map((s) => s.installmentPaise);
    let cur = 0;
    for (const r of L.rows) {
      let rest = r.pay; const items = [];
      while (rest > 0) {
        while (cur < left.length && left[cur] <= 0) cur += 1;
        if (cur >= left.length) throw new Error(`Loan ${L.id}: collected more than its ${L.term} installments take`);
        const take = Math.min(left[cur], rest); left[cur] -= take; rest -= take;
        items.push({ no: L.schedule[cur].no, dueDate: L.schedule[cur].dueDate, amountPaise: take });
      }
      out.push({ L, r, items });
    }
  }
  out.sort((a, b) => a.r.date - b.r.date || a.r.seq - b.r.seq);
  return out;
}

async function main() {
  if (!REMOVE && !dir) throw new Error('Give the folder that holds the .xls files');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(process.env.MONGODB_URI, { ignoreUndefined: true });
  const db = mongoose.connection.db;
  const col = (n) => db.collection(n);
  console.log(`Database: ${db.databaseName}${DRY ? ' (dry run: nothing is written)' : ''}`);
  if (REMOVE) {
    for (const c of COLLECTIONS) console.log(`removed ${(await col(c).deleteMany({ [FLAG]: true })).deletedCount} from ${c}`);
    await mongoose.disconnect();
    return;
  }
  // never mix with data that was made some other way
  const foreign = {};
  for (const c of ['branches', 'members', 'loanpayments', 'emipayments']) foreign[c] = await col(c).countDocuments({ [FLAG]: { $ne: true } });
  if (Object.values(foreign).some(Boolean) && !FORCE) throw new Error(`The database already holds other data (${JSON.stringify(foreign)}). Nothing was changed. Use --force only if that is intended.`);

  const { rows, totals } = readSheets();
  const loans = buildLoans(rows);
  const emis = buildEmis(loans);
  console.log(`\nrows ${rows.length}, loans ${loans.length}, EMI records ${emis.length}`);

  // ---- reconcile with the sheets' own Total rows (per month and branch), and across the build
  const calc = new Map();
  for (const e of emis) { const k = `${e.r.month}|${e.r.branch}`; const t = calc.get(k) || { pay: 0, principal: 0, interest: 0, n: 0 }; t.pay += e.r.pay; t.principal += e.r.principal; t.interest += e.r.interest; t.n += 1; calc.set(k, t); }
  let bad = 0;
  for (const [k, t] of totals) { const c = calc.get(k); if (!c || c.pay !== t.pay || Math.abs(c.principal - t.principal) > 100 || Math.abs(c.interest - t.interest) > 100) { bad += 1; console.log(`  MISMATCH ${k}: sheet ${JSON.stringify(t)} built ${JSON.stringify(c)}`); } }
  for (const k of calc.keys()) if (!totals.has(k)) { bad += 1; console.log(`  no Total row in the sheet for ${k}`); }
  const allocated = emis.reduce((t, e) => t + e.items.reduce((s, i) => s + i.amountPaise, 0), 0);
  const sheetTotal = rows.reduce((t, r) => t + r.pay, 0);
  console.log(`branch-month totals checked: ${totals.size}, mismatches: ${bad}; collected in the sheets Rs ${sheetTotal / 100}, allocated on loans Rs ${allocated / 100} ${allocated === sheetTotal ? 'OK' : 'DIFFERENT'}`);
  if (bad || allocated !== sheetTotal) throw new Error('The totals do not agree with the sheets; nothing is written.');

  // ---- documents
  const branchNames = [...new Set(rows.map((r) => r.branch))].sort();
  const branchId = new Map(branchNames.map((b) => [b, oid()]));
  const firstSeen = new Map(); rows.forEach((r) => { if (!firstSeen.get(r.branch) || r.date < firstSeen.get(r.branch)) firstSeen.set(r.branch, r.date); });
  const branchDocs = branchNames.map((b) => ({ _id: branchId.get(b), code: b, name: title(b), address: `${title(b)}, Bihar`, state: 'Bihar', city: title(b), openingDate: firstSeen.get(b), isActive: true, isDeleted: false, ...stamp(firstSeen.get(b)) }));

  const byMember = new Map();
  for (const r of rows) { if (!byMember.has(r.member)) byMember.set(r.member, []); byMember.get(r.member).push(r); }
  const memberId = new Map(); const memberDocs = []; const memberBranch = new Map();
  for (const [code, rs] of byMember) {
    rs.sort((a, b) => a.date - b.date || a.seq - b.seq);
    const b = modal(rs.map((r) => r.branch)); memberBranch.set(code, b);
    const id = oid(); memberId.set(code, id);
    const joined = rs[0].date;
    memberDocs.push({ _id: id, code, formId: code, branch: branchId.get(b), joiningDate: joined, name: rs[rs.length - 1].name, dob: new Date('1990-01-01T00:00:00.000Z'), gender: 'other', mobile: '', occupation: '', education: '', address: '', pincode: '', state: 'Bihar', district: '', bankName: '', ifsc: '', accountNumber: '', employeeCode: rs[rs.length - 1].collector || undefined, kycKeys: [], kycDocs: [], guarantorHistory: [], blockHistory: [], isBlocked: false, isActive: true, isDeleted: false, ...stamp(joined) });
  }

  const collectors = new Map();
  rows.forEach((r) => { if (r.collector) { if (!collectors.has(r.collector)) collectors.set(r.collector, []); collectors.get(r.collector).push(r.branch); } });
  const existingUsers = new Set((await col('users').find({}).project({ employeeCode: 1, email: 1 }).toArray()).flatMap((u) => [u.employeeCode, u.email]));
  const userDocs = [];
  for (const [code, bs] of collectors) {
    const email = `${code.toLowerCase()}@legacy.udgam.invalid`;
    if (existingUsers.has(code) || existingUsers.has(email)) continue;
    userDocs.push({ _id: oid(), name: code, email, employeeCode: code, role: 'collection_officer', branches: [branchId.get(modal(bs))], password: await bcrypt.hash(crypto.randomBytes(18).toString('hex'), 10), isActive: false, failedAttempts: 0, ...stamp(new Date()) });
  }

  const schemeOf = new Map(); const schemeDocs = [];
  const MODE_PER_YEAR = { daily: 365, weekly: 52 };
  for (const L of loans) {
    const key = `${L.mode}|${L.ratio}|${L.term}`;
    if (schemeOf.has(key)) continue;
    const rBp = Math.round((L.ratio * MODE_PER_YEAR[L.mode] * 10000) / L.term);
    const id = oid(); const code = `COL-${L.mode.toUpperCase()}-${Math.round(L.ratio * 100)}PCT-${L.term}`;
    const nm = `Old system ${L.mode} loan, ${Math.round(L.ratio * 100)}% flat, ${L.term} installments`;
    schemeOf.set(key, { id, code, name: nm, rBp });
    schemeDocs.push({ _id: id, code, name: nm, loanType: 'group', amountMinPaise: 100000, amountMaxPaise: 10000000, termUnit: L.mode === 'daily' ? 'days' : 'weeks', termMin: L.term, termMax: L.term, ageMin: 18, ageMax: 100, roiMinBp: rBp, roiMaxBp: rBp, modes: [L.mode], calculationType: 'flat', emiType: 'equal', securityType: 'none', processingFee: { type: 'fixed', value: 0 }, cost: { type: 'fixed', value: 0 }, installmentRounding: 1, isActive: false, isDeleted: false, ...stamp(new Date()) });
  }

  const reqDocs = []; const payDocs = []; const payOf = new Map(); let seq = 0;
  for (const L of loans) {
    const m = memberId.get(L.member); const sc = schemeOf.get(`${L.mode}|${L.ratio}|${L.term}`);
    const b = branchId.get(L.branch);
    const amountPaise = L.schedule.reduce((t, s) => t + s.principalPaise, 0);
    const totalPayable = L.schedule.reduce((t, s) => t + s.installmentPaise, 0);
    const personal = L.id.startsWith('UDGAMPL');
    const reqId = oid(); const payId = oid(); seq += 1;
    const emp = L.rows[L.rows.length - 1].collector || 'LEGACY';
    const note = 'Derived from the collection sheets; the loan terms are estimated';
    reqDocs.push({
      _id: reqId, kind: personal ? 'personal' : 'group', formId: L.id, branch: b, loanDate: L.loanDate,
      ...(personal ? { member: m, borrower: { code: L.member, name: L.name, state: 'Bihar', mobile: '' } } : { groupInfo: { code: '', name: '', leaderName: '', employeeCode: emp, meetingType: L.mode, members: [{ code: L.member, name: L.name }] }, members: [m], memberCount: 1, totalAmountPaise: amountPaise }),
      previousLoanPaise: 0, scheme: sc.id, schemeCode: sc.code, schemeName: sc.name, amountPaise, mode: L.mode, term: L.term, annualRateBp: sc.rBp, installmentPaise: L.inst, calculationType: 'flat', emiType: 'equal',
      totalInterestPaise: totalPayable - amountPaise, totalPayablePaise: totalPayable, processingFeePaise: 0, legalFeePaise: 0, insuranceFeePaise: 0, securityAmountPaise: 0, cashPaise: amountPaise, securityType: 'none',
      employeeCode: emp, decidedAt: L.loanDate, decidedByCode: 'LEGACY', disbursedAt: L.loanDate, status: 'approved', memberForms: [], additionalProducts: [], isDeleted: false, estimated: true, estimateNote: note, ...stamp(L.loanDate),
    });
    const pay = {
      _id: payId, receiptNo: `CSLOAN-${String(seq).padStart(6, '0')}`, loanId: L.id, requisition: reqId, formId: L.id, kind: personal ? 'personal' : 'group', branch: b, paidOn: L.loanDate, emiStartDate: L.schedule[0].dueDate, emiEndDate: L.schedule[L.term - 1].dueDate,
      installments: L.term, modeLabel: L.mode === 'daily' ? 'Daily' : 'Weekly', mode: L.mode, loanType: personal ? 'personal' : 'group', schemeName: sc.name, annualRateBp: sc.rBp, installmentPaise: L.inst, payMode: 'cash', reference: 'Old system (estimated from collection sheets)',
      schedule: L.schedule,
      lines: [{ member: m, code: L.member, name: L.name, amountPaise, processingFeePaise: 0, legalFeePaise: 0, insuranceFeePaise: 0, securityPaise: 0, productPaise: 0, products: [], cashPaise: amountPaise, extraEmiPaise: 0 }],
      totalAmountPaise: amountPaise, totalCashPaise: amountPaise, status: 'paid', employeeCode: emp, createdByCode: 'LEGACY', estimated: true, estimateNote: note, confidence: L.confidence, ...stamp(L.loanDate),
    };
    payDocs.push(pay); payOf.set(L.id, pay);
  }

  const emiDocs = emis.map((e, i) => {
    const { L, r, items } = e; const p = payOf.get(L.id);
    return {
      _id: oid(), receiptNo: `CSEMI-${String(i + 1).padStart(7, '0')}`, loanPayment: p._id, loanId: L.id, formId: L.id, branch: branchId.get(r.branch), type: items.some((x) => x.dueDate > r.date) ? 'advance' : 'regular',
      member: memberId.get(L.member), memberCode: L.member, memberName: r.name, group: '', installments: items.map((x) => x.no), items, amountPaise: r.pay, paidOn: r.date, payMode: 'cash', reference: `Collection sheet ${r.month}`, status: 'paid',
      legacy: false, npa: false, employeeCode: r.collector || undefined, createdByCode: r.collector || 'LEGACY', ...stamp(r.date),
    };
  });

  const sizeMb = (docs) => (docs.reduce((t, d) => t + BSON.calculateObjectSize(d), 0) / 1048576).toFixed(1);
  const lowConf = loans.filter((l) => l.confidence === 'low').length;
  const adv = emiDocs.filter((d) => d.type === 'advance').length;
  console.log(`\nbranches ${branchDocs.length}, staff stubs ${userDocs.length}, members ${memberDocs.length}, schemes ${schemeDocs.length}, requisitions ${reqDocs.length}, loan payments ${payDocs.length}, EMI ${emiDocs.length}`);
  console.log(`data size (MB): loanpayments ${sizeMb(payDocs)}, requisitions ${sizeMb(reqDocs)}, emipayments ${sizeMb(emiDocs)}, members ${sizeMb(memberDocs)}`);
  console.log(`loans with a guessed installment (one payment or no repeated amount): ${lowConf}; loans by mode: ${JSON.stringify(Object.fromEntries(['daily', 'weekly'].map((m) => [m, loans.filter((l) => l.mode === m).length])))}; loans longer than the table term: ${loans.filter((l) => l.term > (l.mode === 'daily' ? 120 : l.ratio >= 0.3 ? 50 : 30)).length}; EMI records marked advance: ${adv}`);
  if (DRY) { console.log('\nDry run finished: nothing was written.'); await mongoose.disconnect(); return; }

  // ---- write
  for (const c of COLLECTIONS) await col(c).deleteMany({ [FLAG]: true });
  async function insert(name, docs, size = 1000) {
    let ok = 0;
    for (let i = 0; i < docs.length; i += size) { const r = await col(name).insertMany(docs.slice(i, i + size), { ordered: true }); ok += r.insertedCount; }
    console.log(`  ${name}: ${ok} of ${docs.length}`);
    if (ok !== docs.length) throw new Error(`${name}: not everything was saved`);
  }
  try { await col('members').dropIndex('aadhaar_1'); } catch { /* not there */ }
  await col('members').createIndex({ aadhaar: 1 }, { unique: true, partialFilterExpression: { isDeleted: false, aadhaar: { $type: 'string' } } });
  await insert('branches', branchDocs); await insert('users', userDocs); await insert('members', memberDocs); await insert('loanschemes', schemeDocs);
  await insert('loanrequisitions', reqDocs, 200); await insert('loanpayments', payDocs, 100); await insert('emipayments', emiDocs, 2000);
  console.log('\nDone. Staff accounts are switched off (no password known); members have no mobile, Aadhaar or group.');
  await mongoose.disconnect();
}

main().catch(async (err) => { console.error('Import failed:', err.message); try { await mongoose.disconnect(); } catch { /* */ } process.exit(1); });
