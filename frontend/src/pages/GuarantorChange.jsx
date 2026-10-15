import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import FormField from '../components/ui/FormField.jsx';
import { DetailList, EmptyState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { EmployeeSelect, OtpVerify, PhotoField } from './NewBorrower.jsx';
import { downloadMemberPdf } from '../utils/memberPdf.js';

const EMPTY = { employeeCode: '', name: '', mobile: '', aadhaar: '', pan: '', photo: '', signature: '', aadhaarPhoto: '', panPhoto: '', jointPhoto: '', reason: '' };
const fmtTime = (d) => (d ? new Date(d).toLocaleString('en-IN') : '—');

function PersonCard({ title, p, note }) {
  return (
    <div className="panel" style={{ padding: 16 }}>
      <h3 className="section-title">{title}</h3>
      {note && <div className="field-hint" style={{ marginBottom: 8 }}>{note}</div>}
      <DetailList items={[['Name', p.name], ['Phone', p.mobile ? `${p.mobile}${p.mobileVerified ? ' ✓' : ''}` : ''], ['Aadhaar', p.aadhaar], ['PAN', p.pan ? `${p.pan}${p.panVerified ? ' ✓ verified' : ''}` : ''], ['Employee ID', p.employeeCode]]} />
      <div className="stamp-view sign-row" style={{ marginTop: 12 }}>
        {[['Photo', p.photo], ['Signature', p.signature], ['Aadhaar', p.aadhaarPhoto], ['PAN', p.panPhoto], ['Joint photo', p.jointPhoto]].map(([l, src]) => (
          <div key={l}>
            <div className="detail-label">{l}</div>
            {src ? <img src={src} alt={l} className="stamp-img" /> : <span className="muted">—</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function GuarantorChange() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [member, setMember] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [challenge, setChallenge] = useState('');
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const q = useDebounce(search);

  useEffect(() => {
    if (member) return undefined;
    let live = true;
    setSearching(true);
    api.members
      .list({ q, limit: 10 })
      .then((r) => live && setResults(r.items.filter((x) => x.hasGuarantor || !q)))
      .catch(() => live && setResults([]))
      .finally(() => live && setSearching(false));
    return () => {
      live = false;
    };
  }, [q, member]);

  async function choose(id) {
    try {
      const r = await api.members.get(id);
      setMember(r.member);
      setForm(EMPTY);
      setErrors({});
      setChallenge('');
      setChanged(false);
    } catch (err) {
      toast.error(err.message);
    }
  }

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };
  const setDigits = (key, len) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value.replace(/\D/g, '').slice(0, len) }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };
  const setPhoto = (key) => (v) => {
    setForm((f) => ({ ...f, [key]: v }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };
  const resetChallenge = useCallback(() => setChallenge(''), []);
  const mobileValid = /^[6-9]\d{9}$/.test(form.mobile);

  async function submit(e) {
    e.preventDefault();
    const found = {};
    if (!form.employeeCode) found.employeeCode = 'Select the employee';
    if (form.name.trim().length < 2) found.name = 'Guarantor name is required';
    if (form.mobile && !mobileValid) found.mobile = 'Enter a valid 10-digit mobile number';
    else if (form.mobile && !challenge) found.mobile = 'Verify the phone number with an OTP, or clear the number';
    if (!/^\d{12}$/.test(form.aadhaar)) found.aadhaar = 'Enter the 12-digit Aadhaar number';
    if (form.pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(form.pan)) found.pan = 'Enter a valid PAN (e.g. ABCDE1234F)';
    else if (form.pan && form.pan[3] !== 'P') found.pan = 'A PAN of an individual has P as the 4th letter';
    if (!form.photo) found.photo = 'Guarantor photo is required';
    if (!form.signature) found.signature = 'Signature is required';
    if (!form.aadhaarPhoto) found.aadhaarPhoto = 'Aadhaar photo is required';
    if (form.pan && !form.panPhoto) found.panPhoto = 'PAN photo is required when a PAN is given';
    if (form.reason.trim().length < 3) found.reason = 'Enter the reason for the change';
    setErrors(found);
    if (Object.keys(found).length) return toast.error('Please correct the highlighted fields');

    setSaving(true);
    try {
      await api.members.changeGuarantor(member.id, { ...form, reason: form.reason.trim(), mobileChallengeId: challenge || undefined });
      toast.success('Guarantor changed');
      const r = await api.members.get(member.id);
      setMember(r.member);
      setForm(EMPTY);
      setChallenge('');
      setChanged(true);
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  // ---- step 1: member code search ------------------------------------------------------------
  if (!member) {
    return (
      <>
        <PageHeader title="Guarantor Change" description="Search the member by member code to see the details and change the guarantor." />
        <div className="panel">
          <div className="toolbar">
            <input type="search" className="toolbar-search" placeholder="Search by name, member code, form ID, mobile, last 4 digits of Aadhaar or PAN (guarantor details too)" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus aria-label="Search member" />
          </div>
          {searching && !results.length ? (
            <Spinner label="Searching…" />
          ) : results.length === 0 ? (
            <EmptyState title="No members found" description="Only members who already have a guarantor can be changed." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Member code</th><th>Name</th><th>Branch</th><th>Mobile</th><th className="actions-col">Actions</th></tr></thead>
                <tbody>
                  {results.map((m) => (
                    <tr key={m.id}>
                      <td data-label="Code"><strong>{m.code}</strong></td>
                      <td data-label="Name">{m.name}</td>
                      <td data-label="Branch">{m.branch?.name || '—'}</td>
                      <td data-label="Mobile">{m.mobile}</td>
                      <td data-label="Actions" className="actions-col"><button className="btn sm primary" onClick={() => choose(m.id)}>Select</button></td>
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

  // ---- step 2: details + change -----------------------------------------------------------------
  const history = member.guarantorHistory || [];
  return (
    <>
      <PageHeader
        title="Guarantor Change"
        description={`${member.name} (${member.code}) — Form ID ${member.formId}`}
        actions={
          <>
            <button className="btn" onClick={() => downloadMemberPdf(member)}>Download PDF</button>
            <button className="btn" onClick={() => setMember(null)}>Change member</button>
          </>
        }
      />
      {changed && <div className="notice ok">Guarantor changed. The previous guarantor is kept in the history below, and the new guarantor's documents are sent for KYC approval.</div>}

      <div className="panel" style={{ padding: 16, marginBottom: 14 }}>
        <h3 className="section-title">Member details</h3>
        <DetailList
          items={[
            ['Member code', member.code], ['Branch', member.branch ? `${member.branch.code} — ${member.branch.name}` : ''],
            ['Mobile', member.mobile], ['Aadhaar', member.aadhaar],
            ['Address', `${member.address}, ${member.district}, ${member.state} - ${member.pincode}`], ['Employee ID', member.employeeCode],
          ]}
        />
      </div>

      {!member.guarantor ? (
        <div className="notice">This member has no guarantor yet. Add one under <strong>Guarantor Detail</strong> first.</div>
      ) : (
        <>
          <PersonCard title="Current guarantor" p={member.guarantor} note={`Added ${fmtTime(member.guarantor.savedAt)}`} />

          <form onSubmit={submit} noValidate style={{ marginTop: 14 }}>
            <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
              <h3 className="section-title">New guarantor</h3>
              <div className="form-grid">
                <EmployeeSelect branch={member.branchId} value={form.employeeCode} error={errors.employeeCode}
                  onChange={(code) => { setForm((f) => ({ ...f, employeeCode: code })); setErrors((er) => ({ ...er, employeeCode: undefined })); }} />
                <FormField id="name" label="Guarantor name" required error={errors.name}>
                  <input id="name" value={form.name} onChange={set('name')} maxLength={80} />
                </FormField>
                <FormField id="mobile" label="Phone number" error={errors.mobile} hint="Optional. If entered, it must be verified with an OTP">
                  <input id="mobile" value={form.mobile} onChange={setDigits('mobile', 10)} inputMode="numeric" maxLength={10} />
                  {form.mobile && (
                    <OtpVerify id="gmobile" label="Phone number" purpose="mobile" value={form.mobile} valid={mobileValid} mobile={form.mobile}
                      verified={Boolean(challenge)} onVerified={setChallenge} onReset={resetChallenge} />
                  )}
                </FormField>
                <FormField id="aadhaar" label="Aadhaar number" required error={errors.aadhaar}>
                  <input id="aadhaar" value={form.aadhaar} onChange={setDigits('aadhaar', 12)} inputMode="numeric" maxLength={12} />
                </FormField>
                <FormField id="pan" label="PAN number" error={errors.pan} hint={/^[A-Z]{5}\d{4}[A-Z]$/.test(form.pan) && form.pan[3] === 'P' ? '✓ PAN format is valid' : 'Optional. Format: ABCDE1234F'}>
                  <input id="pan" value={form.pan} maxLength={10}
                    onChange={(e) => setForm((f) => ({ ...f, pan: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) }))} />
                </FormField>
                <FormField id="reason" label="Reason for change" required error={errors.reason} className="span-2">
                  <input id="reason" value={form.reason} onChange={set('reason')} maxLength={200} />
                </FormField>
              </div>
              <h3 className="section-title">Photos</h3>
              <div className="form-grid">
                <PhotoField id="photo" label="Guarantor photo" required value={form.photo} error={errors.photo} onChange={setPhoto('photo')} />
                <PhotoField id="signature" label="Signature" required value={form.signature} error={errors.signature} onChange={setPhoto('signature')} />
                <PhotoField id="aadhaarPhoto" label="Aadhaar photo" required value={form.aadhaarPhoto} error={errors.aadhaarPhoto} onChange={setPhoto('aadhaarPhoto')} />
                <PhotoField id="panPhoto" label="PAN photo" required={Boolean(form.pan)} value={form.panPhoto} error={errors.panPhoto} onChange={setPhoto('panPhoto')} />
                <PhotoField id="jointPhoto" label="Member & guarantor joint photo (optional)" value={form.jointPhoto} error={errors.jointPhoto} onChange={setPhoto('jointPhoto')} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Change guarantor'}</button>
            </div>
          </form>
        </>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <h3 className="section-title">Previous guarantors</h3>
          <div style={{ display: 'grid', gap: 12 }}>
            {history.map((h) => (
              <PersonCard
                key={`${h.replacedAt}-${h.aadhaar}`}
                title={`${h.name}`}
                p={h}
                note={`Replaced on ${fmtTime(h.replacedAt)}${h.replacedByCode ? ` by ${h.replacedByCode}` : ''} · Reason: ${h.reason || '—'}`}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
