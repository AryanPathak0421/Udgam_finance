import { useEffect, useState, useRef } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

const RELATIONS = ['Husband', 'Father', 'Mother', 'Son', 'Daughter', 'Brother', 'Sister', 'Uncle', 'Other'];

// Compress image helper
async function compressImageFile(file, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const elem = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        elem.width = width;
        elem.height = height;
        const ctx = elem.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(elem.toDataURL('image/jpeg', quality));
      };
      img.onerror = (e) => reject(e);
    };
    reader.onerror = (e) => reject(e);
  });
}

export default function EmployeeGuarantorChange() {
  const { empUser, t } = useEmployeeApp();
  const [tab, setTab] = useState('new'); // 'new' | 'list'
  const [query, setQuery] = useState('');
  const [member, setMember] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form Fields
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('Husband');
  const [mobile, setMobile] = useState('');
  const [aadhaar, setAadhaar] = useState('');
  const [pan, setPan] = useState('');
  const [address, setAddress] = useState('');
  const [reason, setReason] = useState('');

  // Photos
  const [photo, setPhoto] = useState('');
  const [signature, setSignature] = useState('');
  const [aadhaarPhoto, setAadhaarPhoto] = useState('');
  const [aadhaarBackPhoto, setAadhaarBackPhoto] = useState('');
  const [panPhoto, setPanPhoto] = useState('');
  const [uploadingDoc, setUploadingDoc] = useState('');

  const [submitting, setSubmitting] = useState(false);

  // List of requests
  const [requests, setRequests] = useState([]);
  const [listLoading, setListLoading] = useState(false);

  const photoInputRef = useRef(null);
  const sigInputRef = useRef(null);
  const aadhaarFrontRef = useRef(null);
  const aadhaarBackRef = useRef(null);
  const panInputRef = useRef(null);

  const fetchRequests = async () => {
    setListLoading(true);
    try {
      const data = await api.employeeApp.guarantorRequests();
      setRequests(data.items || []);
    } catch (err) {
      console.error(err);
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'list') {
      fetchRequests();
    }
  }, [tab]);

  const handleSearch = async (e) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearchLoading(true);
    setError('');
    setMember(null);
    try {
      const data = await api.employeeApp.memberSynopsis(query.trim());
      const mem = data.member || data;
      setMember(mem);
    } catch (err) {
      setError(err.message || 'Member not found');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleFileUpload = async (e, setter, key) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingDoc(key);
    try {
      const compressed = await compressImageFile(file, 800, 0.75);
      setter(compressed);
    } catch (err) {
      setError(`Failed to read ${key} image: ${err.message}`);
    } finally {
      setUploadingDoc('');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!member) return;
    if (!name.trim()) return setError('Please enter new guarantor full name');
    if (!/^\d{10}$/.test(mobile.replace(/\D/g, ''))) return setError('Enter valid 10-digit mobile number for new guarantor');
    if (!photo) return setError('Guarantor photo is required');
    if (!signature) return setError('Guarantor signature photo is required');

    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      await api.employeeApp.requestGuarantorChange({
        memberId: member.id || member._id,
        memberCode: member.code,
        name: name.trim(),
        relation,
        mobile: mobile.replace(/\D/g, '').slice(-10),
        aadhaar: aadhaar.replace(/\D/g, ''),
        pan: pan.trim().toUpperCase(),
        address: address.trim(),
        reason: reason.trim(),
        photo,
        signature,
        aadhaarPhoto,
        aadhaarBackPhoto,
        panPhoto,
      });
      setSuccess('Guarantor change request submitted for Branch Manager approval with all KYC documents!');
      setName('');
      setMobile('');
      setAadhaar('');
      setPan('');
      setAddress('');
      setReason('');
      setPhoto('');
      setSignature('');
      setAadhaarPhoto('');
      setAadhaarBackPhoto('');
      setPanPhoto('');
      setMember(null);
      setQuery('');
      setTimeout(() => setTab('list'), 1500);
    } catch (err) {
      setError(err.message || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="emp-page-container">
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <button
          className={tab === 'new' ? 'emp-btn-primary' : 'emp-btn-secondary'}
          style={{ flex: 1, padding: '10px 0', fontSize: '0.9rem' }}
          onClick={() => setTab('new')}
        >
          + Request Change
        </button>
        <button
          className={tab === 'list' ? 'emp-btn-primary' : 'emp-btn-secondary'}
          style={{ flex: 1, padding: '10px 0', fontSize: '0.9rem' }}
          onClick={() => setTab('list')}
        >
          View Requests {requests.length > 0 && `(${requests.length})`}
        </button>
      </div>

      {tab === 'new' ? (
        <>
          {/* Member Search */}
          <div className="emp-card">
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 10px 0', color: 'var(--emp-text)' }}>
              1. Select Borrower
            </h3>
            <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10 }}>
              <input
                type="text"
                className="emp-input"
                placeholder="Borrower Code, Phone, or Aadhaar..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="submit" className="emp-btn-primary" style={{ padding: '0 16px' }} disabled={searchLoading}>
                {searchLoading ? 'Finding...' : 'Find'}
              </button>
            </form>
          </div>

          {error && (
            <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 12 }}>
              {error}
            </div>
          )}

          {success && (
            <div style={{ background: '#dcfce7', color: '#15803d', padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 12 }}>
              {success}
            </div>
          )}

          {member && (
            <form onSubmit={handleSubmit}>
              {/* Existing Guarantor Information */}
              <div className="emp-card">
                <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 10px 0', color: 'var(--emp-text)' }}>
                  Current Borrower & Guarantor Details
                </h3>
                <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, fontSize: '0.82rem', lineHeight: 1.6 }}>
                  <div><strong>Borrower:</strong> {member.name} ({member.code})</div>
                  <div><strong>Mobile:</strong> {member.mobile || 'N/A'} • Branch: {member.branchName || member.branch || 'N/A'}</div>
                  <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 8, paddingTop: 8 }}>
                    <div style={{ color: '#b45309', fontWeight: 700 }}>Existing Guarantor on Record:</div>
                    <div>Name: <strong>{member.guarantor?.name || 'Not Available'}</strong></div>
                    <div>Relation: {member.guarantor?.relation || 'N/A'} • Phone: {member.guarantor?.mobile || 'N/A'}</div>
                    <div>Aadhaar: {member.guarantor?.aadhaar || 'N/A'}</div>
                  </div>
                </div>
              </div>

              {/* New Guarantor Information Card */}
              <div className="emp-card">
                <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 14px 0', color: 'var(--emp-text)' }}>
                  2. New Guarantor Information (Software Matching)
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      Full Name *
                    </label>
                    <input
                      type="text"
                      className="emp-input"
                      placeholder="As per Aadhaar"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      Relation *
                    </label>
                    <select
                      className="emp-input"
                      value={relation}
                      onChange={(e) => setRelation(e.target.value)}
                    >
                      {RELATIONS.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      Mobile Number *
                    </label>
                    <input
                      type="tel"
                      className="emp-input"
                      placeholder="10-digit phone"
                      maxLength={10}
                      value={mobile}
                      onChange={(e) => setMobile(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      Aadhaar Number
                    </label>
                    <input
                      type="text"
                      className="emp-input"
                      placeholder="12-digit UIDAI"
                      maxLength={12}
                      value={aadhaar}
                      onChange={(e) => setAadhaar(e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      PAN Card (Optional)
                    </label>
                    <input
                      type="text"
                      className="emp-input"
                      placeholder="e.g. ABCDE1234F"
                      maxLength={10}
                      value={pan}
                      onChange={(e) => setPan(e.target.value.toUpperCase())}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      Full Address
                    </label>
                    <input
                      type="text"
                      className="emp-input"
                      placeholder="Village, Post, Dist"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                    Reason for Guarantor Replacement *
                  </label>
                  <textarea
                    className="emp-input"
                    rows={2}
                    placeholder="Explain why the guarantor is being changed (e.g., deceased, relocated, sickness, borrower family request)..."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Document and Photo Uploads Card */}
              <div className="emp-card">
                <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 14px 0', color: 'var(--emp-text)' }}>
                  3. Guarantor KYC Documents & Photos
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {/* Guarantor Photo */}
                  <div style={{ border: '1px dashed var(--emp-border)', padding: 10, borderRadius: 8, textAlign: 'center' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: 6 }}>Guarantor Photo *</div>
                    {photo ? (
                      <div>
                        <img src={photo} alt="Guarantor" style={{ width: 70, height: 70, objectFit: 'cover', borderRadius: 6, marginBottom: 6 }} />
                        <button type="button" className="emp-btn-secondary" style={{ padding: '2px 8px', fontSize: '0.7rem' }} onClick={() => photoInputRef.current?.click()}>
                          Retake
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="emp-btn-primary" style={{ fontSize: '0.75rem', padding: '6px 12px' }} onClick={() => photoInputRef.current?.click()}>
                        📷 Upload Photo
                      </button>
                    )}
                    <input ref={photoInputRef} type="file" accept="image/*" capture="user" style={{ display: 'none' }} onChange={(e) => handleFileUpload(e, setPhoto, 'Photo')} />
                  </div>

                  {/* Guarantor Signature */}
                  <div style={{ border: '1px dashed var(--emp-border)', padding: 10, borderRadius: 8, textAlign: 'center' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: 6 }}>Signature *</div>
                    {signature ? (
                      <div>
                        <img src={signature} alt="Signature" style={{ width: 70, height: 70, objectFit: 'contain', borderRadius: 6, marginBottom: 6 }} />
                        <button type="button" className="emp-btn-secondary" style={{ padding: '2px 8px', fontSize: '0.7rem' }} onClick={() => sigInputRef.current?.click()}>
                          Retake
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="emp-btn-primary" style={{ fontSize: '0.75rem', padding: '6px 12px' }} onClick={() => sigInputRef.current?.click()}>
                        ✍️ Upload Signature
                      </button>
                    )}
                    <input ref={sigInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleFileUpload(e, setSignature, 'Signature')} />
                  </div>

                  {/* Aadhaar Front */}
                  <div style={{ border: '1px dashed var(--emp-border)', padding: 10, borderRadius: 8, textAlign: 'center' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: 6 }}>Aadhaar Front</div>
                    {aadhaarPhoto ? (
                      <div>
                        <img src={aadhaarPhoto} alt="Aadhaar Front" style={{ width: 70, height: 70, objectFit: 'cover', borderRadius: 6, marginBottom: 6 }} />
                        <button type="button" className="emp-btn-secondary" style={{ padding: '2px 8px', fontSize: '0.7rem' }} onClick={() => aadhaarFrontRef.current?.click()}>
                          Retake
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="emp-btn-secondary" style={{ fontSize: '0.75rem', padding: '6px 12px' }} onClick={() => aadhaarFrontRef.current?.click()}>
                        📄 Aadhaar Front
                      </button>
                    )}
                    <input ref={aadhaarFrontRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleFileUpload(e, setAadhaarPhoto, 'Aadhaar Front')} />
                  </div>

                  {/* Aadhaar Back */}
                  <div style={{ border: '1px dashed var(--emp-border)', padding: 10, borderRadius: 8, textAlign: 'center' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: 6 }}>Aadhaar Back</div>
                    {aadhaarBackPhoto ? (
                      <div>
                        <img src={aadhaarBackPhoto} alt="Aadhaar Back" style={{ width: 70, height: 70, objectFit: 'cover', borderRadius: 6, marginBottom: 6 }} />
                        <button type="button" className="emp-btn-secondary" style={{ padding: '2px 8px', fontSize: '0.7rem' }} onClick={() => aadhaarBackRef.current?.click()}>
                          Retake
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="emp-btn-secondary" style={{ fontSize: '0.75rem', padding: '6px 12px' }} onClick={() => aadhaarBackRef.current?.click()}>
                        📄 Aadhaar Back
                      </button>
                    )}
                    <input ref={aadhaarBackRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleFileUpload(e, setAadhaarBackPhoto, 'Aadhaar Back')} />
                  </div>
                </div>

                {uploadingDoc && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--emp-primary)', marginTop: 10, textAlign: 'center' }}>
                    Compressing & preparing {uploadingDoc}...
                  </div>
                )}
              </div>

              <button
                type="submit"
                className="emp-btn-primary"
                style={{ width: '100%', padding: '12px 0', fontSize: '1rem', fontWeight: 700 }}
                disabled={submitting}
              >
                {submitting ? 'Submitting Request...' : 'Submit Guarantor Change for Approval'}
              </button>
            </form>
          )}
        </>
      ) : (
        /* List of submitted requests */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {listLoading ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--emp-text-muted)' }}>
              Loading requests...
            </div>
          ) : requests.length === 0 ? (
            <div className="emp-card" style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--emp-text-muted)' }}>
              No guarantor change requests found.
            </div>
          ) : (
            requests.map((r) => (
              <div key={r._id || r.id} className="emp-card" style={{ margin: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--emp-text)' }}>
                      {r.memberName} ({r.memberCode})
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                      Submitted: {new Date(r.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <span
                    className={`emp-badge emp-badge-${
                      r.status === 'approved' ? 'success' : r.status === 'rejected' ? 'danger' : 'warning'
                    }`}
                  >
                    {r.status?.toUpperCase()}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: '0.8rem', background: '#f8fafc', padding: 8, borderRadius: 6 }}>
                  <div>
                    <div style={{ color: 'var(--emp-text-muted)', fontSize: '0.7rem' }}>Old Guarantor</div>
                    <div style={{ fontWeight: 600 }}>{r.oldGuarantor?.name || 'N/A'}</div>
                    <div style={{ fontSize: '0.72rem' }}>{r.oldGuarantor?.relation}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--emp-text-muted)', fontSize: '0.7rem' }}>New Guarantor</div>
                    <div style={{ fontWeight: 600, color: 'var(--emp-primary)' }}>{r.newGuarantor?.name}</div>
                    <div style={{ fontSize: '0.72rem' }}>{r.newGuarantor?.relation} • {r.newGuarantor?.mobile}</div>
                  </div>
                </div>

                {r.reason && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 8 }}>
                    <strong>Reason:</strong> {r.reason}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
