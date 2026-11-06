import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function EmployeeCivilCheck() {
  const navigate = useNavigate();

  // Mode: 'new' | 'existing'
  const [mode, setMode] = useState('new');
  const [memberQuery, setMemberQuery] = useState('');
  const [searchingMember, setSearchingMember] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);

  // Form fields
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [pan, setPan] = useState('');
  const [aadhaar, setAadhaar] = useState('');
  const [dob, setDob] = useState('1992-01-01');
  const [gender, setGender] = useState('female');
  const [address, setAddress] = useState('');
  const [bureau, setBureau] = useState('CIBIL');
  const [autoAdd, setAutoAdd] = useState(true);

  // Results & status
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [addingMember, setAddingMember] = useState(false);

  // Search existing member
  const handleSearchMember = async (e) => {
    e.preventDefault();
    if (!memberQuery.trim()) return;
    setSearchingMember(true);
    setError('');
    try {
      const res = await api.employeeApp.memberSynopsis(memberQuery.trim());
      if (res && res.member) {
        setSelectedMember(res.member);
        setName(res.member.name || '');
        setMobile(res.member.mobile || '');
        setPan(res.member.pan || '');
        setAadhaar(res.member.aadhaar || '');
      } else {
        setError('No member found with this code or mobile number.');
      }
    } catch (err) {
      setError(err.message || 'Member lookup failed');
    } finally {
      setSearchingMember(false);
    }
  };

  // Perform Civil Check
  const handleCheckScore = async (e) => {
    e.preventDefault();
    if (mode === 'new' && !name.trim()) {
      return setError('Please enter person name');
    }
    if (mode === 'new' && !mobile.trim() && !pan.trim()) {
      return setError('Please enter at least mobile number or PAN');
    }

    setChecking(true);
    setError('');
    setSuccess('');
    setResult(null);

    try {
      const payload = {
        memberId: selectedMember?._id || selectedMember?.id || null,
        name: name.trim(),
        mobile: mobile.trim(),
        pan: pan.trim().toUpperCase(),
        aadhaar: aadhaar.trim(),
        dob,
        gender,
        address: address.trim(),
        bureau,
        autoAddMember: mode === 'new' && autoAdd,
      };

      const res = await api.employeeApp.checkCivilScore(payload);
      setResult(res);
      setSuccess(res.message);
    } catch (err) {
      setError(err.message || 'Failed to check civil score');
    } finally {
      setChecking(false);
    }
  };

  // Manual Add to Member section if not auto-added
  const handleAddMember = async () => {
    if (!name.trim()) return setError('Name is required');
    setAddingMember(true);
    setError('');
    try {
      const res = await api.employeeApp.addCivilCheckedMember({
        name: name.trim(),
        mobile: mobile.trim(),
        pan: pan.trim().toUpperCase(),
        aadhaar: aadhaar.trim(),
        dob,
        gender,
        address: address.trim(),
        score: result?.score,
        bureau: result?.bureau || bureau,
        reportNumber: result?.reportNumber,
      });
      setSuccess(res.message);
      if (res.member) {
        setResult((prev) => ({
          ...prev,
          member: res.member,
          createdNewMember: true,
        }));
      }
    } catch (err) {
      setError(err.message || 'Failed to add member');
    } finally {
      setAddingMember(false);
    }
  };

  return (
    <div className="emp-page-container">
      {/* Header Banner */}
      <div className="emp-card" style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 6px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="shield-check" size={22} style={{ color: 'var(--emp-primary)' }} />
          <span>Civil / Credit Score Check</span>
        </h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', margin: 0 }}>
          Check CIBIL / Experian score for new prospects or existing members and seamlessly sync them into the Member section.
        </p>
      </div>

      {/* Mode Switcher */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button
          type="button"
          className={mode === 'new' ? 'emp-btn-primary' : 'emp-btn-secondary'}
          style={{ flex: 1, padding: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          onClick={() => {
            setMode('new');
            setSelectedMember(null);
            setResult(null);
          }}
        >
          <Icon name="user-plus" size={16} />
          <span>New Prospect Check</span>
        </button>
        <button
          type="button"
          className={mode === 'existing' ? 'emp-btn-primary' : 'emp-btn-secondary'}
          style={{ flex: 1, padding: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          onClick={() => {
            setMode('existing');
            setResult(null);
          }}
        >
          <Icon name="users" size={16} />
          <span>Existing Member</span>
        </button>
      </div>

      {/* Existing Member Search */}
      {mode === 'existing' && (
        <div className="emp-card" style={{ marginBottom: 14 }}>
          <form onSubmit={handleSearchMember} style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              placeholder="Enter Member Code or Mobile..."
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
              className="emp-input"
              style={{ flex: 1 }}
            />
            <button type="submit" className="emp-btn-primary" disabled={searchingMember} style={{ padding: '0 16px' }}>
              {searchingMember ? 'Searching...' : 'Search'}
            </button>
          </form>

          {selectedMember && (
            <div style={{ marginTop: 12, padding: 12, background: 'var(--emp-card-bg)', border: '1px solid var(--emp-border)', borderRadius: 8 }}>
              <div style={{ fontWeight: 800, color: 'var(--emp-text)', fontSize: '0.95rem' }}>{selectedMember.name}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                Code: {selectedMember.code} • Mobile: {selectedMember.mobile || '—'} • PAN: {selectedMember.pan || '—'}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Check Form */}
      <div className="emp-card">
        {error && (
          <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 12 }}>
            {error}
          </div>
        )}
        {success && (
          <div style={{ background: '#dcfce7', color: '#166534', padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 12 }}>
            {success}
          </div>
        )}

        <form onSubmit={handleCheckScore} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
              Full Name *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Candidate Full Name"
              className="emp-input"
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                Mobile Number *
              </label>
              <input
                type="tel"
                maxLength={10}
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
                placeholder="10-digit mobile"
                className="emp-input"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                PAN Number
              </label>
              <input
                type="text"
                maxLength={10}
                value={pan}
                onChange={(e) => setPan(e.target.value.toUpperCase())}
                placeholder="ABCDE1234F"
                className="emp-input"
                style={{ width: '100%' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                Aadhaar (Last 4 or 12)
              </label>
              <input
                type="text"
                maxLength={12}
                value={aadhaar}
                onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, ''))}
                placeholder="Aadhaar number"
                className="emp-input"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                Date of Birth
              </label>
              <input
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                className="emp-input"
                style={{ width: '100%' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                Gender
              </label>
              <select value={gender} onChange={(e) => setGender(e.target.value)} className="emp-input" style={{ width: '100%' }}>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                Credit Bureau
              </label>
              <select value={bureau} onChange={(e) => setBureau(e.target.value)} className="emp-input" style={{ width: '100%' }}>
                <option value="CIBIL">CIBIL</option>
                <option value="EXPERIAN">EXPERIAN</option>
                <option value="EQUIFAX">EQUIFAX</option>
                <option value="CRIF">CRIF High Mark</option>
              </select>
            </div>
          </div>

          {mode === 'new' && (
            <div>
              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 4 }}>
                Village / Address
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Address / Village name"
                className="emp-input"
                style={{ width: '100%' }}
              />
            </div>
          )}

          {mode === 'new' && (
            <div style={{ background: '#f8fafc', padding: 10, borderRadius: 8, border: '1px solid var(--emp-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                id="auto-add-check"
                checked={autoAdd}
                onChange={(e) => setAutoAdd(e.target.checked)}
                style={{ width: 18, height: 18, cursor: 'pointer' }}
              />
              <label htmlFor="auto-add-check" style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--emp-text)', cursor: 'pointer' }}>
                Automatically add to Member section after Civil check
              </label>
            </div>
          )}

          <button
            type="submit"
            className="emp-btn-primary"
            style={{ padding: '12px', fontSize: '0.95rem', fontWeight: 800, marginTop: 4 }}
            disabled={checking}
          >
            {checking ? 'Checking Civil Bureau...' : '🔍 Check Civil Score'}
          </button>
        </form>

        {/* Score Card Display */}
        {result && (
          <div
            style={{
              marginTop: 18,
              padding: 16,
              borderRadius: 12,
              background: result.score >= 700 ? '#f0fdf4' : result.score >= 650 ? '#fffbeb' : '#fef2f2',
              border: `2px solid ${result.score >= 700 ? '#86efac' : result.score >= 650 ? '#fde68a' : '#fca5a5'}`,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emp-text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
              {result.bureau} Score Report
            </div>
            <div
              style={{
                fontSize: '2.4rem',
                fontWeight: 900,
                color: result.score >= 700 ? '#15803d' : result.score >= 650 ? '#b45309' : '#b91c1c',
                margin: '6px 0',
              }}
            >
              {result.score}
            </div>
            <div
              style={{
                display: 'inline-block',
                padding: '4px 14px',
                borderRadius: 20,
                fontSize: '0.82rem',
                fontWeight: 800,
                background: result.score >= 700 ? '#dcfce7' : result.score >= 650 ? '#fef3c7' : '#fee2e2',
                color: result.score >= 700 ? '#166534' : result.score >= 650 ? '#92400e' : '#991b1b',
              }}
            >
              Band: {result.band}
            </div>

            <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', marginTop: 10 }}>
              Report Ref: {result.reportNumber} • Date: {result.reportDate}
            </div>

            {/* Member Section Status */}
            {result.member ? (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed #cbd5e1' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#166534', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <Icon name="check-circle" size={18} />
                  <span>Available in Member Section ({result.member.code})</span>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', marginTop: 4 }}>
                  {result.member.name} • {result.member.mobile || 'No mobile'}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button
                    type="button"
                    className="emp-btn-secondary"
                    style={{ flex: 1, padding: '8px', fontSize: '0.8rem' }}
                    onClick={() => navigate(`/employee/synopsis?code=${result.member.code}`)}
                  >
                    View Member Synopsis
                  </button>
                  <button
                    type="button"
                    className="emp-btn-primary"
                    style={{ flex: 1, padding: '8px', fontSize: '0.8rem' }}
                    onClick={() => navigate('/employee/requisition')}
                  >
                    Loan Requisition
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed #cbd5e1' }}>
                <p style={{ fontSize: '0.82rem', color: 'var(--emp-text-muted)', margin: '0 0 10px 0' }}>
                  This person is not yet added to your branch Member section.
                </p>
                <button
                  type="button"
                  className="emp-btn-primary"
                  style={{ width: '100%', padding: '10px', fontSize: '0.9rem', fontWeight: 700 }}
                  onClick={handleAddMember}
                  disabled={addingMember}
                >
                  {addingMember ? 'Adding to Members...' : '➕ Add to Member Section Now'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
