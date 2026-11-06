import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorStaffList() {
  const [staff, setStaff] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Selected Employee Dossier Modal
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [dossier, setDossier] = useState(null);
  const [loadingDossier, setLoadingDossier] = useState(false);

  useEffect(() => {
    loadStaff();
  }, []);

  async function loadStaff() {
    setLoading(true);
    setError('');
    try {
      const res = await api.supervisorApp.supervisedStaff();
      setStaff(res.staff || []);
    } catch (err) {
      setError(err.message || 'Failed to load supervised employees');
    } finally {
      setLoading(false);
    }
  }

  async function openDossier(s) {
    setSelectedStaff(s);
    setLoadingDossier(true);
    setDossier(null);
    try {
      const res = await api.supervisorApp.employeeDossier(s.id);
      setDossier(res);
    } catch (err) {
      setError(err.message || 'Failed to load employee dossier');
    } finally {
      setLoadingDossier(false);
    }
  }

  const filteredStaff = staff.filter((s) => {
    const q = search.toLowerCase();
    return (
      (s.name || '').toLowerCase().includes(q) ||
      (s.code || '').toLowerCase().includes(q) ||
      (s.branch?.name || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Supervised Team Staff</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>
          Attached Staff & Complete Performance Dossier
        </div>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--sup-danger-light)', color: 'var(--sup-danger)', borderRadius: 10, fontSize: '0.85rem', marginBottom: 14 }}>
          <Icon name="alertcircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Search Input */}
      <div style={{ marginBottom: 14 }}>
        <input
          type="text"
          className="sup-input"
          placeholder="Search by staff name, code, or branch…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
          Loading team staff…
        </div>
      ) : filteredStaff.length === 0 ? (
        <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
          No attached staff members found
        </div>
      ) : (
        filteredStaff.map((s) => (
          <div
            key={s.id}
            className="sup-card"
            style={{ padding: 14, cursor: 'pointer', transition: 'all 0.15s ease' }}
            onClick={() => openDossier(s)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: 'var(--sup-primary)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                    fontSize: '1rem',
                  }}
                >
                  {s.photo ? (
                    <img src={s.photo} alt={s.name} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    (s.name || 'S').charAt(0).toUpperCase()
                  )}
                </div>
                <div>
                  <strong style={{ fontSize: '0.98rem' }}>{s.name}</strong>
                  <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>
                    {s.code} • {s.designation}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--sup-primary)' }}>
                    {s.branch?.name || 'Branch'} • 📞 {s.mobile || '—'}
                  </div>
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#fef3c7', padding: '2px 7px', borderRadius: 10, fontSize: '0.78rem' }}>
                  <span style={{ color: '#d97706' }}>★</span>
                  <strong style={{ color: '#92400e' }}>{Number(s.averageRating || 5).toFixed(1)}</strong>
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--sup-text-muted)', display: 'block', marginTop: 4 }}>
                  Tap to view →
                </span>
              </div>
            </div>
          </div>
        ))
      )}

      {/* Employee Dossier Modal */}
      {selectedStaff && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--sup-card-bg)', width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto', borderRadius: 16, padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <strong style={{ fontSize: '1.1rem' }}>Employee Dossier</strong>
                <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>Full Operational & HR Record</div>
              </div>
              <button className="sup-icon-btn" onClick={() => setSelectedStaff(null)}>
                <Icon name="cross" size={16} />
              </button>
            </div>

            {loadingDossier ? (
              <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
                Loading employee details…
              </div>
            ) : !dossier ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--sup-danger)' }}>
                Could not load employee dossier
              </div>
            ) : (
              <div>
                {/* Header Profile Info */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px', background: 'var(--sup-bg)', borderRadius: 10, marginBottom: 14 }}>
                  <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--sup-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1.2rem' }}>
                    {dossier.employee?.name?.charAt(0) || 'E'}
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>{dossier.employee?.name}</h3>
                    <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>
                      {dossier.employee?.code} • {dossier.employee?.designation}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--sup-primary)' }}>
                      {dossier.employee?.branch} • {dossier.employee?.mobile}
                    </div>
                  </div>
                </div>

                {/* Performance Stats */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  <div className="sup-metric-card" style={{ flex: 1, padding: 10 }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>Collected Today</span>
                    <strong style={{ fontSize: '1rem', color: 'var(--sup-success)', display: 'block' }}>
                      ₹{(dossier.performance?.todayCollectedAmount || 0).toLocaleString('en-IN')}
                    </strong>
                  </div>
                  <div className="sup-metric-card" style={{ flex: 1, padding: 10 }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>Receipts</span>
                    <strong style={{ fontSize: '1rem', display: 'block' }}>
                      {dossier.performance?.todayReceiptsCount || 0}
                    </strong>
                  </div>
                  <div className="sup-metric-card" style={{ flex: 1, padding: 10 }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>Pending Tasks</span>
                    <strong style={{ fontSize: '1rem', color: 'var(--sup-danger)', display: 'block' }}>
                      {dossier.performance?.pendingTasksCount || 0}
                    </strong>
                  </div>
                </div>

                {/* Section: Assigned Tasks */}
                <div style={{ marginBottom: 12 }}>
                  <strong style={{ fontSize: '0.88rem', display: 'block', marginBottom: 6 }}>Assigned Tasks</strong>
                  {(dossier.tasks || []).length === 0 ? (
                    <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>No tasks assigned</div>
                  ) : (
                    dossier.tasks.slice(0, 5).map((t) => (
                      <div key={t._id} style={{ padding: '6px 8px', background: 'var(--sup-bg)', borderRadius: 6, marginBottom: 4, display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                        <span>{t.title}</span>
                        <span style={{ fontWeight: 700, textTransform: 'capitalize', color: t.status === 'completed' ? 'var(--sup-success)' : 'var(--sup-warning)' }}>
                          {t.status}
                        </span>
                      </div>
                    ))
                  )}
                </div>

                {/* Section: Recent Attendance */}
                <div style={{ marginBottom: 12 }}>
                  <strong style={{ fontSize: '0.88rem', display: 'block', marginBottom: 6 }}>Attendance Record (Last 30 Days)</strong>
                  {(dossier.attendance || []).length === 0 ? (
                    <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>No attendance logs</div>
                  ) : (
                    <div style={{ maxHeight: 120, overflowY: 'auto' }}>
                      {dossier.attendance.slice(0, 7).map((a) => (
                        <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '4px 0', borderBottom: '1px solid var(--sup-border)' }}>
                          <span>{a.date}</span>
                          <span style={{ fontWeight: 700, color: a.status === 'present' ? 'var(--sup-success)' : 'var(--sup-danger)' }}>
                            {a.status?.toUpperCase()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Section: Center Visits */}
                <div>
                  <strong style={{ fontSize: '0.88rem', display: 'block', marginBottom: 6 }}>Center Visits & Inspection</strong>
                  {(dossier.visits || []).length === 0 ? (
                    <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>No center visits recorded</div>
                  ) : (
                    dossier.visits.slice(0, 3).map((v) => (
                      <div key={v._id} style={{ padding: '6px 8px', background: 'var(--sup-bg)', borderRadius: 6, marginBottom: 4, fontSize: '0.78rem' }}>
                        <strong>{v.centerName}</strong> ({v.contactName})
                        <div style={{ fontSize: '0.7rem', color: 'var(--sup-text-muted)' }}>
                          {v.visitDate ? new Date(v.visitDate).toLocaleDateString() : ''}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
