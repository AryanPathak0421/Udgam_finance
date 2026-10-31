import { api } from '../api/client.js';

// The date a branch works on (the day after its last approved day close, or a revoked day).
let cache = null;
export async function loadWorkDates(fresh = true) {
  if (cache && !fresh) return cache;
  try { cache = await api.dayClose.workingDates(); } catch { cache = { restricted: false, items: [] }; }
  return cache;
}
/** The working date for a branch id, or for the only branch of the user when none is given; null = no restriction. */
export async function workDateOf(branchId) {
  const r = await loadWorkDates(true);
  const items = r.items || [];
  const hit = branchId
    ? items.find((i) => String(i.branch?.id || i.branch?._id) === String(branchId))
    : items.length === 1 ? items[0] : null;
  return hit?.workingDate || (branchId ? null : items.find((i) => i.workingDate)?.workingDate || null);
}
