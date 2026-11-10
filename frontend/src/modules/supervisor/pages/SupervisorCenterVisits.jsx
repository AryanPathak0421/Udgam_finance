import React, { useEffect, useState, useMemo } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorCenterVisits() {
  const [tab, setTab] = useState('branch_visits'); // 'branch_visits' | 'report' | 'submit'
  const [teamVisits, setTeamVisits] = useState([]);
  const [branchVisits, setBranchVisits] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Dropdown Filters for Team Visits (Point 6)
  const [centerFilter, setCenterFilter] = useState('all');
  const [staffFilter, setStaffFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Status Action Modal (Point 6: Done, Not Done, Cancel with remark)
  const [activeVisitAction, setActiveVisitAction] = useState(null); // { visit, targetStatus }
  const [actionRemark, setActionRemark] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  // New Branch Visit Modal (Point 9)
  const [showBranchVisitModal, setShowBranchVisitModal] = useState(false);
  const [bvBranchId, setBvBranchId] = useState('');
  const [bvDate, setBvDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [bvRoomRent, setBvRoomRent] = useState(true);
  const [bvNotes, setBvNotes] = useState('');
  const [bvSubmitting, setBvSubmitting] = useState(false);

  // Submit Visit Report state
  const [centerName, setCenterName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [image, setImage] = useState('');
  const [location, setLocation] = useState({ lat: 0, lng: 0, address: '' });
  const [gpsDetecting, setGpsDetecting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadAllVisits();
    loadSupervisorBranches();
  }, []);

  async function loadSupervisorBranches() {
    try {
      const res = await api.supervisorApp.profile();
      const list = [];
      if (res.profile?.branch) {
        list.push({ id: res.profile.branch.id || res.profile.branch, name: res.profile.branch.name || res.profile.branch });
      }
      if (Array.isArray(res.profile?.supervisedBranches)) {
        res.profile.supervisedBranches.forEach((b) => {
          if (!list.some((x) => x.id === b.id)) list.push(b);
        });
      }
      setBranches(list);
      if (list.length > 0 && !bvBranchId) setBvBranchId(list[0].id);
    } catch {}
  }

  async function loadAllVisits() {
    setLoading(true);
    setError('');
    try {
      const [teamRes, branchRes] = await Promise.all([
        api.supervisorApp.teamCenterVisits().catch(() => ({ visits: [] })),
        api.supervisorApp.branchVisits().catch(() => ({ visits: [] })),
      ]);
      setTeamVisits(teamRes.visits || []);
      setBranchVisits(branchRes.visits || []);
    } catch (err) {
      setError(err.message || 'Failed to load visits');
    } finally {
      setLoading(false);
    }
  }

  // Extract unique options for team filters
  const centerOptions = useMemo(() => {
    const set = new Set(teamVisits.map((v) => v.centerName).filter(Boolean));
    return ['all', ...Array.from(set)];
  }, [teamVisits]);

  const staffOptions = useMemo(() => {
    const set = new Set(teamVisits.map((v) => v.employeeName || v.employeeCode).filter(Boolean));
    return ['all', ...Array.from(set)];
  }, [teamVisits]);

  // Filtered team visits
  const filteredVisits = useMemo(() => {
    return teamVisits.filter((v) => {
      if (centerFilter !== 'all' && v.centerName !== centerFilter) return false;
      const staffVal = v.employeeName || v.employeeCode;
      if (staffFilter !== 'all' && staffVal !== staffFilter) return false;
      const curStatus = v.status || 'done';
      if (statusFilter !== 'all' && curStatus !== statusFilter) return false;
      return true;
    });
  }, [teamVisits, centerFilter, staffFilter, statusFilter]);

  async function handleConfirmStatusAction(e) {
    e.preventDefault();
    if (!activeVisitAction) return;
    setActionBusy(true);
    setError('');
    try {
      await api.supervisorApp.updateCenterVisitStatus(activeVisitAction.visit._id, {
        status: activeVisitAction.targetStatus,
        remark: actionRemark.trim(),
      });
      setSuccess(`✓ Center visit status updated to ${activeVisitAction.targetStatus.replace('_', ' ').toUpperCase()}`);
      setActiveVisitAction(null);
      setActionRemark('');
      loadAllVisits();
    } catch (err) {
      setError(err.message || 'Failed to update visit status');
    } finally {
      setActionBusy(false);
    }
  }

  // Point 9: Create New Branch Visit in System
  async function handleCreateBranchVisit(e) {
    e.preventDefault();
    if (!bvBranchId) {
      setError('Please select a branch to visit');
      return;
    }
    setBvSubmitting(true);
    setError('');
    try {
      const res = await api.supervisorApp.recordBranchVisit({
        branchId: bvBranchId,
        visitDate: bvDate,
        roomRentCharged: bvRoomRent,
        notes: bvNotes.trim(),
      });
      setSuccess(res.message || 'Branch visit scheduled & recorded into system successfully!');
      setShowBranchVisitModal(false);
      setBvNotes('');
      loadAllVisits();
    } catch (err) {
      setError(err.message || 'Failed to schedule branch visit');
    } finally {
      setBvSubmitting(false);
    }
  }

  async function handleUpdateBranchVisitStatus(id, newStatus) {
    setError('');
    try {
      await api.supervisorApp.updateBranchVisitStatus(id, { status: newStatus });
      setSuccess(`Branch visit marked as ${newStatus}!`);
      loadAllVisits();
    } catch (err) {
      setError(err.message || 'Failed to update branch visit status');
    }
  }

  function handleAutoCaptureLocation() {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser/device');
      return;
    }
    setGpsDetecting(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
          address: `Lat: ${pos.coords.latitude.toFixed(4)}, Lng: ${pos.coords.longitude.toFixed(4)}`,
        });
        setGpsDetecting(false);
      },
      (err) => {
        setError('Location detection failed: ' + err.message);
        setGpsDetecting(false);
      },
      { timeout: 8000 }
    );
  }

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setImage(event.target.result);
    };
    reader.readAsDataURL(file);
  };

  async function handleSubmitVisitReport(e) {
    e.preventDefault();
    if (!centerName.trim()) {
      setError('Center name is required');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.supervisorApp.recordCenterVisitReport({
        centerName: centerName.trim(),
        groupName: groupName.trim(),
        contactPerson: contactName.trim(),
        contactNumber: contactNumber.trim(),
        notes: notes.trim(),
        image,
        location,
      });
      setSuccess('✓ Center visit report submitted successfully!');
      setCenterName('');
      setGroupName('');
      setContactName('');
      setContactNumber('');
      setNotes('');
      setImage('');
      setTab('branch_visits');
      loadAllVisits();
    } catch (err) {
      setError(err.message || 'Failed to submit visit report');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sup-page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Branch &amp; Center Visits</h2>
          <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>
            System Branch Audits, Field Inspections &amp; Team Tracking
          </div>
        </div>

        {tab === 'branch_visits' && (
          <button
            type="button"
            className="sup-btn sm"
            style={{ width: 'auto' }}
            onClick={() => setShowBranchVisitModal(true)}
          >
            <Icon name="plus" size={14} />
            <span>New Branch Visit</span>
          </button>
        )}
      </div>

      {/* 3 Tabs */}
      <div style={{ display: 'flex', background: 'var(--sup-border)', borderRadius: 10, padding: 3, marginBottom: 14 }}>
        <button
          type="button"
          style={{
            flex: 1,
            padding: '8px 0',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.8rem',
            background: tab === 'branch_visits' ? 'var(--sup-card-bg)' : 'transparent',
            color: tab === 'branch_visits' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            cursor: 'pointer',
          }}
          onClick={() => setTab('branch_visits')}
        >
          Branch Visits ({branchVisits.length})
        </button>
        <button
          type="button"
          style={{
            flex: 1,
            padding: '8px 0',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.8rem',
            background: tab === 'report' ? 'var(--sup-card-bg)' : 'transparent',
            color: tab === 'report' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            cursor: 'pointer',
          }}
          onClick={() => setTab('report')}
        >
          Team Center Visits ({teamVisits.length})
        </button>
        <button
          type="button"
          style={{
            flex: 1,
            padding: '8px 0',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.8rem',
            background: tab === 'submit' ? 'var(--sup-card-bg)' : 'transparent',
            color: tab === 'submit' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            cursor: 'pointer',
          }}
          onClick={() => {
            setTab('submit');
            if (!location.lat) handleAutoCaptureLocation();
          }}
        >
          Submit Report
        </button>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--sup-danger-light)', color: 'var(--sup-danger)', borderRadius: 10, fontSize: '0.85rem', marginBottom: 14 }}>
          <Icon name="alertcircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--sup-success-light)', color: 'var(--sup-success)', borderRadius: 10, fontSize: '0.85rem', marginBottom: 14 }}>
          <Icon name="checkcircle" size={16} />
          <span>{success}</span>
        </div>
      )}

      {/* TAB 1: Point 9 Branch Visits (System Linked) */}
      {tab === 'branch_visits' && (
        <div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
              Loading scheduled branch visits…
            </div>
          ) : branchVisits.length === 0 ? (
            <div className="sup-card" style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--sup-text-muted)' }}>
              <div style={{ fontSize: '2rem', marginBottom: 6 }}>🏢</div>
              <strong style={{ display: 'block', fontSize: '1rem', color: 'var(--sup-text)' }}>No Branch Visits Scheduled</strong>
              <p style={{ margin: '6px 0 14px 0', fontSize: '0.8rem' }}>
                Schedule a new branch inspection or audit visit to sync with the main system.
              </p>
              <button
                type="button"
                className="sup-btn"
                style={{ width: 'auto', margin: '0 auto' }}
                onClick={() => setShowBranchVisitModal(true)}
              >
                + Schedule Branch Visit
              </button>
            </div>
          ) : (
            branchVisits.map((v) => {
              const isComp = v.status === 'completed';
              const isCanc = v.status === 'cancelled';
              return (
                <div key={v._id} className="sup-card" style={{ padding: 14, marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <strong style={{ fontSize: '0.98rem' }}>
                        {v.branchName || v.branch?.name || 'Branch'}
                      </strong>
                      <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)', marginTop: 2 }}>
                        Code: <strong>{v.branchCode || v.branch?.code}</strong> • {v.branchCity || v.branch?.city || 'City'}
                        {v.branchPincode || v.branch?.pincode ? ` (Pincode: ${v.branchPincode || v.branch?.pincode})` : ''}
                      </div>
                    </div>

                    <span
                      style={{
                        background: isComp ? 'var(--sup-success-light)' : isCanc ? 'var(--sup-danger-light)' : '#fef3c7',
                        color: isComp ? 'var(--sup-success)' : isCanc ? 'var(--sup-danger)' : '#b45309',
                        padding: '3px 8px',
                        borderRadius: 8,
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                      }}
                    >
                      {v.status || 'Scheduled'}
                    </span>
                  </div>

                  <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--sup-bg)', borderRadius: 8, fontSize: '0.8rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--sup-text-muted)' }}>Visit Date:</span>
                      <strong>{v.visitDate ? new Date(v.visitDate).toISOString().slice(0, 10) : 'Today'}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                      <span style={{ color: 'var(--sup-text-muted)' }}>Room Rent:</span>
                      <span>{v.roomRentCharged ? 'Charged' : 'Exempt'}</span>
                    </div>
                    {v.notes && (
                      <div style={{ marginTop: 4, color: 'var(--sup-text)' }}>
                        <span style={{ color: 'var(--sup-text-muted)' }}>Notes: </span>
                        {v.notes}
                      </div>
                    )}
                  </div>

                  {!isComp && !isCanc && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className="sup-btn sm secondary"
                        style={{ width: 'auto', padding: '3px 8px', fontSize: '0.72rem', color: 'var(--sup-danger)' }}
                        onClick={() => handleUpdateBranchVisitStatus(v._id, 'cancelled')}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="sup-btn sm"
                        style={{ width: 'auto', padding: '3px 10px', fontSize: '0.74rem', background: 'var(--sup-success)', borderColor: 'var(--sup-success)' }}
                        onClick={() => handleUpdateBranchVisitStatus(v._id, 'completed')}
                      >
                        ✓ Mark Completed
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 2: Team Center Visits */}
      {tab === 'report' && (
        <div>
          {/* Top Filter Dropdowns for Center, Staff & Status */}
          <div className="sup-card" style={{ marginBottom: 14, padding: 12 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--sup-text-muted)', marginBottom: 8, textTransform: 'uppercase' }}>
              Filter Team Visits
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <div>
                <label style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>Center</label>
                <select
                  className="sup-select"
                  value={centerFilter}
                  onChange={(e) => setCenterFilter(e.target.value)}
                  style={{ width: '100%', fontSize: '0.8rem', padding: '4px 6px' }}
                >
                  {centerOptions.map((c) => (
                    <option key={c} value={c}>{c === 'all' ? 'All Centers' : c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>Staff</label>
                <select
                  className="sup-select"
                  value={staffFilter}
                  onChange={(e) => setStaffFilter(e.target.value)}
                  style={{ width: '100%', fontSize: '0.8rem', padding: '4px 6px' }}
                >
                  {staffOptions.map((s) => (
                    <option key={s} value={s}>{s === 'all' ? 'All Staff' : s}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>Status</label>
                <select
                  className="sup-select"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={{ width: '100%', fontSize: '0.8rem', padding: '4px 6px' }}
                >
                  <option value="all">All Status</option>
                  <option value="done">Done</option>
                  <option value="not_done">NOT Done</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
              Loading visits…
            </div>
          ) : filteredVisits.length === 0 ? (
            <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
              No center visits match your filter criteria
            </div>
          ) : (
            filteredVisits.map((v) => {
              const curStatus = v.status || 'done';
              return (
                <div key={v._id} className="sup-card" style={{ padding: 14, marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <strong style={{ fontSize: '0.98rem' }}>{v.centerName}</strong>
                      <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)', marginTop: 2 }}>
                        Group: {v.groupName || 'General'} • Officer: <strong>{v.employeeName || v.employeeCode || 'Field Staff'}</strong>
                      </div>
                    </div>

                    <span
                      style={{
                        background:
                          curStatus === 'done'
                            ? 'var(--sup-success-light)'
                            : curStatus === 'not_done'
                            ? 'var(--sup-warning-light)'
                            : 'var(--sup-danger-light)',
                        color:
                          curStatus === 'done'
                            ? 'var(--sup-success)'
                            : curStatus === 'not_done'
                            ? 'var(--sup-warning)'
                            : 'var(--sup-danger)',
                        padding: '2px 8px',
                        borderRadius: 10,
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                      }}
                    >
                      {curStatus.replace('_', ' ')}
                    </span>
                  </div>

                  {v.notes && (
                    <div style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--sup-text)', background: 'var(--sup-bg)', padding: '6px 8px', borderRadius: 6 }}>
                      {v.notes}
                    </div>
                  )}

                  <div style={{ marginTop: 10, display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="sup-btn sm"
                      style={{ width: 'auto', padding: '3px 8px', fontSize: '0.72rem', background: 'var(--sup-success)', borderColor: 'var(--sup-success)' }}
                      onClick={() => {
                        setActiveVisitAction({ visit: v, targetStatus: 'done' });
                        setActionRemark('');
                      }}
                    >
                      ✓ Done
                    </button>
                    <button
                      type="button"
                      className="sup-btn sm secondary"
                      style={{ width: 'auto', padding: '3px 8px', fontSize: '0.72rem', color: '#d97706', borderColor: '#d97706' }}
                      onClick={() => {
                        setActiveVisitAction({ visit: v, targetStatus: 'not_done' });
                        setActionRemark('');
                      }}
                    >
                      ✕ NOT Done
                    </button>
                    <button
                      type="button"
                      className="sup-btn sm secondary"
                      style={{ width: 'auto', padding: '3px 8px', fontSize: '0.72rem', color: 'var(--sup-danger)', borderColor: 'var(--sup-danger)' }}
                      onClick={() => {
                        setActiveVisitAction({ visit: v, targetStatus: 'cancelled' });
                        setActionRemark('');
                      }}
                    >
                      ⊘ Cancel
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 3: Submit Visit Report */}
      {tab === 'submit' && (
        <form onSubmit={handleSubmitVisitReport} className="sup-card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', fontWeight: 800 }}>Record Field Visit</h3>

          <div className="sup-input-group">
            <label className="sup-label">Center Name *</label>
            <input
              type="text"
              required
              className="sup-input"
              placeholder="e.g. Rampur Center 01"
              value={centerName}
              onChange={(e) => setCenterName(e.target.value)}
            />
          </div>

          <div className="sup-input-group">
            <label className="sup-label">Group Name / Code</label>
            <input
              type="text"
              className="sup-input"
              placeholder="e.g. Ekta Mahila Group"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <div className="sup-input-group" style={{ flex: 1 }}>
              <label className="sup-label">Leader / Contact Person</label>
              <input
                type="text"
                className="sup-input"
                placeholder="Name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
              />
            </div>
            <div className="sup-input-group" style={{ flex: 1 }}>
              <label className="sup-label">Contact Mobile</label>
              <input
                type="tel"
                className="sup-input"
                placeholder="10-digit mobile"
                value={contactNumber}
                onChange={(e) => setContactNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
              />
            </div>
          </div>

          <div className="sup-input-group">
            <label className="sup-label">Inspection Findings &amp; Notes</label>
            <textarea
              rows={3}
              className="sup-textarea"
              placeholder="Record attendance, discipline, recovery issues, repayment status…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="sup-input-group">
            <label className="sup-label">Center Photo</label>
            <input type="file" accept="image/*" onChange={handleImageUpload} />
          </div>

          <button type="submit" className="sup-btn" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit Center Visit Report'}
          </button>
        </form>
      )}

      {/* Point 9: Modal to Record New Branch Visit (System Persisted) */}
      {showBranchVisitModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--sup-card-bg)', width: '100%', maxWidth: 400, borderRadius: 16, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ fontSize: '1.05rem', color: 'var(--sup-primary)' }}>
                Schedule New Branch Visit (System)
              </strong>
              <button className="sup-icon-btn" onClick={() => setShowBranchVisitModal(false)}>
                <Icon name="cross" size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateBranchVisit}>
              <div className="sup-input-group">
                <label className="sup-label">Select Branch to Visit *</label>
                <select
                  className="sup-select"
                  required
                  value={bvBranchId}
                  onChange={(e) => setBvBranchId(e.target.value)}
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code || b.id})
                    </option>
                  ))}
                </select>
              </div>

              <div className="sup-input-group">
                <label className="sup-label">Visit Date *</label>
                <input
                  type="date"
                  required
                  className="sup-input"
                  value={bvDate}
                  onChange={(e) => setBvDate(e.target.value)}
                />
              </div>

              <div className="sup-input-group">
                <label className="sup-label">Room Rent</label>
                <select
                  className="sup-select"
                  value={bvRoomRent ? 'yes' : 'no'}
                  onChange={(e) => setBvRoomRent(e.target.value === 'yes')}
                >
                  <option value="yes">Charged</option>
                  <option value="no">Exempt (consecutive day stay)</option>
                </select>
              </div>

              <div className="sup-input-group">
                <label className="sup-label">Visit Agenda / Notes</label>
                <textarea
                  rows={2}
                  className="sup-textarea"
                  placeholder="e.g. Branch audit, loan disbursement verification, staff review"
                  value={bvNotes}
                  onChange={(e) => setBvNotes(e.target.value)}
                />
              </div>

              <button type="submit" className="sup-btn" disabled={bvSubmitting}>
                {bvSubmitting ? 'Recording…' : 'Confirm & Save Branch Visit'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Point 6: Center Visit Action Modal */}
      {activeVisitAction && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--sup-card-bg)', width: '100%', maxWidth: 380, borderRadius: 16, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ fontSize: '1rem' }}>Update Center Visit Status</strong>
              <button className="sup-icon-btn" onClick={() => setActiveVisitAction(null)}>
                <Icon name="cross" size={16} />
              </button>
            </div>

            <div style={{ fontSize: '0.85rem', marginBottom: 12 }}>
              <div>Center: <strong>{activeVisitAction.visit.centerName}</strong></div>
              <div style={{ marginTop: 6, fontSize: '0.85rem' }}>
                New Status:{' '}
                <strong style={{ color: activeVisitAction.targetStatus === 'done' ? 'var(--sup-success)' : activeVisitAction.targetStatus === 'not_done' ? 'var(--sup-warning)' : 'var(--sup-danger)' }}>
                  {activeVisitAction.targetStatus === 'done' ? '✓ DONE' : activeVisitAction.targetStatus === 'not_done' ? '✕ NOT DONE' : '⊘ CANCELLED'}
                </strong>
              </div>
            </div>

            <form onSubmit={handleConfirmStatusAction}>
              <div className="sup-input-group">
                <label className="sup-label">Reason / Observation Remark</label>
                <textarea
                  rows={2}
                  className="sup-textarea"
                  placeholder="e.g. Meeting held / Members unavailable"
                  value={actionRemark}
                  onChange={(e) => setActionRemark(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="button" className="sup-btn secondary" style={{ flex: 1 }} onClick={() => setActiveVisitAction(null)}>
                  Cancel
                </button>
                <button type="submit" className="sup-btn" style={{ flex: 2 }} disabled={actionBusy}>
                  {actionBusy ? 'Updating…' : 'Confirm Status'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
