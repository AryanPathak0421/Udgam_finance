import FormField from './ui/FormField.jsx';
import { EmployeeSelect } from '../pages/NewBorrower.jsx';

export const WEEKDAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const MEETING_LABEL = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
export const todayISO = () => new Date().toISOString().slice(0, 10);

export const EMPTY_GROUP = {
  branch: '', name: '', openingDate: todayISO(), employeeCode: '', leaderName: '', leaderMobile: '',
  meetingType: '', collectionDay: '', meetingTime: '',
};

export function collectionLabel(g) {
  if (g.meetingType === 'weekly') return WEEKDAYS[g.collectionDay] || '—';
  if (g.meetingType === 'monthly') return g.collectionDay ? `Day ${g.collectionDay}` : '—';
  if (g.meetingType === 'daily') return 'Every day';
  return '—';
}

export const formatTime = (t) => {
  if (!/^\d{2}:\d{2}$/.test(t || '')) return '—';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/** Client-side check; returns {field: message}. */
export function validateGroup(f, { isEdit, mobileLocked }) {
  const e = {};
  if (f.name.trim().length < 2) e.name = 'Group name is required';
  if (!f.branch) e.branch = 'Select a branch';
  if (!f.employeeCode) e.employeeCode = 'Select the employee';
  if (f.leaderName.trim().length < 2) e.leaderName = 'Group leader name is required';
  if (!mobileLocked && !/^[6-9]\d{9}$/.test(f.leaderMobile)) e.leaderMobile = 'Enter a valid 10-digit mobile number';
  if (!f.meetingType) e.meetingType = 'Select the meeting type';
  if (f.meetingType === 'weekly' && !f.collectionDay) e.collectionDay = 'Select the collection day';
  if (f.meetingType === 'monthly' && !f.collectionDay) e.collectionDay = 'Select the day of the month';
  if (!/^\d{2}:\d{2}$/.test(f.meetingTime)) e.meetingTime = 'Enter the meeting time';
  if (!isEdit && !f.openingDate) e.openingDate = 'Enter the opening date';
  return e;
}

/** The fields of the group form (shared by Create Group and the Group List edit dialog). */
export default function GroupFields({ form, setForm, errors, setErrors, branches, isAdmin, isEdit, groupCode, branchLocked = false }) {
  const set = (key) => (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [key]: value, ...(key === 'meetingType' ? { collectionDay: '' } : {}) }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };
  const mobileLocked = isEdit && !isAdmin;

  return (
    <div className="form-grid">
      <FormField id="gcode" label="Group code" hint={isEdit ? undefined : 'Generated automatically on save'}>
        <input id="gcode" value={isEdit ? groupCode : 'Auto'} disabled />
      </FormField>
      <FormField id="branch" label="Branch" required error={errors.branch}>
        <select id="branch" value={form.branch} onChange={(e) => { set('branch')(e); setForm((f) => ({ ...f, employeeCode: '' })); }} disabled={branchLocked}>
          <option value="">Select branch</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
        </select>
      </FormField>
      <FormField id="name" label="Group name" required error={errors.name}>
        <input id="name" value={form.name} onChange={set('name')} maxLength={80} autoFocus={!isEdit} />
      </FormField>
      <FormField id="openingDate" label="Opening date" error={errors.openingDate} hint={isAdmin ? undefined : 'Only an admin can change the opening date'}>
        <input id="openingDate" type="date" max={todayISO()} value={form.openingDate} onChange={set('openingDate')} disabled={!isAdmin} />
      </FormField>
      <EmployeeSelect
        branch={form.branch}
        value={form.employeeCode}
        error={errors.employeeCode}
        onChange={(code) => { setForm((f) => ({ ...f, employeeCode: code })); setErrors((er) => ({ ...er, employeeCode: undefined })); }}
      />
      <FormField id="leaderName" label="Group leader name" required error={errors.leaderName}>
        <input id="leaderName" value={form.leaderName} onChange={set('leaderName')} maxLength={80} />
      </FormField>
      <FormField
        id="leaderMobile"
        label="Leader mobile number"
        required
        error={errors.leaderMobile}
        hint={mobileLocked ? 'Only an admin can change the registered mobile number' : 'Commission OTPs are sent to this number. After the group is created only an admin can change it'}
      >
        <input
          id="leaderMobile"
          value={form.leaderMobile}
          onChange={(e) => { setForm((f) => ({ ...f, leaderMobile: e.target.value.replace(/\D/g, '').slice(0, 10) })); setErrors((er) => ({ ...er, leaderMobile: undefined })); }}
          inputMode="numeric"
          maxLength={10}
          disabled={mobileLocked}
        />
      </FormField>
      <FormField id="meetingType" label="Meeting type" required error={errors.meetingType}>
        <select id="meetingType" value={form.meetingType} onChange={set('meetingType')}>
          <option value="">Select type</option>
          {Object.entries(MEETING_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </FormField>
      <FormField
        id="collectionDay"
        label="Collection day"
        required={form.meetingType === 'weekly' || form.meetingType === 'monthly'}
        error={errors.collectionDay}
        hint={form.meetingType === 'daily' ? 'Collection happens every day' : !form.meetingType ? 'Select the meeting type first' : undefined}
      >
        <select id="collectionDay" value={form.collectionDay} onChange={set('collectionDay')} disabled={form.meetingType !== 'weekly' && form.meetingType !== 'monthly'}>
          <option value="">{form.meetingType === 'daily' ? 'Every day' : 'Select day'}</option>
          {form.meetingType === 'weekly' && WEEKDAYS.slice(1).map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
          {form.meetingType === 'monthly' && Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>Day {i + 1}</option>)}
        </select>
      </FormField>
      <FormField id="meetingTime" label="Meeting time" required error={errors.meetingTime}>
        <input id="meetingTime" type="time" value={form.meetingTime} onChange={set('meetingTime')} />
      </FormField>
    </div>
  );
}
