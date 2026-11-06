import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorStaffRating() {
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Rating modal/drawer
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [stars, setStars] = useState(5);
  const [review, setReview] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadRatings();
  }, []);

  async function loadRatings() {
    setLoading(true);
    setError('');
    try {
      const res = await api.supervisorApp.staffRatings();
      setStaffList(res.staff || []);
    } catch (err) {
      setError(err.message || 'Failed to load staff ratings');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitRating(e) {
    e.preventDefault();
    if (!selectedStaff) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await api.supervisorApp.rateStaff({
        targetEmployeeCode: selectedStaff.code,
        stars,
        review: review.trim(),
      });
      setSuccess(res.message || 'Staff rating submitted successfully!');
      setSelectedStaff(null);
      setReview('');
      setStars(5);
      loadRatings();
    } catch (err) {
      setError(err.message || 'Failed to submit staff rating');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Staff Performance Rating</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>
          Supervised Staff Evaluation (Visible to Admin & Staff)
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#eff6ff', color: '#1e40af', borderRadius: 10, fontSize: '0.82rem', marginBottom: 14, borderLeft: '4px solid #3b82f6' }}>
        <Icon name="shield" size={16} />
        <span><strong>Visibility Note:</strong> Performance ratings & reviews given here are visible to Udgam Admin as well as the respective staff member.</span>
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

      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
          Loading staff performance ratings…
        </div>
      ) : staffList.length === 0 ? (
        <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
          No staff members found under your supervised branches
        </div>
      ) : (
        staffList.map((s) => (
          <div key={s.id || s.code} className="sup-card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <strong style={{ fontSize: '0.98rem' }}>{s.name}</strong>
                <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>
                  {s.code} • {s.designation} • {s.branchName}
                </div>
              </div>

              {/* Star badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#fef3c7', padding: '4px 8px', borderRadius: 12 }}>
                <span style={{ color: '#d97706', fontSize: '0.85rem' }}>★</span>
                <strong style={{ fontSize: '0.85rem', color: '#92400e' }}>
                  {Number(s.averageRating || 5).toFixed(1)}
                </strong>
                <span style={{ fontSize: '0.7rem', color: '#b45309' }}>
                  ({(s.ratings || []).length})
                </span>
              </div>
            </div>

            {/* Recent Review preview */}
            {s.ratings && s.ratings.length > 0 && (
              <div style={{ marginTop: 10, fontSize: '0.8rem', padding: '8px 10px', background: 'var(--sup-bg)', borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ color: 'var(--sup-text-muted)', fontSize: '0.72rem' }}>
                    Latest by {s.ratings[0].supervisorName || 'Supervisor'}
                  </span>
                  <span style={{ color: '#d97706', fontWeight: 700 }}>
                    {'★'.repeat(s.ratings[0].stars)}
                    {'☆'.repeat(5 - s.ratings[0].stars)}
                  </span>
                </div>
                {s.ratings[0].review && (
                  <div style={{ fontStyle: 'italic', color: 'var(--sup-text)' }}>
                    "{s.ratings[0].review}"
                  </div>
                )}
              </div>
            )}

            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="sup-btn sm"
                style={{ width: 'auto' }}
                onClick={() => {
                  setSelectedStaff(s);
                  setStars(5);
                  setReview('');
                }}
              >
                <Icon name="check" size={14} />
                <span>Rate Staff Member</span>
              </button>
            </div>
          </div>
        ))
      )}

      {/* Rate Staff Modal */}
      {selectedStaff && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--sup-card-bg)', width: '100%', maxWidth: 380, borderRadius: 16, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ fontSize: '1.05rem', color: 'var(--sup-primary)' }}>Rate Staff Performance</strong>
              <button className="sup-icon-btn" onClick={() => setSelectedStaff(null)}>
                <Icon name="cross" size={16} />
              </button>
            </div>

            <div style={{ fontSize: '0.85rem', marginBottom: 12 }}>
              Staff: <strong>{selectedStaff.name}</strong> ({selectedStaff.code})
            </div>

            <form onSubmit={handleSubmitRating}>
              <div className="sup-input-group">
                <label className="sup-label">Rating (Stars)</label>
                <div style={{ display: 'flex', gap: 10, fontSize: '1.8rem', cursor: 'pointer', margin: '4px 0' }}>
                  {[1, 2, 3, 4, 5].map((num) => (
                    <span
                      key={num}
                      style={{ color: num <= stars ? '#f59e0b' : '#d1d5db', userSelect: 'none' }}
                      onClick={() => setStars(num)}
                    >
                      ★
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--sup-text-muted)' }}>
                  {stars === 5 ? 'Excellent' : stars === 4 ? 'Good' : stars === 3 ? 'Average' : stars === 2 ? 'Below Average' : 'Needs Improvement'}
                </div>
              </div>

              <div className="sup-input-group">
                <label className="sup-label">Supervisor Review / Feedback *</label>
                <textarea
                  rows={3}
                  required
                  className="sup-textarea"
                  placeholder="Appraisal remarks on discipline, EMI collection efficiency, member satisfaction, or areas of improvement…"
                  value={review}
                  onChange={(e) => setReview(e.target.value)}
                />
              </div>

              <button type="submit" className="sup-btn" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit Rating'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

