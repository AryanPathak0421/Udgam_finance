import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import FormField from '../components/ui/FormField.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';

const BUREAUS = ['CIBIL', 'Equifax', 'Experian', 'CRIF High Mark', 'Other'];
const CREATORS = ['super_admin', 'admin', 'branch_manager', 'loan_officer', 'field_officer'];
const BAND_TONE = { excellent: 'green', good: 'green', fair: 'grey', poor: 'danger' };
const todayISO = () => new Date().toISOString().slice(0, 10);

function ScoreCard({ check }) {
  if (!check) return <div className="notice">No civil check has been recorded for this member yet.</div>;
  return (
    <div className="panel" style={{ padding: 16, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1 }}>{check.score}</div>
      <div>
        <span className={`badge ${BAND_TONE[check.band.key]}`}>{check.band.label}</span>
        <div className="muted small" style={{ marginTop: 6 }}>
          {check.bureau} · report of {check.reportDate} ({check.daysOld === 0 ? 'today' : `${check.daysOld} day${check.daysOld === 1 ? '' : 's'} old`})
        </div>
      </div>
    </div>
  );
}

// The first step of a loan requisition: the borrower's civil (credit bureau) score.
export default function CivilCheck() {
  const toast = useToast();
  const { user } = useAuth();
  const canAdd = CREATORS.includes(user?.role);
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);

  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ score: '', reportDate: todayISO(), bureau: 'CIBIL', reportNumber: '', remark: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const q = useDebounce(search);

  useEffect(() => {
    if (data) return undefined;
    let live = true;
    setSearching(true);
    api.members
      .list({ q, limit: 10 })
      .then((r) => live && setResults(r.items))
      .catch(() => live && setResults([]))
      .finally(() => live && setSearching(false));
    return () => {
      live = false;
    };
  }, [q, data]);

  async function open(id) {
    setError('');
    try {
      setData(await api.civilChecks.member(id));
      setForm({ score: '', reportDate: todayISO(), bureau: 'CIBIL', reportNumber: '', remark: '' });
      setErrors({});
    } catch (err) {
      setError(err.message);
    }
  }

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  async function submit(e) {
    e.preventDefault();
    const found = {};
    const s = Number(form.score);
    if (!Number.isInteger(s) || s < 300 || s > 900) found.score = 'Enter the civil score (300 to 900)';
    if (!form.reportDate) found.reportDate = 'Enter the date of the report';
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      await api.civilChecks.add({ ...form, member: data.member.id, score: s });
      toast.success('Civil check saved');
      setData(await api.civilChecks.member(data.member.id));
      setForm((f) => ({ ...f, score: '', reportNumber: '', remark: '' }));
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    try {
      await api.civilChecks.remove(id);
      toast.success('Civil check deleted');
      setData(await api.civilChecks.member(data.member.id));
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (!data) {
    return (
      <>
        <PageHeader title="Civil Check" description="Look up the civil (credit bureau) score of a borrower before a loan requisition. Search by member code, name, mobile, Aadhaar or PAN." />
        <div className="panel">
          <div className="toolbar">
            <input type="search" className="toolbar-search" placeholder="Search by member code, name, form ID, mobile, Aadhaar number (or last 4 digits) or PAN" value={search}
              onChange={(e) => setSearch(e.target.value)} autoFocus aria-label="Search member" />
          </div>
          {error && <ErrorState message={error} />}
          {searching && !results.length ? (
            <Spinner label="Searching…" />
          ) : results.length === 0 ? (
            <EmptyState title="No members found" description="Try the member code, name or mobile number." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Member code</th><th>Name</th><th>Branch</th><th>Mobile</th><th className="actions-col">Actions</th></tr></thead>
                <tbody>
                  {results.map((m) => (
                    <tr key={m.id}>
                      <td data-label="Code"><strong>{m.code}</strong></td>
                      <td data-label="Name">{m.name}{m.matchedVia === 'guarantor' && <div className="muted small">found via guarantor</div>}</td>
                      <td data-label="Branch">{m.branch?.name || '—'}</td>
                      <td data-label="Mobile">{m.mobile}</td>
                      <td data-label="Actions" className="actions-col"><button className="btn sm primary" onClick={() => open(m.id)}>Check</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>
    );
  }

  const m = data.member;
  return (
    <>
      <PageHeader
        title={`${m.name} — ${m.code}`}
        description={`${m.branch?.name || ''} · ${m.mobile}`}
        actions={<button className="btn" onClick={() => setData(null)}>Check another member</button>}
      />
      {m.isBlocked && <div className="notice warn">This member is blocked.</div>}
      <ScoreCard check={data.latest} />

      {canAdd && (
        <form onSubmit={submit} noValidate className="panel" style={{ padding: 18, margin: '14px 0' }}>
          <h3 className="section-title">Record a civil check</h3>
          <div className="form-grid">
            <FormField id="score" label="Civil score" required error={errors.score} hint="300 to 900">
              <input id="score" inputMode="numeric" maxLength={3} value={form.score}
                onChange={(e) => { setForm((f) => ({ ...f, score: e.target.value.replace(/\D/g, '').slice(0, 3) })); setErrors((er) => ({ ...er, score: undefined })); }} />
            </FormField>
            <FormField id="reportDate" label="Report date" required error={errors.reportDate}>
              <input id="reportDate" type="date" max={todayISO()} value={form.reportDate} onChange={set('reportDate')} />
            </FormField>
            <FormField id="bureau" label="Bureau" error={errors.bureau}>
              <select id="bureau" value={form.bureau} onChange={set('bureau')}>
                {BUREAUS.map((b) => <option key={b}>{b}</option>)}
              </select>
            </FormField>
            <FormField id="reportNumber" label="Report number" error={errors.reportNumber} hint="Optional">
              <input id="reportNumber" value={form.reportNumber} onChange={set('reportNumber')} maxLength={40} />
            </FormField>
            <FormField id="remark" label="Remark" error={errors.remark} className="span-2" hint="Optional">
              <input id="remark" value={form.remark} onChange={set('remark')} maxLength={200} />
            </FormField>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save civil check'}</button>
          </div>
        </form>
      )}

      <div className="panel" style={{ marginTop: 14 }}>
        <h3 className="section-title" style={{ margin: 16 }}>History ({data.items.length})</h3>
        {data.items.length === 0 ? (
          <EmptyState title="No civil checks yet" />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Report date</th><th className="num">Score</th><th>Rating</th><th>Bureau</th><th>Report no.</th><th>Remark</th><th>Recorded by</th>{isAdmin && <th className="actions-col">Actions</th>}</tr></thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id}>
                    <td data-label="Report date">{c.reportDate}</td>
                    <td data-label="Score" className="num"><strong>{c.score}</strong></td>
                    <td data-label="Rating"><span className={`badge ${BAND_TONE[c.band.key]}`}>{c.band.label}</span></td>
                    <td data-label="Bureau">{c.bureau}</td>
                    <td data-label="Report no.">{c.reportNumber || '—'}</td>
                    <td data-label="Remark">{c.remark || '—'}</td>
                    <td data-label="By">{c.employeeCode || '—'}</td>
                    {isAdmin && <td data-label="Actions" className="actions-col"><button className="btn sm danger-outline" onClick={() => remove(c.id)}>Delete</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
