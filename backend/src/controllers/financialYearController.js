import { FinancialYear } from '../models/FinancialYear.js';
import { createValidator, parseDateOnly, HttpError } from '../utils/http.js';
import { audit } from '../utils/audit.js';

const MAX_DAYS = 458; // up to 15 months, as permitted for a first/extended financial year
const DAY_MS = 24 * 60 * 60 * 1000;

const iso = (d) => d.toISOString().slice(0, 10);

const present = (fy) => ({
  id: fy._id,
  financialYearId: fy.financialYearId,
  name: fy.name,
  startDate: iso(fy.startDate),
  endDate: iso(fy.endDate),
  isActive: fy.isActive,
  createdAt: fy.createdAt,
  updatedAt: fy.updatedAt,
});

// "2025-26" when the period spans two calendar years, otherwise "2025".
function buildName(start, end) {
  const sy = start.getUTCFullYear();
  const ey = end.getUTCFullYear();
  return sy === ey ? String(sy) : `${sy}-${String(ey).slice(-2)}`;
}

function readDates(body) {
  const v = createValidator();
  const startDate = parseDateOnly(body?.startDate);
  const endDate = parseDateOnly(body?.endDate);
  if (!startDate) v.add('startDate', 'Enter a valid start date');
  if (!endDate) v.add('endDate', 'Enter a valid end date');
  if (startDate && endDate) {
    if (endDate <= startDate) v.add('endDate', 'End date must be after the start date');
    else if ((endDate - startDate) / DAY_MS + 1 > MAX_DAYS) v.add('endDate', 'A financial year cannot exceed 15 months');
  }
  v.throwIfAny();
  return { startDate, endDate };
}

async function assertNoOverlap(startDate, endDate, excludeId) {
  const filter = { startDate: { $lte: endDate }, endDate: { $gte: startDate } };
  if (excludeId) filter._id = { $ne: excludeId };
  const clash = await FinancialYear.findOne(filter);
  if (clash) {
    throw new HttpError(409, `Dates overlap with financial year ${clash.name}`, {
      startDate: `Overlaps with ${clash.name} (${iso(clash.startDate)} to ${iso(clash.endDate)})`,
    });
  }
}

async function uniqueId(base) {
  let candidate = `FY${base}`;
  let n = 2;
  while (await FinancialYear.exists({ financialYearId: candidate })) {
    candidate = `FY${base}-${n++}`;
  }
  return candidate;
}

export async function listFinancialYears(_req, res) {
  const items = await FinancialYear.find().sort({ startDate: -1 });
  res.json({ items: items.map(present) });
}

export async function getActiveFinancialYear(_req, res) {
  const fy = await FinancialYear.findOne({ isActive: true });
  res.json({ financialYear: fy ? present(fy) : null });
}

export async function previewFinancialYear(req, res) {
  const startDate = parseDateOnly(req.query.startDate);
  const endDate = parseDateOnly(req.query.endDate);
  if (!startDate || !endDate || endDate <= startDate) return res.json({ name: null, financialYearId: null });
  const name = buildName(startDate, endDate);
  res.json({ name, financialYearId: await uniqueId(name) });
}

export async function createFinancialYear(req, res) {
  const { startDate, endDate } = readDates(req.body);
  await assertNoOverlap(startDate, endDate);

  const name = buildName(startDate, endDate);
  const financialYearId = await uniqueId(name);
  const hasActive = await FinancialYear.exists({ isActive: true });

  let fy;
  try {
    fy = await FinancialYear.create({
      financialYearId,
      name,
      startDate,
      endDate,
      isActive: !hasActive, // first year becomes active automatically
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
  } catch (err) {
    if (err.code === 11000) throw new HttpError(409, 'Financial year already exists');
    throw err;
  }
  await audit(req, { action: 'financialYear.create', entity: 'FinancialYear', entityId: fy._id, after: fy });
  res.status(201).json({ financialYear: present(fy) });
}

export async function updateFinancialYear(req, res) {
  const fy = await FinancialYear.findById(req.params.id);
  if (!fy) throw new HttpError(404, 'Financial year not found');

  const { startDate, endDate } = readDates(req.body);
  await assertNoOverlap(startDate, endDate, fy._id);

  const before = fy.toObject();
  // The generated ID stays stable (it may be referenced elsewhere); the name follows the dates.
  fy.startDate = startDate;
  fy.endDate = endDate;
  fy.name = buildName(startDate, endDate);
  fy.updatedBy = req.user._id;
  await fy.save();
  await audit(req, { action: 'financialYear.update', entity: 'FinancialYear', entityId: fy._id, before, after: fy });
  res.json({ financialYear: present(fy) });
}

export async function activateFinancialYear(req, res) {
  const fy = await FinancialYear.findById(req.params.id);
  if (!fy) throw new HttpError(404, 'Financial year not found');
  if (fy.isActive) return res.json({ financialYear: present(fy) });

  const previous = await FinancialYear.findOne({ isActive: true });
  // Deactivate first so the partial unique index (one active year) is never violated.
  if (previous) await FinancialYear.updateOne({ _id: previous._id }, { isActive: false, updatedBy: req.user._id });
  try {
    fy.isActive = true;
    fy.updatedBy = req.user._id;
    await fy.save();
  } catch (err) {
    if (previous) await FinancialYear.updateOne({ _id: previous._id }, { isActive: true });
    throw err;
  }
  await audit(req, {
    action: 'financialYear.activate',
    entity: 'FinancialYear',
    entityId: fy._id,
    before: previous ? { activeId: previous.financialYearId } : undefined,
    after: { activeId: fy.financialYearId },
  });
  res.json({ financialYear: present(fy) });
}

export async function deleteFinancialYear(req, res) {
  const fy = await FinancialYear.findById(req.params.id);
  if (!fy) throw new HttpError(404, 'Financial year not found');
  if (fy.isActive) throw new HttpError(409, 'The active financial year cannot be deleted. Activate another year first.');

  await fy.deleteOne();
  await audit(req, { action: 'financialYear.delete', entity: 'FinancialYear', entityId: fy._id, before: fy });
  res.json({ message: 'Financial year deleted' });
}
