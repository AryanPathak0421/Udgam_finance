import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import FormField from '../../components/ui/FormField.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import { DetailList, ErrorState, PageHeader, Spinner } from '../../components/ui/Feedback.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import useLocations from '../../hooks/useLocations.js';
import { formatDate, todayIso } from '../../utils/format.js';

const EMPTY = {
  name: '', cin: '', pan: '', tan: '', incorporationDate: '', address: '',
  state: '', city: '', pincode: '', email: '', mobile: '', stampImage: null, signatureImage: null,
};

const CIN_RE = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const TAN_RE = /^[A-Z]{4}\d{5}[A-Z]$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^[6-9]\d{9}$/;
const MAX_STAMP_BYTES = 300 * 1024;

function validate(f) {
  const e = {};
  if (f.name.trim().length < 2) e.name = 'Company name is required';
  if (!CIN_RE.test(f.cin.trim().toUpperCase())) e.cin = 'Enter a valid 21-character CIN (e.g. U65999BR2020PTC012345)';
  if (!PAN_RE.test(f.pan.trim().toUpperCase())) e.pan = 'Enter a valid PAN (e.g. ABCDE1234F)';
  if (!TAN_RE.test(f.tan.trim().toUpperCase())) e.tan = 'Enter a valid TAN (e.g. ABCD12345E)';
  if (!f.incorporationDate) e.incorporationDate = 'Date of incorporation is required';
  else if (f.incorporationDate > todayIso()) e.incorporationDate = 'Date cannot be in the future';
  if (f.address.trim().length < 5) e.address = 'Address is required (min 5 characters)';
  if (f.pincode && !/^\d{6}$/.test(f.pincode)) e.pincode = 'Pincode must be 6 digits';
  if (!EMAIL_RE.test(f.email.trim())) e.email = 'Enter a valid email address';
  if (!MOBILE_RE.test(f.mobile.trim())) e.mobile = 'Enter a valid 10-digit mobile number';
  return e;
}

