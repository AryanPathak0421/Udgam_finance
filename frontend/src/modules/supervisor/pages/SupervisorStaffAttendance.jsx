import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorStaffAttendance() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('all');

  useEffect(() => {
    loadAttendance();
  }, []);

  async function loadAttendance() {
    setLoading(true);
    setError('');
    try {
      const res = await api.supervisorApp.staffAttendance();
      setData(res);
    } catch (err) {
      setError(err.message || 'Failed to load branch staff attendance');
    } finally {
      setLoading(false);
    }
  }

  const branches = data?.branchWiseAttendance || [];
  const summary = data?.summary || { totalStaff: 0, totalPresent: 0 };

  const displayedBranches = selectedBranch === 'all'
    ? branches
    : branches.filter((b) => String(b.branchId) === String(selectedBranch) || String(b.branchCode) === String(selectedBranch));

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Branch Present & Staff Attendance</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>Live Field Officer & Staff Attendance by Branch</div>
      </div>

      {/* Summary KPI Card */}
      <div className="sup-card" style={{ borderLeft: '4px solid var(--sup-primary)', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '0.78rem', color: 'var(--sup-text-muted)', fontWeight: 600 }}>
              STAFF PRESENT TODAY
            </div>
            <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--sup-primary)', marginTop: 2 }}>
              {summary.totalPresent} / {summary.totalStaff}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span
              style={{
                background: summary.totalPresent === summary.totalStaff && summary.totalStaff > 0 ? 'var(--sup-success-light)' : 'var(--sup-warning-light)',
                color: summary.totalPresent === summary.totalStaff && summary.totalStaff > 0 ? 'var(--sup-success)' : 'var(--sup-warning)',
                padding: '4px 10px',
                borderRadius: 12,
                fontWeight: 700,
                fontSize: '0.8rem',
              }}
            >
              {summary.totalStaff > 0 ? Math.round((summary.totalPresent / summary.totalStaff) * 100) : 0}% Attendance
            </span>
          </div>
        </div>
      </div>

      {/* Point 8: Branch Filter Dropdown */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--sup-text-muted)', display: 'block', marginBottom: 4 }}>
          FILTER TEAM BY BRANCH
        </label>
        <select
          className="sup-select"
          value={selectedBranch}
          onChange={(e) => setSelectedBranch(e.target.value)}
          style={{ width: '100%', fontSize: '0.86rem', fontWeight: 600 }}
        >
          <option value="all">All Supervised Branches ({branches.length})</option>
          {branches.map((b) => (
            <option key={b.branchId} value={b.branchId}>
              {b.branchName} ({b.branchCode}) — {b.presentStaff}/{b.totalStaff} Present
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--sup-danger-light)', color: 'var(--sup-danger)', borderRadius: 10, fontSize: '0.85rem', marginBottom: 14 }}>
          <Icon name="alertcircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
          Loading branch attendance…
        </div>
      ) : displayedBranches.length === 0 ? (
        <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
          No branch staff records found
        </div>
      ) : (
        displayedBranches.map((b) => (
          <div key={b.branchId} className="sup-card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--sup-border)' }}>
              <div>
                <strong style={{ fontSize: '1rem' }}>{b.branchName}</strong>
                <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>Branch Code: {b.branchCode}</div>
              </div>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: b.presentStaff > 0 ? 'var(--sup-success)' : 'var(--sup-danger)' }}>
                {b.presentStaff} / {b.totalStaff} Present
              </span>
            </div>

            {(b.staffList || []).map((staff, idx) => (
              <div
                key={staff.id || idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: idx === b.staffList.length - 1 ? 'none' : '1px solid var(--sup-border)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      background: 'var(--sup-primary)',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '0.8rem',
                    }}
                  >
                    {staff.name?.slice(0, 1)}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{staff.name}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>
                      {staff.code} • {staff.designation}
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <span
                    style={{
                      background: staff.status === 'present' ? 'var(--sup-success-light)' : 'var(--sup-danger-light)',
                      color: staff.status === 'present' ? 'var(--sup-success)' : 'var(--sup-danger)',
                      padding: '2px 8px',
                      borderRadius: 10,
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                    }}
                  >
                    {staff.status}
                  </span>
                  {staff.checkInTime && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--sup-text-muted)', marginTop: 2 }}>
                      {staff.checkInTime}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
