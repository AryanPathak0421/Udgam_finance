import { DayClose } from '../models/DayClose.js';
import { HttpError } from '../utils/http.js';

const DAY = 24 * 3600 * 1000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);

/** No entry can be made for a day a branch has closed (made its denomination for) or for any day before it. Head office has no day close. */
export async function assertDayOpen(branchId, date) {
  if (!branchId) return;
  const closed = await DayClose.findOne({ branch: branchId, date: { $gte: date }, status: { $in: ['submitted', 'approved'] } }).select('date status').lean();
  if (closed) {
    throw new HttpError(409, `The day ${iso(closed.date)} of this branch is closed${closed.status === 'submitted' ? ' (waiting for the admin)' : ''}. Entries can be made for ${iso(new Date(closed.date.getTime() + DAY))} onwards.`, { date: 'This day is closed' });
  }
}
