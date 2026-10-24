import { api } from '../api/client.js';

// The date a branch works on (the day after its last approved day close). Only the other users are held to it; the admin gets none.
let cache = null;
export async function loadWorkDates(fresh = false) {
  if (cache && !fresh) return cache;
  try { cache = await api.dayClose.workingDates(); } catch { cache = { restricted: false, items: [] }; }
  return cache;
}
/** The working date for a branch id, or for the only branch of the user when none is given; null = no restriction. */
export async function workDateOf(branchId) {
  const r = await loadWorkDates();
  if (!r.restricted) return null;
  const mine = r.items.filter((i) => i.workingDate);
  const hit = branchId ? r.items.find((i) => String(i.branch.id) === String(branchId)) : r.items.length === 1 ? r.items[0] : null;
  return hit?.workingDate || (branchId ? null : mine.length === 1 ? mine[0].workingDate : null);
}
