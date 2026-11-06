import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';
import { compressImage } from '../../../utils/image.js';

export default function EmployeeCenterVisits() {
  const { t } = useEmployeeApp();
  const [tab, setTab] = useState('new'); // 'new' | 'cgt'

  // New Center Visit Form state
  const [form, setForm] = useState({
    centerName: '',
    contactName: '',
    contactNumber: '',
    notes: '',
    image: '',
  });
  const [location, setLocation] = useState(null);
  const [locLoading, setLocLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState({ text: '', type: '' });

  // CGT Visit state
  const [cgtVisits, setCgtVisits] = useState([]);
  const [surveyedCenters, setSurveyedCenters] = useState([]);
  const [selectedCenterDropdown, setSelectedCenterDropdown] = useState('');
  const [loadingCgt, setLoadingCgt] = useState(false);
  const [cgtModal, setCgtModal] = useState(null); // { centerName, day, date }
  const [cgtPhoto, setCgtPhoto] = useState('');
  const [cgtSubmitting, setCgtSubmitting] = useState(false);

  // Auto detect GPS location on mount
  useEffect(() => {
    if (navigator.geolocation) {
      setLocLoading(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            address: `GPS (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)})`,
          });
          setLocLoading(false);
        },
        () => setLocLoading(false)
      );
    }
  }, []);

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const b64 = await compressImage(file, { maxWidth: 1000, maxHeight: 1000, quality: 0.8 });
      setForm((f) => ({ ...f, image: b64 }));
    } catch {
      alert('Photo compression failed');
    }
  };

  const handleSubmitNewVisit = async (e) => {
    e.preventDefault();
    if (!form.centerName || !form.contactName || !form.contactNumber) {
      setMsg({ text: 'Center name, contact name and mobile number are required', type: 'error' });
      return;
    }

    setSubmitting(true);
    setMsg({ text: '', type: '' });
    try {
      const res = await api.employeeApp.recordCenterVisit({
        ...form,
        location,
      });
      setMsg({ text: res.message, type: 'success' });
      setForm({ centerName: '', contactName: '', contactNumber: '', notes: '', image: '' });
    } catch (err) {
      setMsg({ text: err.message || 'Failed to submit center visit', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  // Fetch CGT Visits
  const fetchCgt = async () => {
    setLoadingCgt(true);
    try {
      const res = await api.employeeApp.cgtVisits();
      setCgtVisits(res.items || []);
      setSurveyedCenters(res.centers || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingCgt(false);
    }
  };

  useEffect(() => {
    if (tab === 'cgt') fetchCgt();
  }, [tab]);

  const handleCgtPhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const b64 = await compressImage(file, { maxWidth: 1000, maxHeight: 1000, quality: 0.8 });
      setCgtPhoto(b64);
    } catch {
      alert('Photo upload failed');
    }
  };

  const handleSaveCgtDay = async () => {
    if (!cgtPhoto || !cgtModal) return;
    setCgtSubmitting(true);
    try {
      await api.employeeApp.updateCgtPhoto({
        centerName: cgtModal.centerName,
        day: cgtModal.day,
        photo: cgtPhoto,
        date: cgtModal.date || new Date().toISOString().slice(0, 10),
      });
      setCgtModal(null);
      setCgtPhoto('');
      fetchCgt();
    } catch (err) {
      alert(err.message || 'Failed to update CGT photo');
    } finally {
      setCgtSubmitting(false);
    }
  };

  return (
    <div className="emp-page-container">
      {/* Tab Switcher */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button
          type="button"
          className={tab === 'new' ? 'emp-btn-primary' : 'emp-btn-secondary'}
          style={{ flex: 1, padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 700 }}
          onClick={() => setTab('new')}
        >
          <Icon name="mappin" size={16} />
          <span>New Center Visit</span>
        </button>
        <button
          type="button"
          className={tab === 'cgt' ? 'emp-btn-primary' : 'emp-btn-secondary'}
          style={{ flex: 1, padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 700 }}
          onClick={() => setTab('cgt')}
        >
          <Icon name="users" size={16} />
          <span>CGT 1,2,3 Visits</span>
        </button>
      </div>

      {msg.text && (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 8,
            fontSize: '0.85rem',
            marginBottom: 12,
            background: msg.type === 'success' ? '#dcfce7' : '#fee2e2',
            color: msg.type === 'success' ? '#166534' : '#991b1b',
          }}
        >
          {msg.text}
        </div>
      )}

      {/* Tab 1: New Center Visit */}
      {tab === 'new' && (
        <div className="emp-card">
          <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 6px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="building" size={20} style={{ color: 'var(--emp-primary)' }} />
            <span>New Center Visit Update</span>
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', margin: '0 0 16px 0' }}>
            Location is auto-detected via GPS. Record contact person name, mobile number, and photo.
          </p>

          <form onSubmit={handleSubmitNewVisit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Auto GPS Card */}
            <div style={{ background: 'var(--emp-card-bg)', border: '1px solid var(--emp-border)', borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)' }}>Auto GPS Coordinates:</div>
              <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--emp-primary)', marginTop: 2 }}>
                {locLoading ? 'Detecting coordinates...' : location?.address || 'GPS Location detected'}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                Center / Village Name *
              </label>
              <input
                type="text"
                className="emp-input"
                placeholder="e.g. Rampur Center #2"
                value={form.centerName}
                onChange={(e) => setForm({ ...form, centerName: e.target.value })}
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  Contact Person Name *
                </label>
                <input
                  type="text"
                  className="emp-input"
                  placeholder="Leader / Member"
                  value={form.contactName}
                  onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  Mobile Number *
                </label>
                <input
                  type="tel"
                  className="emp-input"
                  maxLength="10"
                  placeholder="10 digits"
                  value={form.contactNumber}
                  onChange={(e) => setForm({ ...form, contactNumber: e.target.value.replace(/\D/g, '') })}
                  required
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                Center Meeting Photo (Camera Only)
              </label>
              <input type="file" accept="image/*" capture="environment" onChange={handleImageUpload} style={{ fontSize: '0.8rem', width: '100%' }} />
              {form.image && <img src={form.image} alt="preview" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 8, marginTop: 6 }} />}
            </div>

            <div>
              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                Visit Notes / Observations
              </label>
              <textarea
                className="emp-input"
                rows="2"
                placeholder="e.g. 15 ladies gathered, group formation initiated"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            <button
              type="submit"
              className="emp-btn-primary"
              style={{ padding: '12px', fontSize: '0.95rem', fontWeight: 800, marginTop: 4 }}
              disabled={submitting}
            >
              {submitting ? 'Submitting Visit...' : '✓ Submit Center Visit'}
            </button>
          </form>
        </div>
      )}

      {/* Tab 2: CGT Visit (Day 1, 2, 3 Click & Photo Update) */}
      {tab === 'cgt' && (
        <div>
          <div className="emp-card" style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800, margin: '0 0 4px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="users" size={18} style={{ color: 'var(--emp-primary)' }} />
              <span>CGT (Continuous Group Training)</span>
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', margin: 0 }}>
              Select surveyed center from dropdown or click on Day 1, 2, 3 below to update date-wise camera photos.
            </p>
          </div>

          {/* Surveyed Centers Dropdown for CGT */}
          <div className="emp-card" style={{ marginBottom: 12, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
            <label style={{ fontSize: '0.82rem', fontWeight: 800, color: '#166534', display: 'block', marginBottom: 4 }}>
              Select Surveyed Center for CGT (from New Center Visits):
            </label>
            <select
              className="emp-input"
              value={selectedCenterDropdown}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedCenterDropdown(val);
                if (val) {
                  setCgtModal({ centerName: val, day: 1, date: new Date().toISOString().slice(0, 10) });
                }
              }}
            >
              <option value="">-- Choose Surveyed Center --</option>
              {surveyedCenters.map((sc, idx) => (
                <option key={idx} value={sc.centerName}>
                  {sc.centerName} ({sc.contactName || 'Leader'})
                </option>
              ))}
            </select>
          </div>

          {loadingCgt ? (
            <div style={{ textAlign: 'center', padding: '30px', color: 'var(--emp-text-muted)' }}>Loading CGT centers...</div>
          ) : cgtVisits.length === 0 ? (
            <div className="emp-card" style={{ textAlign: 'center', padding: '30px', color: 'var(--emp-text-muted)' }}>
              <div style={{ color: 'var(--emp-text-muted)', marginBottom: 8 }}><Icon name="book" size={36} /></div>
              <div style={{ fontWeight: 600 }}>No active CGT centers found</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', marginTop: 4 }}>
                Select a surveyed center from the dropdown above to start CGT.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {cgtVisits.map((c) => (
                <div key={c._id} className="emp-card" style={{ margin: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--emp-text)' }}>
                      {c.centerName}
                    </div>
                    <span className={`emp-badge ${c.status === 'completed' ? 'emp-badge-success' : 'emp-badge-warning'}`}>
                      {c.status === 'completed' ? '✓ CGT Complete' : 'In Progress'}
                    </span>
                  </div>

                  {/* Day 1, Day 2, Day 3 Clickable Buttons */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    {[1, 2, 3].map((d) => {
                      const dayData = c[`day${d}`];
                      const hasPhoto = Boolean(dayData?.photo);
                      const dayDate = dayData?.date ? new Date(dayData.date).toLocaleDateString() : '';

                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setCgtModal({
                            centerName: c.centerName,
                            day: d,
                            date: dayData?.date ? new Date(dayData.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
                          })}
                          style={{
                            padding: '10px 6px',
                            borderRadius: 8,
                            textAlign: 'center',
                            cursor: 'pointer',
                            border: hasPhoto ? '2px solid #10b981' : '1px solid var(--emp-border)',
                            background: hasPhoto ? '#ecfdf5' : 'var(--emp-card-bg)',
                          }}
                        >
                          <div style={{ fontWeight: 800, fontSize: '0.85rem', color: hasPhoto ? '#047857' : 'var(--emp-text)' }}>
                            Day {d} {hasPhoto ? '✓' : ''}
                          </div>
                          {dayDate && (
                            <div style={{ fontSize: '0.66rem', color: '#047857', marginTop: 2 }}>
                              {dayDate}
                            </div>
                          )}
                          <div style={{ fontSize: '0.68rem', color: hasPhoto ? '#047857' : 'var(--emp-primary)', marginTop: 2 }}>
                            {hasPhoto ? 'Update Photo' : '+ Click to Add'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* CGT Photo Upload Modal */}
          {cgtModal && (
            <div className="emp-modal-overlay" onClick={() => setCgtModal(null)}>
              <div className="emp-modal-sheet" onClick={(e) => e.stopPropagation()}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800, margin: '0 0 4px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="camera" size={18} style={{ color: 'var(--emp-primary)' }} />
                  <span>CGT Day {cgtModal.day} Update: {cgtModal.centerName}</span>
                </h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', margin: '0 0 14px 0' }}>
                  Select the visit date and capture live meeting photo via camera (Gallery disabled).
                </p>

                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                    Day {cgtModal.day} Visit Date *
                  </label>
                  <input
                    type="date"
                    className="emp-input"
                    value={cgtModal.date || new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setCgtModal((m) => ({ ...m, date: e.target.value }))}
                    required
                  />
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                    Day {cgtModal.day} Live Camera Photo *
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleCgtPhotoUpload}
                    style={{ fontSize: '0.85rem', width: '100%' }}
                  />
                  <div style={{ fontSize: '0.72rem', color: '#b91c1c', marginTop: 4, fontWeight: 600 }}>
                    ⚠️ Camera capture only. Gallery selection option has been removed.
                  </div>
                </div>

                {cgtPhoto && (
                  <div style={{ textAlign: 'center', marginBottom: 14 }}>
                    <img src={cgtPhoto} alt="CGT preview" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 8 }} />
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10 }}>
                  <button type="button" className="emp-btn-secondary" style={{ flex: 1 }} onClick={() => setCgtModal(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="emp-btn-primary"
                    style={{ flex: 1 }}
                    onClick={handleSaveCgtDay}
                    disabled={cgtSubmitting || !cgtPhoto}
                  >
                    {cgtSubmitting ? 'Saving...' : `Save Day ${cgtModal.day} Photo`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