export default function CompanyProfile() {
  const toast = useToast();
  const stampRef = useRef(null);
  const signRef = useRef(null);
  const [company, setCompany] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [mode, setMode] = useState('view'); // view | edit
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { states, cities } = useLocations(form.state);
  const pendingCity = useRef('');
  const [pinNote, setPinNote] = useState('');

  const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
  const pickCity = (list, name) => list.find((c) => norm(c) === norm(name)) || list.find((c) => norm(c).startsWith(norm(name)) || norm(name).startsWith(norm(c))) || '';

  // Pincode: fill in the state and the city.
  useEffect(() => {
    if (mode !== 'edit' || !/^[1-9]\d{5}$/.test(form.pincode)) {
      setPinNote('');
      return undefined;
    }
    let live = true;
    api.members
      .pincode(form.pincode)
      .then((r) => {
        if (!live) return;
        if (r.status === 'ok' && r.stateKnown) {
          setPinNote(`✓ ${r.postalDistrict}, ${r.state}`);
          setForm((f) => {
            if (f.state === r.state) return { ...f, city: pickCity(cities, r.postalDistrict) || f.city };
            pendingCity.current = r.postalDistrict;
            return { ...f, state: r.state, city: '' };
          });
        } else setPinNote(r.status === 'invalid' ? 'This pincode does not exist' : '');
      })
      .catch(() => live && setPinNote(''));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.pincode, mode]);

  // The city that goes with a pincode is applied once the cities of the new state are loaded.
  useEffect(() => {
    if (pendingCity.current && cities.length) {
      const c = pickCity(cities, pendingCity.current);
      pendingCity.current = '';
      if (c) setForm((f) => ({ ...f, city: c }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cities]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { company: c } = await api.company.get();
      setCompany(c);
      setForm(c ? { ...EMPTY, ...c } : EMPTY);
      setMode(c ? 'view' : 'edit');
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = (key) => (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [key]: value, ...(key === 'state' ? { city: '' } : {}) }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  // Reads a PNG/JPEG (≤ 300 KB) into the given form field as a data URL.
  const onImageChange = (field, label) => (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setErrors((er) => ({ ...er, [field]: `${label} must be a PNG or JPEG image` }));
      return;
    }
    if (file.size > MAX_STAMP_BYTES) {
      setErrors((er) => ({ ...er, [field]: `${label} image must be 300 KB or smaller` }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setForm((f) => ({ ...f, [field]: reader.result }));
      setErrors((er) => ({ ...er, [field]: undefined }));
    };
    reader.readAsDataURL(file);
  };

  function onSubmit(e) {
    e.preventDefault();
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    // Creating the first profile saves directly; updating asks for confirmation.
    if (company) setConfirmOpen(true);
    else save();
  }

  async function save() {
    setSaving(true);
    try {
      const { company: saved } = await api.company.save({
        ...form,
        cin: form.cin.toUpperCase(),
        pan: form.pan.toUpperCase(),
        tan: form.tan.toUpperCase(),
      });
      setCompany(saved);
      setForm({ ...EMPTY, ...saved });
      setMode('view');
      setConfirmOpen(false);
      toast.success(company ? 'Company profile updated' : 'Company profile created');
    } catch (err) {
      setConfirmOpen(false);
      setErrors(err.errors || {});
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setErrors({});
    setForm(company ? { ...EMPTY, ...company } : EMPTY);
    if (company) setMode('view');
  }

  if (loading) return <Spinner label="Loading company profile…" />;
  if (loadError) return <ErrorState message={loadError} onRetry={load} />;

  const isEdit = mode === 'edit';

  return (
    <>
      <PageHeader
        title="Company Profile"
        description="Primary company details used across the system — documents, receipts and reports."
        actions={
          !isEdit && (
            <button className="btn primary" onClick={() => setMode('edit')}>
              Edit profile
            </button>
          )
        }
      />

      {!company && (
        <div className="notice">No company profile exists yet. Fill in the details below to create it.</div>
      )}

      {!isEdit && company && (
        <div className="panel">
          <DetailList
            items={[
              ['Company name', company.name],
              ['CIN', company.cin],
              ['PAN', company.pan],
              ['TAN', company.tan],
              ['Date of incorporation', formatDate(company.incorporationDate)],
              ['Email', company.email],
              ['Mobile / contact', company.mobile],
              ['Address', [company.address, company.city, company.state, company.pincode].filter(Boolean).join(', ')],
            ]}
          />
          <div className="stamp-view sign-row">
            <div>
              <div className="detail-label">Authorised signature</div>
              {company.signatureImage ? (
                <img src={company.signatureImage} alt="Authorised signature" className="stamp-img" />
              ) : (
                <span className="muted">No signature uploaded</span>
              )}
            </div>
            <div>
              <div className="detail-label">Company stamp</div>
              {company.stampImage ? (
                <img src={company.stampImage} alt="Company stamp" className="stamp-img" />
              ) : (
                <span className="muted">No stamp uploaded</span>
              )}
            </div>
          </div>
        </div>
      )}

      {isEdit && (
        <form className="panel" onSubmit={onSubmit} noValidate>
          <h3 className="section-title">Company details</h3>
          <div className="form-grid">
            <FormField id="name" label="Company name" required error={errors.name} className="span-2">
              <input id="name" value={form.name} onChange={set('name')} maxLength={150} />
            </FormField>
            <FormField id="cin" label="CIN" required error={errors.cin} hint="21-character Corporate Identification Number">
              <input id="cin" value={form.cin} onChange={set('cin')} maxLength={21} style={{ textTransform: 'uppercase' }} />
            </FormField>
            <FormField id="incorporationDate" label="Date of incorporation" required error={errors.incorporationDate}>
              <input id="incorporationDate" type="date" max={todayIso()} value={form.incorporationDate} onChange={set('incorporationDate')} />
            </FormField>
            <FormField id="pan" label="PAN" required error={errors.pan}>
              <input id="pan" value={form.pan} onChange={set('pan')} maxLength={10} style={{ textTransform: 'uppercase' }} />
            </FormField>
            <FormField id="tan" label="TAN" required error={errors.tan}>
              <input id="tan" value={form.tan} onChange={set('tan')} maxLength={10} style={{ textTransform: 'uppercase' }} />
            </FormField>
          </div>

          <h3 className="section-title">Contact & address</h3>
          <div className="form-grid">
            <FormField id="email" label="Email" required error={errors.email}>
              <input id="email" type="email" value={form.email} onChange={set('email')} />
            </FormField>
            <FormField id="mobile" label="Mobile / contact number" required error={errors.mobile}>
              <input id="mobile" inputMode="numeric" value={form.mobile} onChange={set('mobile')} maxLength={10} />
            </FormField>
            <FormField id="address" label="Address" required error={errors.address} className="span-2">
              <textarea id="address" rows={3} value={form.address} onChange={set('address')} maxLength={300} />
            </FormField>
            <FormField id="state" label="State" error={errors.state}>
              <select id="state" value={form.state} onChange={set('state')}>
                <option value="">Select state</option>
                {states.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </FormField>
            <FormField id="city" label="City" error={errors.city}>
              <select id="city" value={form.city} onChange={set('city')} disabled={!form.state}>
                <option value="">{form.state ? 'Select city' : 'Select state first'}</option>
                {cities.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </FormField>
            <FormField id="pincode" label="Pincode" error={errors.pincode} hint={pinNote || 'State and city are filled in from the pincode'}>
              <input id="pincode" inputMode="numeric" value={form.pincode} onChange={set('pincode')} maxLength={6} />
            </FormField>
          </div>

          <h3 className="section-title">Sign &amp; stamp</h3>
          <div className="form-grid">
            <FormField id="signature" label="Authorised signature" error={errors.signatureImage} hint="PNG or JPEG, up to 300 KB">
              <div className="stamp-upload">
                {form.signatureImage ? (
                  <img src={form.signatureImage} alt="Signature preview" className="stamp-img" />
                ) : (
                  <div className="stamp-empty">No signature</div>
                )}
                <div className="stamp-actions">
                  <input id="signature" ref={signRef} type="file" accept="image/png,image/jpeg" onChange={onImageChange('signatureImage', 'Signature')} hidden />
                  <button type="button" className="btn" onClick={() => signRef.current?.click()}>
                    {form.signatureImage ? 'Replace' : 'Upload'}
                  </button>
                  {form.signatureImage && (
                    <button type="button" className="btn" onClick={() => setForm((f) => ({ ...f, signatureImage: null }))}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </FormField>

            <FormField id="stamp" label="Company stamp" error={errors.stampImage} hint="PNG or JPEG, up to 300 KB">
              <div className="stamp-upload">
                {form.stampImage ? (
                  <img src={form.stampImage} alt="Company stamp preview" className="stamp-img" />
                ) : (
                  <div className="stamp-empty">No stamp</div>
                )}
                <div className="stamp-actions">
                  <input id="stamp" ref={stampRef} type="file" accept="image/png,image/jpeg" onChange={onImageChange('stampImage', 'Stamp')} hidden />
                  <button type="button" className="btn" onClick={() => stampRef.current?.click()}>
                    {form.stampImage ? 'Replace' : 'Upload'}
                  </button>
                  {form.stampImage && (
                    <button type="button" className="btn" onClick={() => setForm((f) => ({ ...f, stampImage: null }))}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </FormField>
          </div>

          <div className="form-actions">
            {company && (
              <button type="button" className="btn" onClick={cancel} disabled={saving}>
                Cancel
              </button>
            )}
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? 'Saving…' : company ? 'Update profile' : 'Save profile'}
            </button>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Update company profile?"
        message="These details are used on documents, receipts and reports across the system. Changes apply immediately."
        confirmLabel="Yes, update"
        loading={saving}
        onConfirm={save}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
