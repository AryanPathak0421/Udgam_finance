/**
 * Civil score from the credit bureau, with the borrower's PAN number and phone number (the phone number gets an OTP first: the borrower's consent).
 *
 * The civil check API is a paid service of a provider. Its address, key and the shape of its answer come from that provider's documents, so they are
 * not guessed here: they are set in the environment. Until they are set the answer is `unavailable` and the score is recorded by hand.
 *
 *   CIVIL_API_URL          the address of the provider's civil score call (placeholders {{pan}} {{mobile}} {{name}} may be used in it for a GET)
 *   CIVIL_API_METHOD       POST (default) or GET
 *   CIVIL_API_KEY          the key; sent in the header CIVIL_API_KEY_HEADER (default x-api-key; use Authorization with "Bearer ..." as the key if needed)
 *   CIVIL_API_BODY         the JSON body of a POST, with {{pan}} {{mobile}} {{name}} placeholders
 *                          (default {"pan":"{{pan}}","mobile":"{{mobile}}","name":"{{name}}"})
 *   CIVIL_SCORE_PATH       where the score is in the answer, e.g. data.score
 *   CIVIL_REPORT_PATH      (optional) where the report number is, e.g. data.reportId
 *   CIVIL_BUREAU_NAME      CIBIL (default), Equifax, Experian, CRIF High Mark or Other
 */
import { BUREAUS } from '../models/CivilCheck.js';

export const civilApiConfigured = () => Boolean(process.env.CIVIL_API_URL && process.env.CIVIL_SCORE_PATH);

const fill = (tpl, vars, encode) => String(tpl).replace(/\{\{(\w+)\}\}/g, (_, k) => {
  const v = String(vars[k] ?? '');
  return encode ? encodeURIComponent(v) : JSON.stringify(v).slice(1, -1);
});
const pick = (obj, path) => String(path).split('.').reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);

/** Returns { status: 'ok', score, reportNumber, bureau } | { status: 'unavailable' } | { status: 'error', message }. */
export async function fetchCivilScore({ pan, mobile, name }) {
  if (!civilApiConfigured()) return { status: 'unavailable' };
  const vars = { pan, mobile, name };
  const method = (process.env.CIVIL_API_METHOD || 'POST').toUpperCase();
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  if (process.env.CIVIL_API_KEY) headers[process.env.CIVIL_API_KEY_HEADER || 'x-api-key'] = process.env.CIVIL_API_KEY;
  const url = method === 'GET' ? fill(process.env.CIVIL_API_URL, vars, true) : process.env.CIVIL_API_URL;
  const body = method === 'GET' ? undefined : fill(process.env.CIVIL_API_BODY || '{"pan":"{{pan}}","mobile":"{{mobile}}","name":"{{name}}"}', vars, false);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30000);
  let res;
  let json = null;
  try {
    res = await fetch(url, { method, headers, body, signal: ctl.signal });
    json = await res.json().catch(() => null);
  } catch (err) {
    return { status: 'error', message: err.name === 'AbortError' ? 'The civil check service did not answer in time. Please try again.' : 'The civil check service could not be reached. Please try again.' };
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return { status: 'error', message: String(json?.message || json?.error || `The civil check service refused the request (${res.status}).`).slice(0, 200) };
  const score = Number(pick(json, process.env.CIVIL_SCORE_PATH));
  if (!Number.isInteger(score) || score < 300 || score > 900) return { status: 'error', message: 'The civil check service did not return a score for this PAN (no credit history, or the details do not match).' };
  const reportNumber = process.env.CIVIL_REPORT_PATH ? String(pick(json, process.env.CIVIL_REPORT_PATH) ?? '').slice(0, 40) : '';
  const bureau = BUREAUS.includes(process.env.CIVIL_BUREAU_NAME) ? process.env.CIVIL_BUREAU_NAME : 'CIBIL';
  return { status: 'ok', score, reportNumber, bureau };
}
