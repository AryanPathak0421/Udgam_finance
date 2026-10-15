import { INDIA_LOCATIONS } from '../data/indiaLocations.js';

/**
 * Public-data lookups used while registering a member.
 *  - pincode -> state / district   (India Post data via api.postalpincode.in)
 *  - IFSC    -> bank / branch      (ifsc.razorpay.com, free, no key)
 *
 * They are best effort: when the service cannot be reached the result is `unavailable`, and
 * registration carries on without the verification (it is never blocked by an outage).
 * Only the public code is sent out — never an account number, PAN or personal data.
 */
const TIMEOUT_MS = 4000;
const CACHE_MS = 60 * 60 * 1000;
const cache = new Map();

async function getJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (res.status === 404) return { notFound: true };
    if (!res.ok) return { error: true };
    return { data: await res.json() };
  } catch {
    return { error: true };
  } finally {
    clearTimeout(t);
  }
}

function remember(key, value) {
  cache.set(key, { value, at: Date.now() });
  return value;
}
function recall(key) {
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < CACHE_MS ? hit.value : null;
}

const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');

/** The state name as used in our own state list (or null). */
export function matchState(name) {
  const n = norm(name);
  if (!n) return null;
  return Object.keys(INDIA_LOCATIONS).find((s) => norm(s) === n) || null;
}

/** The district name as used in our own list for a state (or null). */
export function matchDistrict(state, name) {
  const list = INDIA_LOCATIONS[state] || [];
  const n = norm(name);
  if (!n) return null;
  return list.find((d) => norm(d) === n) || list.find((d) => norm(d).startsWith(n) || n.startsWith(norm(d))) || null;
}

export async function lookupPincode(pin) {
  const key = `pin:${pin}`;
  const hit = recall(key);
  if (hit) return hit;

  const r = await getJson(`https://api.postalpincode.in/pincode/${pin}`);
  if (r.error || r.notFound) return { status: 'unavailable' };
  const row = Array.isArray(r.data) ? r.data[0] : null;
  if (!row) return { status: 'unavailable' };
  if (row.Status !== 'Success' || !Array.isArray(row.PostOffice) || row.PostOffice.length === 0) {
    return remember(key, { status: 'invalid' });
  }
  const po = row.PostOffice[0];
  const state = matchState(po.State) || po.State;
  const district = matchDistrict(state, po.District) || null;
  return remember(key, {
    status: 'ok',
    state,
    stateKnown: Boolean(matchState(po.State)),
    district, // our spelling, or null when the postal name has no match in our list
    postalDistrict: po.District,
    areas: [...new Set(row.PostOffice.map((p) => p.Name))].slice(0, 10),
  });
}

export async function lookupIfsc(code) {
  const key = `ifsc:${code}`;
  const hit = recall(key);
  if (hit) return hit;

  const r = await getJson(`https://ifsc.razorpay.com/${encodeURIComponent(code)}`);
  if (r.notFound) return remember(key, { status: 'invalid' });
  if (r.error || !r.data || typeof r.data !== 'object') return { status: 'unavailable' };
  return remember(key, {
    status: 'ok',
    bank: r.data.BANK || '',
    branch: r.data.BRANCH || '',
    city: r.data.CITY || '',
    district: r.data.DISTRICT || '',
    state: r.data.STATE || '',
  });
}
