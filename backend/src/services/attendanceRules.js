/**
 * The attendance rules of the company, in one place (the attendance screen and the salary use the same):
 *  - a working day with no attendance (not marked in the app, not marked by hand) is an ABSENT day, by itself;
 *  - a Sunday is the paid weekly off, a holiday of the Holiday Master is paid;
 *  - an employee who is absent on a Saturday without leave loses the Sunday and the Monday after it too (both are absent);
 *    when the leave was applied and approved the Saturday is a leave day and everything stays as it is;
 *  - what an admin / manager marks by hand is never changed by these rules (the Monday of a Saturday absence is the one day the rule also takes
 *    from the app / automatic marks).
 * `marks` is a Map of 'YYYY-MM-DD' -> { status, source }.
 */
const DAY = 24 * 3600 * 1000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);

/** The day as it is without the Saturday rule: what was marked, else the weekly off, a holiday or an absent day. null = the employee was not employed that day. */
export function baseOn(day, emp, marks, holidays) {
  if (emp.joiningDate && day < new Date(emp.joiningDate)) return null;
  if (emp.leftOn && day > new Date(emp.leftOn)) return null;
  const m = marks.get(iso(day));
  if (m) return { status: m.status, source: m.source || 'manual', marked: true };
  if (day.getUTCDay() === 0) return { status: 'sunday', source: 'off', marked: false };
  if (holidays.has(iso(day))) return { status: 'holiday', source: 'off', marked: false };
  return { status: 'absent', source: 'auto', marked: false };
}

/** The day with the Saturday rule: { status, source ('manual' | 'app' | 'auto' | 'off' | 'rule'), marked, reason }. */
export function effectiveOn(day, emp, marks, holidays) {
  const base = baseOn(day, emp, marks, holidays);
  if (!base) return null;
  const dow = day.getUTCDay();
  const absentSaturday = (sat) => {
    const s = baseOn(sat, emp, marks, holidays);
    return Boolean(s && s.status === 'absent');
  };
  // Sunday after an unplanned Saturday absence: the weekly off is lost (only when nothing was marked on the Sunday)
  if (dow === 0 && !base.marked && absentSaturday(new Date(day.getTime() - DAY))) return { status: 'absent', source: 'rule', marked: false, reason: 'Absent on Saturday without leave' };
  // Monday after it: absent too, unless it is a leave day, a holiday or was marked by hand
  if (dow === 1 && base.source !== 'manual' && !['leave', 'holiday'].includes(base.status) && absentSaturday(new Date(day.getTime() - 2 * DAY))) return { status: 'absent', source: 'rule', marked: false, reason: 'Absent on Saturday without leave' };
  return base;
}

/** The days of a month as the salary counts them. */
export function monthDays(emp, marks, range, holidays) {
  const out = { sundays: 0, present: 0, half: 0, leave: 0, holiday: 0, absent: 0, unmarked: 0, ruleAbsent: 0 };
  for (let i = 0; i < range.days; i += 1) {
    const eff = effectiveOn(new Date(range.from.getTime() + i * DAY), emp, marks, holidays);
    if (!eff) continue;
    if (eff.status === 'sunday') out.sundays += 1;
    else if (eff.status === 'present') out.present += 1;
    else if (eff.status === 'half_day') out.half += 1;
    else if (eff.status === 'leave') out.leave += 1;
    else if (eff.status === 'holiday') out.holiday += 1;
    else {
      out.absent += 1;
      if (eff.source === 'auto') out.unmarked += 1;
      if (eff.source === 'rule') out.ruleAbsent += 1;
    }
  }
  return out;
}
