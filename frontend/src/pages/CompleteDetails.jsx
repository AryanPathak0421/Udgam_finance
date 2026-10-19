import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import FormField from '../components/ui/FormField.jsx';
import Modal from '../components/ui/Modal.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { Link } from 'react-router-dom';
import { OtpVerify, PhotoField } from './NewBorrower.jsx';

// A member imported from the old system: the branch fills in the details that are missing. A detail that is already there is changed only by an admin
// (under Edit details); the mobile number needs an OTP.
export default function CompleteDetails({ member, options, onClose, onSaved }) {
  const toast = useToast();
  const missing = new Set((member.missingDetails || []).map((d) => d.key));
  const [form, setForm] = useState({ mobile: member.mobile || '', husbandName: '', occupation: '', education: '', address: '', pincode: '', state: member.state || '', district: '', aadhaar: '', bankName: '', ifsc: '', accountNumber: '', memberPhoto: '', signaturePhoto: '', aadhaarPhoto: '' });
  const [challengeId, setChallengeId] = useState('');
  const [districts, setDistricts] = useState([]);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const digits = (k, n) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value.replace(/\D/g, '').slice(0, n) })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const photo = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const resetOtp = useCallback(() => setChallengeId(''), []);

  useEffect(() => {
    if (!missing.has('district') || !form.state) return;
    api.members.districts(form.state).then((r) => setDistricts(r.cities)).catch(() => setDistricts([]));
  }, [form.state]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault();
    const body = {};
    Object.entries(form).forEach(([k, v]) => { if (missing.has(k) && String(v).trim() !== '') body[k] = v; });
    if (missing.has('district') && form.state && body.district) body.state = form.state;
    if (body.mobile) {
      if (!challengeId) return setErrors({ mobile: 'Verify the mobile number with an OTP first' });
      body.mobileChallengeId = challengeId;
    }
    if (!Object.keys(body).length) return setErrors({ form: 'Fill in at least one of the missing details' });
    setBusy(true);
    try {
      const r = await api.members.complete(member.id, body);
      toast.success(`Saved: ${r.filled.length} detail${r.filled.length === 1 ? '' : 's'}`);
      onSaved();
    } catch (err) {
      setErrors({ ...(err.errors || {}), form: err.errors ? undefined : err.message });
    } finally {
      setBusy(false);
    }
  }

  const mobileValid = /^[6-9]\d{9}$/.test(form.mobile);
  return (
    <Modal open title={`Complete details — ${member.name} (${member.code})`} onClose={onClose} busy={busy} size="lg">
      <form onSubmit={submit} noValidate>
        <div className="notice" style={{ marginBottom: 12 }}>
          This member came from the old system. Fill in what is missing — you can save a few now and the rest later. Once a detail is saved only an admin can change it.
          The member cannot get a new loan until everything is complete.
        </div>
        {(missing.has('guarantor') || missing.has('nominee')) && (
          <div className="notice warn" style={{ marginBottom: 12 }}>
            {missing.has('guarantor') && <div>Guarantor: the name came from the old system; the Aadhaar number and documents are still to be added.</div>}
            {missing.has('nominee') && <div>Nominee: not added yet.</div>}
            <div style={{ marginTop: 6 }}><Link className="btn sm primary" to={`/members/guarantor-detail?member=${member.id}`}>Fill in the guarantor and the nominee</Link></div>
          </div>
        )}
        <div className="form-grid">
          {missing.has('mobile') && (
            <FormField id="cmobile" label="Mobile number" required error={errors.mobile} hint={member.mobile ? "Number from the old system. Send the OTP to verify it (or correct it first). After that only an admin can change it." : "Verified with an OTP; after that only an admin can change it"}>
              <input id="cmobile" inputMode="numeric" value={form.mobile} onChange={digits('mobile', 10)} disabled={Boolean(challengeId)} />
              <OtpVerify id="cmobile" label="Mobile number" value={form.mobile} valid={mobileValid} purpose="mobile" mobile={form.mobile} verified={Boolean(challengeId)} onVerified={setChallengeId} onReset={resetOtp} forMember exceptMember={member.id} />
            </FormField>
          )}
          {missing.has('husbandName') && (
            <FormField id="chusband" label="Husband name" required error={errors.husbandName}>
              <input id="chusband" value={form.husbandName} maxLength={80} onChange={set('husbandName')} />
            </FormField>
          )}
          {missing.has('occupation') && (
            <FormField id="coccupation" label="Occupation" required error={errors.occupation}>
              <select id="coccupation" value={form.occupation} onChange={set('occupation')}><option value="">Select</option>{options.occupations.map((o) => <option key={o} value={o}>{o}</option>)}</select>
            </FormField>
          )}
          {missing.has('education') && (
            <FormField id="ceducation" label="Education" required error={errors.education}>
              <select id="ceducation" value={form.education} onChange={set('education')}><option value="">Select</option>{options.educations.map((o) => <option key={o} value={o}>{o}</option>)}</select>
            </FormField>
          )}
          {missing.has('address') && <FormField id="caddress" label="Address" required error={errors.address} className="span-2"><input id="caddress" value={form.address} maxLength={300} onChange={set('address')} /></FormField>}
          {missing.has('pincode') && <FormField id="cpincode" label="Pincode" required error={errors.pincode}><input id="cpincode" inputMode="numeric" value={form.pincode} onChange={digits('pincode', 6)} /></FormField>}
          {missing.has('district') && (
            <>
              <FormField id="cstate" label="State" required error={errors.state}>
                <select id="cstate" value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value, district: '' }))}><option value="">Select</option>{options.states.map((s) => <option key={s} value={s}>{s}</option>)}</select>
              </FormField>
              <FormField id="cdistrict" label="District" required error={errors.district}>
                <select id="cdistrict" value={form.district} onChange={set('district')}><option value="">Select</option>{districts.map((d) => <option key={d} value={d}>{d}</option>)}</select>
              </FormField>
            </>
          )}
          {missing.has('aadhaar') && <FormField id="caadhaar" label="Aadhaar number" required error={errors.aadhaar}><input id="caadhaar" inputMode="numeric" value={form.aadhaar} onChange={digits('aadhaar', 12)} /></FormField>}
          {missing.has('bankName') && <FormField id="cbank" label="Bank name" required error={errors.bankName}><input id="cbank" value={form.bankName} maxLength={80} onChange={set('bankName')} /></FormField>}
          {missing.has('ifsc') && <FormField id="cifsc" label="IFSC code" required error={errors.ifsc}><input id="cifsc" value={form.ifsc} maxLength={11} onChange={(e) => { setForm((f) => ({ ...f, ifsc: e.target.value.toUpperCase() })); setErrors((x) => ({ ...x, ifsc: undefined })); }} /></FormField>}
          {missing.has('accountNumber') && <FormField id="cacc" label="Account number" required error={errors.accountNumber}><input id="cacc" inputMode="numeric" value={form.accountNumber} onChange={digits('accountNumber', 18)} /></FormField>}
          {missing.has('memberPhoto') && <PhotoField id="memberPhoto" label="Member photo" required value={form.memberPhoto} error={errors.memberPhoto} onChange={photo('memberPhoto')} />}
          {missing.has('signaturePhoto') && <PhotoField id="signaturePhoto" label="Signature" required value={form.signaturePhoto} error={errors.signaturePhoto} onChange={photo('signaturePhoto')} />}
          {missing.has('aadhaarPhoto') && <PhotoField id="aadhaarPhoto" label="Aadhaar photo" required value={form.aadhaarPhoto} error={errors.aadhaarPhoto} onChange={photo('aadhaarPhoto')} />}
        </div>
        {errors.form && <div className="field-error" role="alert" style={{ marginTop: 10 }}>{errors.form}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save details'}</button>
        </div>
      </form>
    </Modal>
  );
}
