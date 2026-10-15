import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import FormField from '../components/ui/FormField.jsx';
import { EmptyState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { EmployeeSelect, OtpVerify, PhotoField } from './NewBorrower.jsx';
import { downloadMemberPdf } from '../utils/memberPdf.js';

const EMPTY = { employeeCode: '', name: '', mobile: '', aadhaar: '', pan: '', photo: '', signature: '', aadhaarPhoto: '', panPhoto: '', jointPhoto: '' };

const fromPerson = (p) => ({
  employeeCode: p?.employeeCode || '',
  name: p?.name || '',
  mobile: p?.mobile || '',
  aadhaar: '',
  pan: '',
  photo: p?.photo || '',
  signature: p?.signature || '',
  aadhaarPhoto: p?.aadhaarPhoto || '',
  panPhoto: p?.panPhoto || '',
  jointPhoto: p?.jointPhoto || '',
});

// One person's form: the guarantor, or the nominee (which has the "same as guarantor" tick box).
function PartySection({ kind, member, onSaved }) {
  const label = kind === 'guarantor' ? 'Guarantor' : 'Nominee';
  const toast = useToast();
  const existing = member[kind];
  const [form, setForm] = useState(() => fromPerson(existing));
  const [errors, setErrors] = useState({});
  const [challenge, setChallenge] = useState('');
  const [same, setSame] = useState(Boolean(kind === 'nominee' && existing?.sameAsGuarantor));
  const [saving, setSaving] = useState(false);

  // A different member (or fresh data after a save) resets the form.
  useEffect(() => {
    setForm(fromPerson(member[kind]));
    setSame(Boolean(kind === 'nominee' && member[kind]?.sameAsGuarantor));
    setChallenge('');
    setErrors({});
  }, [member, kind]);

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
  // The saved number stays verified as long as it is not changed.
  const mobileVerified = Boolean(challenge) || Boolean(existing?.mobileVerified && form.mobile && form.mobile === existing.mobile);
  const noGuarantor = kind === 'nominee' && !member.guarantor;

  async function submit(e) {
    e.preventDefault();
    const found = {};
    if (!form.employeeCode) found.employeeCode = 'Select the employee';
    let payload;
    if (same) {
      payload = { employeeCode: form.employeeCode, sameAsGuarantor: true };
    } else {
      if (form.name.trim().length < 2) found.name = `${label} name is required`;
      if (form.mobile && !mobileValid) found.mobile = 'Enter a valid 10-digit mobile number';
      else if (form.mobile && !mobileVerified) found.mobile = 'Verify the phone number with an OTP, or clear the number';
      if (!/^\d{12}$/.test(form.aadhaar)) found.aadhaar = existing && !form.aadhaar ? 'Re-enter the 12-digit Aadhaar number to save' : 'Enter the 12-digit Aadhaar number';
      if (form.pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(form.pan)) found.pan = 'Enter a valid PAN (e.g. ABCDE1234F)';
      else if (form.pan && form.pan[3] !== 'P') found.pan = 'A PAN of an individual has P as the 4th letter';
      if (!form.photo) found.photo = `${label} photo is required`;
      if (!form.signature) found.signature = 'Signature is required';
      if (!form.aadhaarPhoto) found.aadhaarPhoto = 'Aadhaar photo is required';
      if (form.pan && !form.panPhoto) found.panPhoto = 'PAN photo is required when a PAN is given';
      payload = { ...form, mobileChallengeId: challenge || undefined };
    }
    setErrors(found);
    if (Object.keys(found).length) return toast.error('Please correct the highlighted fields');

    setSaving(true);
    try {
      const save = kind === 'guarantor' ? api.members.saveGuarantor : api.members.saveNominee;
      await save(member.id, payload);
      toast.success(same ? 'Nominee set as the guarantor' : `${label} saved`);
      await onSaved();
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <h3 className="section-title" style={{ flex: 1 }}>{label} details</h3>
          {existing && <span className="badge green">Saved</span>}
        </div>

        {kind === 'nominee' && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <input type="checkbox" checked={same} disabled={noGuarantor} onChange={(e) => setSame(e.target.checked)} />
            <span>
              Nominee is the same person as the guarantor
              {noGuarantor && <span className="muted"> (save the guarantor first)</span>}
            </span>
          </label>
        )}
        {same && member.guarantor && (
          <div className="notice" style={{ marginBottom: 12 }}>
            The nominee will be <strong>{member.guarantor.name}</strong> (the guarantor). The nominee fields are not needed. Untick the box to enter a different nominee.
          </div>
        )}

        <div className="form-grid">
          <EmployeeSelect
            id={`${kind}-employee`}
            branch={member.branchId}
            value={form.employeeCode}
            error={errors.employeeCode}
            onChange={(code) => { setForm((f) => ({ ...f, employeeCode: code })); setErrors((er) => ({ ...er, employeeCode: undefined })); }}
          />
          {!same && (
            <>
              <FormField id={`${kind}-name`} label={`${label} name`} required error={errors.name}>
                <input id={`${kind}-name`} value={form.name} onChange={set('name')} maxLength={80} />
              </FormField>
              <FormField id={`${kind}-mobile`} label="Phone number" error={errors.mobile} hint="Optional. If entered, it must be verified with an OTP">
                <input id={`${kind}-mobile`} value={form.mobile} onChange={setDigits('mobile', 10)} inputMode="numeric" maxLength={10} />
                {form.mobile && (
                  <OtpVerify id={`${kind}-otp`} label="Phone number" purpose="mobile" value={form.mobile} valid={mobileValid} mobile={form.mobile}
                    verified={mobileVerified} onVerified={setChallenge} onReset={resetChallenge} />
                )}
              </FormField>
              <FormField id={`${kind}-aadhaar`} label="Aadhaar number" required error={errors.aadhaar}
                hint={existing ? `Saved: ${existing.aadhaar}. Enter it again to save changes.` : undefined}>
                <input id={`${kind}-aadhaar`} value={form.aadhaar} onChange={setDigits('aadhaar', 12)} inputMode="numeric" maxLength={12} />
              </FormField>
              <FormField id={`${kind}-pan`} label="PAN number" error={errors.pan} hint={
                  /^[A-Z]{5}\d{4}[A-Z]$/.test(form.pan)
                    ? (form.pan[3] === 'P' ? '✓ PAN format is valid' : 'A PAN of an individual has P as the 4th letter')
                    : existing?.pan ? `Saved: ${existing.pan}${existing.panVerified ? ' (verified)' : ''}. Enter it again to keep it.` : 'Optional. Format: ABCDE1234F'
                }>
                <input id={`${kind}-pan`} value={form.pan} maxLength={10}
                  onChange={(e) => setForm((f) => ({ ...f, pan: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) }))} />
              </FormField>
            </>
          )}
        </div>

        {!same && (
          <>
            <h3 className="section-title">Photos</h3>
            <div className="form-grid">
              <PhotoField id={`${kind}-photo`} label={`${label} photo`} required value={form.photo} error={errors.photo} onChange={setPhoto('photo')} />
              <PhotoField id={`${kind}-signature`} label="Signature" required value={form.signature} error={errors.signature} onChange={setPhoto('signature')} />
              <PhotoField id={`${kind}-aadhaarPhoto`} label="Aadhaar photo" required value={form.aadhaarPhoto} error={errors.aadhaarPhoto} onChange={setPhoto('aadhaarPhoto')} />
              <PhotoField id={`${kind}-panPhoto`} label="PAN photo" required={Boolean(form.pan)} value={form.panPhoto} error={errors.panPhoto} onChange={setPhoto('panPhoto')} />
              <PhotoField id={`${kind}-jointPhoto`} label={`Member & ${label.toLowerCase()} joint photo (optional)`} value={form.jointPhoto} error={errors.jointPhoto} onChange={setPhoto('jointPhoto')} />
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="submit" className="btn primary" disabled={saving || noGuarantor}>
            {saving ? 'Saving…' : same ? 'Save nominee (same as guarantor)' : `Save ${label.toLowerCase()}`}
          </button>
        </div>
      </div>
    </form>
  );
}

// Guarantor and nominee are added together, on one page, for a chosen member.
export default function GuarantorNominee() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [member, setMember] = useState(null);
  const q = useDebounce(search);

  useEffect(() => {
    if (member) return undefined;
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
  }, [q, member]);

  async function open(id) {
    try {
      setMember((await api.members.get(id)).member);
    } catch (err) {
      toast.error(err.message);
    }
  }
  const refresh = useCallback(async () => {
    if (member) setMember((await api.members.get(member.id)).member);
  }, [member]);

  if (!member) {
    return (
      <>
        <PageHeader title="Guarantor & Nominee Detail" description="Choose the member, then add the guarantor and the nominee on the same page." />
        <div className="panel">
          <div className="toolbar">
            <input type="search" className="toolbar-search" placeholder="Search by name, member code, form ID, mobile, last 4 digits of Aadhaar or PAN (guarantor details too)"
              value={search} onChange={(e) => setSearch(e.target.value)} autoFocus aria-label="Search member" />
          </div>
          {searching && !results.length ? (
            <Spinner label="Searching…" />
          ) : results.length === 0 ? (
            <EmptyState title="No members found" description="Register the borrower first under New Borrower." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Member code</th><th>Name</th><th>Branch</th><th>Mobile</th><th>Guarantor</th><th>Nominee</th><th className="actions-col">Actions</th></tr></thead>
                <tbody>
                  {results.map((m) => (
                    <tr key={m.id}>
                      <td data-label="Code"><strong>{m.code}</strong></td>
                      <td data-label="Name">{m.name}{m.matchedVia === 'guarantor' && <div className="muted small">found via guarantor</div>}</td>
                      <td data-label="Branch">{m.branch?.name || '—'}</td>
                      <td data-label="Mobile">{m.mobile}</td>
                      <td data-label="Guarantor">{m.hasGuarantor ? 'Added' : 'Pending'}</td>
                      <td data-label="Nominee">{m.hasNominee ? 'Added' : 'Pending'}</td>
                      <td data-label="Actions" className="actions-col"><button className="btn sm primary" onClick={() => open(m.id)}>Select</button></td>
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

  return (
    <>
      <PageHeader
        title="Guarantor & Nominee Detail"
        description={`${member.name} (${member.code}) — Form ID ${member.formId}`}
        actions={
          <>
            <button className="btn" onClick={() => downloadMemberPdf(member)}>Download PDF</button>
            <button className="btn" onClick={() => setMember(null)}>Change member</button>
          </>
        }
      />
      <PartySection kind="guarantor" member={member} onSaved={refresh} />
      <PartySection kind="nominee" member={member} onSaved={refresh} />
    </>
  );
}
