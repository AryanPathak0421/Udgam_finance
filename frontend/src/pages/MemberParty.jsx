import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import FormField from '../components/ui/FormField.jsx';
import { EmptyState, PageHeader, Spinner } from '../components/ui/Feedback.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import useDebounce from '../hooks/useDebounce.js';
import { EmployeeSelect, OtpVerify, PhotoField } from './NewBorrower.jsx';
import { downloadMemberPdf } from '../utils/memberPdf.js';

const EMPTY = { employeeCode: '', name: '', mobile: '', aadhaar: '', pan: '', photo: '', signature: '', aadhaarPhoto: '', panPhoto: '' };

// Guarantor and nominee share the same fields; `kind` picks which one of the member is edited.
function PartyPage({ kind }) {
  const label = kind === 'guarantor' ? 'Guarantor' : 'Nominee';
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [member, setMember] = useState(null); // full detail of the chosen member
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [challenge, setChallenge] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const q = useDebounce(search);

  useEffect(() => {
    if (member) return;
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

  async function choose(id) {
    try {
      const r = await api.members.get(id);
      setMember(r.member);
      const p = r.member[kind];
      setForm(p ? { employeeCode: p.employeeCode || '', name: p.name, mobile: p.mobile, aadhaar: '', pan: '', photo: p.photo || '', signature: p.signature || '', aadhaarPhoto: p.aadhaarPhoto || '', panPhoto: p.panPhoto || '' } : EMPTY);
      setErrors({});
      setChallenge('');
      setSaved(false);
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
  const existing = member?.[kind];

  async function submit(e) {
    e.preventDefault();
    const found = {};
    if (!form.employeeCode) found.employeeCode = 'Select the employee';
    if (form.name.trim().length < 2) found.name = `${label} name is required`;
    if (!mobileValid) found.mobile = 'Enter a valid 10-digit mobile number';
    if (!/^\d{12}$/.test(form.aadhaar)) found.aadhaar = existing && !form.aadhaar ? 'Re-enter the 12-digit Aadhaar number to save' : 'Enter the 12-digit Aadhaar number';
    if (form.pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(form.pan)) found.pan = 'Enter a valid PAN (e.g. ABCDE1234F)';
    if (!form.photo) found.photo = `${label} photo is required`;
    if (!form.signature) found.signature = 'Signature is required';
    if (!form.aadhaarPhoto) found.aadhaarPhoto = 'Aadhaar photo is required';
    if (form.pan && !form.panPhoto) found.panPhoto = 'PAN photo is required when a PAN is given';
    setErrors(found);
    if (Object.keys(found).length) return toast.error('Please correct the highlighted fields');

    setSaving(true);
    try {
      const save = kind === 'guarantor' ? api.members.saveGuarantor : api.members.saveNominee;
      await save(member.id, { ...form, mobileChallengeId: challenge || undefined });
      toast.success(`${label} saved`);
      const r = await api.members.get(member.id);
      setMember(r.member);
      setSaved(true);
    } catch (err) {
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  // ---- step 1: choose the member ------------------------------------------------------------
  if (!member) {
    return (
      <>
        <PageHeader title={`${label} Detail`} description={`Choose the member this ${label.toLowerCase()} belongs to.`} />
        <div className="panel">
          <div className="toolbar">
            <input type="search" className="toolbar-search" placeholder="Search by member name, code, form ID or mobile" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus aria-label="Search member" />
          </div>
          {searching && !results.length ? (
            <Spinner label="Searching…" />
          ) : results.length === 0 ? (
            <EmptyState title="No members found" description="Register the borrower first under New Borrower." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Member code</th><th>Name</th><th>Branch</th><th>Mobile</th><th>{label}</th><th className="actions-col">Actions</th></tr></thead>
                <tbody>
                  {results.map((m) => (
                    <tr key={m.id}>
                      <td data-label="Code"><strong>{m.code}</strong></td>
                      <td data-label="Name">{m.name}</td>
                      <td data-label="Branch">{m.branch?.name || '—'}</td>
                      <td data-label="Mobile">{m.mobile}</td>
                      <td data-label={label}>{(kind === 'guarantor' ? m.hasGuarantor : m.hasNominee) ? 'Added' : 'Pending'}</td>
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

  // ---- step 2: the form ----------------------------------------------------------------------
  return (
    <>
      <PageHeader
        title={`${label} Detail`}
        description={`${member.name} (${member.code}) — Form ID ${member.formId}`}
        actions={<button className="btn" onClick={() => setMember(null)}>Change member</button>}
      />
      {saved && (
        <div className="notice ok" style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span>{label} details saved. The full application with all details is ready as a PDF.</span>
          <button className="btn sm primary" onClick={() => downloadMemberPdf(member)}>Download PDF</button>
        </div>
      )}
      <form onSubmit={submit} noValidate>
        <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
          <h3 className="section-title">{label} details</h3>
          <div className="form-grid">
            <EmployeeSelect
              branch={member.branchId}
              value={form.employeeCode}
              error={errors.employeeCode}
              onChange={(code) => { setForm((f) => ({ ...f, employeeCode: code })); setErrors((er) => ({ ...er, employeeCode: undefined })); }}
            />
            <FormField id="name" label={`${label} name`} required error={errors.name}>
              <input id="name" value={form.name} onChange={set('name')} maxLength={80} />
            </FormField>
            <FormField id="mobile" label="Phone number" required error={errors.mobile} hint="OTP verification is optional">
              <input id="mobile" value={form.mobile} onChange={setDigits('mobile', 10)} inputMode="numeric" maxLength={10} />
              <OtpVerify id="pmobile" label="Phone number" purpose="mobile" value={form.mobile} valid={mobileValid} mobile={form.mobile}
                verified={Boolean(challenge)} onVerified={setChallenge} onReset={resetChallenge} />
            </FormField>
            <FormField id="aadhaar" label="Aadhaar number" required error={errors.aadhaar}
              hint={existing ? `Saved: ${existing.aadhaar}. Enter it again to save changes.` : undefined}>
              <input id="aadhaar" value={form.aadhaar} onChange={setDigits('aadhaar', 12)} inputMode="numeric" maxLength={12} />
            </FormField>
            <FormField id="pan" label="PAN number" error={errors.pan} hint={existing?.pan ? `Saved: ${existing.pan}. Enter it again to keep it.` : 'Optional'}>
              <input id="pan" value={form.pan} onChange={(e) => setForm((f) => ({ ...f, pan: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) }))} maxLength={10} />
            </FormField>
          </div>
        </div>

        <div className="panel" style={{ padding: 18, marginBottom: 14 }}>
          <h3 className="section-title">Photos</h3>
          <div className="form-grid">
            <PhotoField id="photo" label={`${label} photo`} required value={form.photo} error={errors.photo} onChange={setPhoto('photo')} />
            <PhotoField id="signature" label="Signature" required value={form.signature} error={errors.signature} onChange={setPhoto('signature')} />
            <PhotoField id="aadhaarPhoto" label="Aadhaar photo" required value={form.aadhaarPhoto} error={errors.aadhaarPhoto} onChange={setPhoto('aadhaarPhoto')} />
            <PhotoField id="panPhoto" label="PAN photo" required={Boolean(form.pan)} value={form.panPhoto} error={errors.panPhoto} onChange={setPhoto('panPhoto')} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : `Save ${label.toLowerCase()}`}</button>
        </div>
      </form>
    </>
  );
}

export const GuarantorDetail = () => <PartyPage kind="guarantor" />;
export const NomineeDetail = () => <PartyPage kind="nominee" />;
