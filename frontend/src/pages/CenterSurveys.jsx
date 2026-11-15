import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { todayIso } from '../utils/format.js';

const dmy = (s) => (s ? new Date(`${String(s).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN') : '—');
const today = () => todayIso();
const monthStart = () => `${todayIso().slice(0, 7)}-01`;
const STATUS = { surveyed: ['Surveyed', 'grey'], under_review: ['Under review', 'amber'], approved: ['Approved', 'green'], rejected: ['Rejected', 'danger'], formed: ['Center formed', 'green'] };
const Badge = ({ s }) => <span className={`badge ${STATUS[s]?.[1] || 'grey'}`}>{STATUS[s]?.[0] || s}</span>;

function SurveyForm({ branches, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ branch: branches.length === 1 ? branches[0].id : '', centerName: '', area: '', pincode: '', district: '', surveyDate: today(), expectedMembers: '', meetingType: '', leaderName: '', leaderMobile: '', remark: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  async function save() {
    setBusy(true);
    setErrors({});
    try {
      const r = await api.centerSurveys.create(f);
      toast.success(`Survey saved — ${r.survey.surveyNo}`);
      onSaved();
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title="New center survey" onClose={onClose} busy={busy}
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Close</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save survey'}</button></>}>
      <div className="form-grid">
        {branches.length > 1 && (
          <FormField id="svbranch" label="Branch" required error={errors.branch}>
            <select id="svbranch" value={f.branch} onChange={set('branch')}><option value="">Select</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}</select>
          </FormField>
        )}
        <FormField id="svname" label="Center name" required error={errors.centerName}><input id="svname" value={f.centerName} maxLength={100} onChange={set('centerName')} /></FormField>
        <FormField id="svarea" label="Village / area" error={errors.area}><input id="svarea" value={f.area} maxLength={100} onChange={set('area')} /></FormField>
        <FormField id="svpin" label="Pincode" error={errors.pincode}><input id="svpin" inputMode="numeric" value={f.pincode} onChange={(e) => { setF((x) => ({ ...x, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })); setErrors((x) => ({ ...x, pincode: undefined })); }} /></FormField>
        <FormField id="svdist" label="District" error={errors.district}><input id="svdist" value={f.district} maxLength={60} onChange={set('district')} /></FormField>
        <FormField id="svdate" label="Survey date" required error={errors.surveyDate}><input id="svdate" type="date" max={today()} value={f.surveyDate} onChange={set('surveyDate')} /></FormField>
        <FormField id="svmem" label="Members expected" error={errors.expectedMembers}><input id="svmem" inputMode="numeric" value={f.expectedMembers} onChange={(e) => { setF((x) => ({ ...x, expectedMembers: e.target.value.replace(/\D/g, '').slice(0, 4) })); setErrors((x) => ({ ...x, expectedMembers: undefined })); }} /></FormField>
        <FormField id="svmeet" label="Meeting" error={errors.meetingType}>
          <select id="svmeet" value={f.meetingType} onChange={set('meetingType')}><option value="">Not decided</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select>
        </FormField>
        <FormField id="svleader" label="Leader (contact person)" error={errors.leaderName}><input id="svleader" value={f.leaderName} maxLength={80} onChange={set('leaderName')} /></FormField>
        <FormField id="svmob" label="Leader mobile" error={errors.leaderMobile}><input id="svmob" inputMode="numeric" value={f.leaderMobile} onChange={(e) => { setF((x) => ({ ...x, leaderMobile: e.target.value.replace(/\D/g, '').slice(0, 10) })); setErrors((x) => ({ ...x, leaderMobile: undefined })); }} /></FormField>
        <FormField id="svremark" label="What was found" className="span-2" error={errors.remark}><input id="svremark" value={f.remark} maxLength={300} onChange={set('remark')} /></FormField>
      </div>
    </Modal>
  );
}

function StatusForm({ survey, onClose, onSaved }) {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [remark, setRemark] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setErrors({});
    try {
      await api.centerSurveys.setStatus(survey.id, { status, remark });
      toast.success('Status updated');
      onSaved();
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open title={`Status of ${survey.surveyNo}`} onClose={onClose} busy={busy}
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Close</button><button className="btn primary" onClick={save} disabled={busy || !status}>{busy ? 'Saving…' : 'Update status'}</button></>}>
      <p className="muted">{survey.centerName} · now <Badge s={survey.status} /></p>
      <FormField id="ssstatus" label="New status" required error={errors.status}>
        <select id="ssstatus" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Select</option>
          {Object.entries(STATUS).filter(([k]) => k !== survey.status).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </FormField>
      <FormField id="ssremark" label="Remark" error={errors.remark} hint="Required when rejecting"><input id="ssremark" value={remark} maxLength={300} onChange={(e) => setRemark(e.target.value)} /></FormField>
      {survey.history.length > 0 && (
        <div className="muted small" style={{ marginTop: 8 }}>
          {survey.history.map((h, i) => <div key={i}>{dmy(h.at)} · {STATUS[h.status]?.[0] || h.status}{h.remark ? ` — ${h.remark}` : ''}{h.by ? ` (${h.by})` : ''}</div>)}
        </div>
      )}
    </Modal>
  );
}

// Item 26: Modal displaying CGT 1, 2, 3 meeting photos, GPS location and attended members list in Software
function CgtViewModal({ survey, onClose }) {
  const [activePhoto, setActivePhoto] = useState(null);
  const cgt = survey.cgt;
  const loc = survey.location;

  return (
    <Modal
      open
      title={`CGT 1, 2, 3 Photos & Location: ${survey.centerName}`}
      onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Close</button>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Location Section */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
          <h4 style={{ margin: '0 0 6px 0', fontSize: '0.9rem', color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>📍 Center Location & GPS</span>
          </h4>
          <div style={{ fontSize: '0.85rem', color: '#334155' }}>
            <div><strong>Address / Area:</strong> {survey.area || loc?.address || 'Not specified'}</div>
            {loc?.lat && loc?.lng ? (
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span><strong>Coordinates:</strong> {Number(loc.lat).toFixed(4)}, {Number(loc.lng).toFixed(4)}</span>
                <a
                  href={`https://maps.google.com/?q=${loc.lat},${loc.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn sm"
                  style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  🗺️ Open in Google Maps
                </a>
              </div>
            ) : loc?.address ? (
              <div style={{ marginTop: 4, color: '#047857', fontWeight: 600 }}>GPS Location: {loc.address}</div>
            ) : (
              <div className="muted small" style={{ marginTop: 4 }}>No GPS coordinates recorded for this center.</div>
            )}
          </div>
        </div>

        {/* Survey Initial Photo (if any) */}
        {survey.visitPhoto && (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '0.88rem' }}>📸 Initial Survey / Center Visit Photo</h4>
            <img
              src={survey.visitPhoto}
              alt="Visit Photo"
              onClick={() => setActivePhoto(survey.visitPhoto)}
              style={{ width: '100%', maxHeight: 200, objectFit: 'contain', borderRadius: 6, cursor: 'pointer', background: '#000' }}
            />
          </div>
        )}

        {/* CGT Days 1, 2, 3 Grid */}
        <div>
          <h4 style={{ margin: '0 0 10px 0', fontSize: '0.92rem', color: '#0f172a' }}>
            CGT (Continuous Group Training) 1, 2, 3 Meeting Records
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {[1, 2, 3].map((d) => {
              const day = cgt ? cgt[`day${d}`] : null;
              const hasPhoto = Boolean(day?.photo);
              const members = day?.members || [];

              return (
                <div
                  key={d}
                  style={{
                    border: `1px solid ${hasPhoto ? '#86efac' : '#e2e8f0'}`,
                    background: hasPhoto ? '#f0fdf4' : '#fafafa',
                    borderRadius: 8,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '0.88rem', color: hasPhoto ? '#166534' : '#64748b' }}>
                      Meeting {d} (CGT Day {d})
                    </strong>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: hasPhoto ? '#dcfce7' : '#e2e8f0', color: hasPhoto ? '#15803d' : '#64748b' }}>
                      {hasPhoto ? '✓ Completed' : 'Pending'}
                    </span>
                  </div>

                  {day?.date && (
                    <div className="small muted">
                      Date: <strong>{dmy(day.date)}</strong>
                    </div>
                  )}

                  {/* Day Photo */}
                  {hasPhoto ? (
                    <div>
                      <img
                        src={day.photo}
                        alt={`CGT Day ${d}`}
                        onClick={() => setActivePhoto(day.photo)}
                        style={{ width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', border: '1px solid #bbf7d0' }}
                      />
                      <div className="muted small" style={{ textAlign: 'center', marginTop: 2 }}>Click to view full photo</div>
                    </div>
                  ) : (
                    <div style={{ height: 100, background: '#f1f5f9', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>
                      No photo uploaded
                    </div>
                  )}

                  {/* Location for Day */}
                  {day?.location?.address && (
                    <div className="small" style={{ fontSize: '0.75rem', color: '#047857' }}>
                      📍 {day.location.address}
                    </div>
                  )}

                  {/* Attended Members */}
                  <div style={{ marginTop: 4 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: 2 }}>
                      Attended Members ({members.length}):
                    </div>
                    {members.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {members.map((m, idx) => (
                          <span
                            key={idx}
                            style={{
                              fontSize: '0.72rem',
                              background: '#e0f2fe',
                              color: '#0369a1',
                              padding: '2px 6px',
                              borderRadius: 4,
                            }}
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="muted small">No member names recorded</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Expanded Photo Preview Modal */}
      {activePhoto && (
        <div
          onClick={() => setActivePhoto(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            cursor: 'zoom-out',
          }}
        >
          <img src={activePhoto} alt="Full view" style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain', borderRadius: 8 }} />
        </div>
      )}
    </Modal>
  );
}

/** New Center Survey Report: the surveys of places for new centers, with their status. */
export default function CenterSurveys() {
  const { user } = useAuth();
  const canStatus = ['super_admin', 'admin', 'branch_manager'].includes(user?.role);
  const canAdd = ['super_admin', 'admin', 'branch_manager', 'accountant', 'loan_officer', 'collection_officer', 'field_officer'].includes(user?.role);
  const [branches, setBranches] = useState([]);
  const [branch, setBranch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 350);
  const empCode = useDebounce(employeeFilter, 350);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewingCgt, setViewingCgt] = useState(null);

  useEffect(() => { api.groups.branchOptions().then((r) => setBranches(r.items)).catch(() => {}); }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.centerSurveys.list({ branch, status, from, to, q, employeeCode: empCode }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [branch, status, from, to, q, empCode]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <PageHeader title="New Center Survey Report" description="Surveys of the places where a new center may be opened, and where each one stands. The branch manager or admin updates the status." />
      <div className="panel">
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          {branches.length > 1 && (
            <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch">
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
          )}
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>From <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /></label>
          <label className="small muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>To <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" /></label>
          <input type="text" placeholder="By Employee ID" value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)} aria-label="Employee Code" style={{ maxWidth: 140 }} />
          <input type="search" placeholder="Search center/leader" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" style={{ minWidth: 160 }} />
          <button className="btn" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
          {canAdd && <button className="btn primary" onClick={() => setAdding(true)}>New survey</button>}
        </div>
        {loading && !data ? <Spinner label="Loading…" /> : error ? <ErrorState message={error} onRetry={load} /> : !data || data.items.length === 0 ? (
          <EmptyState title="No survey" description="No center survey for these filters." />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', margin: '8px 0' }}>
              <span>Surveys <strong>{data.summary.surveys}</strong></span>
              {Object.entries(STATUS).map(([k, [l]]) => <span key={k}>{l} <strong>{data.summary[k]}</strong></span>)}
              <span>Members expected <strong>{data.summary.expectedMembers}</strong></span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Survey</th><th>Date</th><th>Branch</th><th>Center</th><th>Leader</th><th>Meeting</th><th className="num">Members</th><th>Status</th><th>CGT & Photos</th><th>By</th>{canStatus && <th />}</tr></thead>
                <tbody>
                  {data.items.map((s) => (
                    <tr key={s.id}>
                      <td data-label="Survey"><strong>{s.surveyNo}</strong></td>
                      <td data-label="Date">{dmy(s.surveyDate)}</td>
                      <td data-label="Branch">{s.branch?.code}</td>
                      <td data-label="Center">{s.centerName}<div className="muted small">{[s.area, s.district, s.pincode].filter(Boolean).join(', ')}</div>{s.remark && <div className="muted small">{s.remark}</div>}</td>
                      <td data-label="Leader">{s.leaderName || '—'}{s.leaderMobile && <div className="muted small">{s.leaderMobile}</div>}</td>
                      <td data-label="Meeting">{s.meetingType ? s.meetingType[0].toUpperCase() + s.meetingType.slice(1) : '—'}</td>
                      <td data-label="Members" className="num">{s.expectedMembers || '—'}</td>
                      <td data-label="Status"><Badge s={s.status} />{s.history.length > 1 && <div className="muted small">{s.history[s.history.length - 1].remark}</div>}</td>
                      <td data-label="CGT & Photos">
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => setViewingCgt(s)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', padding: '3px 8px', whiteSpace: 'nowrap' }}
                        >
                          <span>📸 Photos & GPS</span>
                          {s.cgt?.status === 'completed' && <span style={{ color: '#16a34a', fontWeight: 800 }}>✓</span>}
                        </button>
                        {s.cgt && (
                          <div className="muted small" style={{ marginTop: 2, fontSize: '0.7rem' }}>
                            D1:{s.cgt.day1?.photo ? '✓' : '—'} D2:{s.cgt.day2?.photo ? '✓' : '—'} D3:{s.cgt.day3?.photo ? '✓' : '—'}
                          </div>
                        )}
                      </td>
                      <td data-label="Surveyed by">{s.surveyedBy || '—'}</td>
                      {canStatus && <td><button className="btn sm" onClick={() => setEditing(s)}>Update status</button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {adding && <SurveyForm branches={branches} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {editing && <StatusForm survey={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {viewingCgt && <CgtViewModal survey={viewingCgt} onClose={() => setViewingCgt(null)} />}
    </>
  );
}
