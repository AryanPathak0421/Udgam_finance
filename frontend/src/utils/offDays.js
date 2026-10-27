import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';

const DAY = 24 * 3600 * 1000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const at = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };

/**
 * Sundays and the holidays of the Holiday Master are days off: a date chosen on one of them moves to the next working day.
 * `skip(date)` gives that day; `reason(date)` says why a date is off ('Sunday' or the name of the holiday), '' for a working day.
 * The holidays are read once for a year back and a year ahead (those of every branch, and of the branch given).
 */
export default function useOffDays(branch) {
  const [holidays, setHolidays] = useState(() => new Map());
  useEffect(() => {
    const from = iso(Date.now() - 366 * DAY);
    const to = iso(Date.now() + 366 * DAY);
    let live = true;
    api.offDays({ from, to, branch: branch || undefined })
      .then((r) => { if (live) setHolidays(new Map((r.items || []).map((h) => [h.date, h.name]))); })
      .catch(() => { if (live) setHolidays(new Map()); });
    return () => { live = false; };
  }, [branch]);
  const reason = useCallback((s) => {
    if (!s) return '';
    if (new Date(at(s)).getUTCDay() === 0) return 'Sunday';
    return holidays.get(s) || '';
  }, [holidays]);
  const skip = useCallback((s) => {
    if (!s) return s;
    let t = at(s);
    for (let i = 0; i < 31 && reason(iso(t)); i += 1) t += DAY;
    return iso(t);
  }, [reason]);
  return useMemo(() => ({ reason, skip, count: holidays.size }), [reason, skip, holidays]);
}
