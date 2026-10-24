/**
 * Heavy reports (thousands of loans) can take longer than the gateway in front of the API waits, which shows as "Something went wrong".
 * A heavy report is therefore worked out in the background: the request waits a while and, when the report is not ready, answers "pending";
 * the page asks again (poll) until the report is there. A report is always worked out fresh by a request that is not a poll.
 */
const running = new Map(); // key -> promise
const results = new Map(); // key -> { at, data }
const failures = new Map(); // key -> error
const KEEP_MS = 3 * 60 * 1000; // a finished report is kept this long for the poll to pick it up

export async function slowRun(key, compute, { poll = false, waitMs = 15000 } = {}) {
  // clean old results
  const now = Date.now();
  for (const [k, v] of results) if (now - v.at > KEEP_MS) results.delete(k);
  if (failures.has(key)) { const err = failures.get(key); failures.delete(key); throw err; }
  if (poll) {
    const hit = results.get(key);
    if (hit) return { done: true, data: hit.data };
  }
  let p = running.get(key);
  if (!p) {
    p = compute()
      .then((data) => { results.set(key, { at: Date.now(), data }); failures.delete(key); return data; })
      .catch((err) => { failures.set(key, err); throw err; })
      .finally(() => running.delete(key));
    running.set(key, p);
    p.catch(() => {}); // a failure is handed to whoever asks next
  }
  const out = await Promise.race([p.then((data) => ({ done: true, data })), new Promise((resolve) => { setTimeout(() => resolve({ done: false }), waitMs); })]);
  if (out.done) results.delete(key);
  return out;
}
