import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

const TASK_CATEGORIES = [
  'Disbursement',
  'Collections',
  'New Member',
  'Product',
  'NPA Report',
  'General',
];

export default function SupervisorTasks() {
  const [filter, setFilter] = useState('pending'); // 'pending' | 'completed' | 'all'
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [data, setData] = useState({ summary: {}, tasks: [], pendingTasks: [], completedTasks: [], staff: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Assign task modal
  const [showModal, setShowModal] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Collections');
  const [assignedToId, setAssignedToId] = useState('');
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().slice(0, 10);
  });
  const [priority, setPriority] = useState('medium');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadTasks();
  }, [categoryFilter]);

  async function loadTasks() {
    setLoading(true);
    setError('');
    try {
      const res = await api.supervisorApp.tasks({ category: categoryFilter !== 'all' ? categoryFilter : undefined });
      setData(res || { summary: {}, tasks: [], pendingTasks: [], completedTasks: [], staff: [] });
      if (res.staff && res.staff.length > 0 && !assignedToId) {
        setAssignedToId(res.staff[0].id);
      }
    } catch (err) {
      setError(err.message || 'Failed to load supervisor tasks');
    } finally {
      setLoading(false);
    }
  }

  async function handleAssignTask(e) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Task title is required');
      return;
    }
    if (!assignedToId) {
      setError('Please select staff member');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await api.supervisorApp.createTask({
        title: title.trim(),
        description: description.trim(),
        category,
        assignedToId,
        dueDate,
        priority,
      });
      setSuccess(res.message || 'Task assigned successfully!');
      setShowModal(false);
      setTitle('');
      setDescription('');
      loadTasks();
    } catch (err) {
      setError(err.message || 'Failed to assign task');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateStatus(taskId, newStatus) {
    setError('');
    try {
      await api.supervisorApp.updateTaskStatus(taskId, { status: newStatus });
      setSuccess(`Task marked as ${newStatus}!`);
      loadTasks();
    } catch (err) {
      setError(err.message || 'Failed to update task status');
    }
  }

  const { summary = {}, tasks = [], pendingTasks = [], completedTasks = [], staff = [] } = data;
  let baseTasks = filter === 'pending' ? pendingTasks : filter === 'completed' ? completedTasks : tasks;
  if (categoryFilter !== 'all') {
    baseTasks = baseTasks.filter((t) => (t.category || 'General') === categoryFilter);
  }

  const getCategoryColor = (cat) => {
    switch (cat) {
      case 'Disbursement': return { bg: '#eff6ff', color: '#1d4ed8' };
      case 'Collections': return { bg: '#ecfdf5', color: '#047857' };
      case 'New Member': return { bg: '#faf5ff', color: '#7e22ce' };
      case 'Product': return { bg: '#fff7ed', color: '#c2410c' };
      case 'NPA Report': return { bg: '#fef2f2', color: '#b91c1c' };
      default: return { bg: '#f1f5f9', color: '#475569' };
    }
  };

  return (
    <div className="sup-page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Team Tasks & Follow-up</h2>
          <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>
            Pending Field Actions & Staff Task Tracking
          </div>
        </div>
        <button
          type="button"
          className="sup-btn sm"
          style={{ width: 'auto' }}
          onClick={() => setShowModal(true)}
        >
          <Icon name="plus" size={14} />
          <span>Assign Task</span>
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

      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <div className="sup-metric-card" style={{ flex: 1, borderLeft: '4px solid var(--sup-danger)' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--sup-text-muted)' }}>Pending Tasks</span>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--sup-danger)', marginTop: 4 }}>
            {summary.pendingCount || 0}
          </div>
        </div>
        <div className="sup-metric-card" style={{ flex: 1, borderLeft: '4px solid var(--sup-success)' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--sup-text-muted)' }}>Completed</span>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--sup-success)', marginTop: 4 }}>
            {summary.completedCount || 0}
          </div>
        </div>
        <div className="sup-metric-card" style={{ flex: 1, borderLeft: '4px solid var(--sup-primary)' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--sup-text-muted)' }}>Total Assigned</span>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--sup-primary)', marginTop: 4 }}>
            {summary.totalTasks || 0}
          </div>
        </div>
      </div>

      {/* Point 7: Module / Category Dropdown Filter */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--sup-text-muted)', display: 'block', marginBottom: 4 }}>
          FILTER BY MODULE / REPORT
        </label>
        <select
          className="sup-select"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{ width: '100%', fontSize: '0.85rem', fontWeight: 600 }}
        >
          <option value="all">All Modules & Reports</option>
          {TASK_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat} Tasks
            </option>
          ))}
        </select>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', background: 'var(--sup-border)', borderRadius: 10, padding: 3, marginBottom: 14 }}>
        <button
          type="button"
          style={{
            flex: 1,
            padding: '8px 0',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.82rem',
            background: filter === 'pending' ? 'var(--sup-card-bg)' : 'transparent',
            color: filter === 'pending' ? 'var(--sup-danger)' : 'var(--sup-text-muted)',
            cursor: 'pointer',
          }}
          onClick={() => setFilter('pending')}
        >
          Pending ({summary.pendingCount || 0})
        </button>
        <button
          type="button"
          style={{
            flex: 1,
            padding: '8px 0',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.82rem',
            background: filter === 'completed' ? 'var(--sup-card-bg)' : 'transparent',
            color: filter === 'completed' ? 'var(--sup-success)' : 'var(--sup-text-muted)',
            cursor: 'pointer',
          }}
          onClick={() => setFilter('completed')}
        >
          Completed ({summary.completedCount || 0})
        </button>
        <button
          type="button"
          style={{
            flex: 1,
            padding: '8px 0',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.82rem',
            background: filter === 'all' ? 'var(--sup-card-bg)' : 'transparent',
            color: filter === 'all' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            cursor: 'pointer',
          }}
          onClick={() => setFilter('all')}
        >
          All Tasks
        </button>
      </div>

      {/* Tasks List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
          Loading team tasks…
        </div>
      ) : baseTasks.length === 0 ? (
        <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
          No {filter} {categoryFilter !== 'all' ? `(${categoryFilter})` : ''} tasks found
        </div>
      ) : (
        baseTasks.map((t) => {
          const isDone = t.status === 'completed' || t.status === 'done';
          const catStyle = getCategoryColor(t.category);
          return (
            <div key={t._id} className="sup-card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span
                      style={{
                        background: catStyle.bg,
                        color: catStyle.color,
                        padding: '2px 8px',
                        borderRadius: 8,
                        fontSize: '0.72rem',
                        fontWeight: 700,
                      }}
                    >
                      {t.category || 'General'}
                    </span>
                    <span
                      style={{
                        background: isDone ? 'var(--sup-success-light)' : '#fef3c7',
                        color: isDone ? 'var(--sup-success)' : '#b45309',
                        padding: '2px 8px',
                        borderRadius: 8,
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                      }}
                    >
                      {isDone ? 'Completed' : t.status === 'in_progress' ? 'In Progress' : 'Pending'}
                    </span>
                  </div>
                  <strong style={{ fontSize: '0.96rem' }}>{t.title}</strong>
                  <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)', marginTop: 2 }}>
                    Assigned to: <strong>{t.assignedToName || t.assignedToCode}</strong>
                  </div>
                </div>
              </div>

              {t.description && (
                <div style={{ marginTop: 8, fontSize: '0.82rem', color: 'var(--sup-text)' }}>
                  {t.description}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--sup-border)', fontSize: '0.75rem' }}>
                <span style={{ color: 'var(--sup-text-muted)' }}>
                  Due Date: <strong>{t.dueDate ? new Date(t.dueDate).toLocaleDateString() : 'Immediate'}</strong>
                </span>

                {!isDone && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {t.status === 'open' && (
                      <button
                        type="button"
                        className="sup-btn sm secondary"
                        style={{ width: 'auto', padding: '2px 8px', fontSize: '0.72rem' }}
                        onClick={() => handleUpdateStatus(t._id, 'in_progress')}
                      >
                        In Progress
                      </button>
                    )}
                    <button
                      type="button"
                      className="sup-btn sm"
                      style={{ width: 'auto', padding: '3px 10px', fontSize: '0.74rem', background: 'var(--sup-success)', borderColor: 'var(--sup-success)' }}
                      onClick={() => handleUpdateStatus(t._id, 'completed')}
                    >
                      ✓ Complete
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}

      {/* Assign Task Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--sup-card-bg)', width: '100%', maxWidth: 420, borderRadius: 16, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <strong style={{ fontSize: '1.05rem', color: 'var(--sup-primary)' }}>Assign Task to Staff</strong>
              <button className="sup-icon-btn" onClick={() => setShowModal(false)}>
                <Icon name="cross" size={16} />
              </button>
            </div>

            <form onSubmit={handleAssignTask}>
              {/* Point 7: Module / Category Selection Dropdown */}
              <div className="sup-input-group">
                <label className="sup-label">Task Module / Category *</label>
                <select
                  className="sup-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  required
                >
                  {TASK_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat} Task
                    </option>
                  ))}
                </select>
              </div>

              <div className="sup-input-group">
                <label className="sup-label">Assign To Staff Member *</label>
                <select
                  className="sup-select"
                  value={assignedToId}
                  onChange={(e) => setAssignedToId(e.target.value)}
                  required
                >
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.code} • {s.designation})
                    </option>
                  ))}
                </select>
              </div>

              <div className="sup-input-group">
                <label className="sup-label">Task Title *</label>
                <input
                  type="text"
                  required
                  className="sup-input"
                  placeholder="e.g. Complete NPA collection & verification"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="sup-input-group">
                <label className="sup-label">Description / Instructions</label>
                <textarea
                  rows={3}
                  className="sup-textarea"
                  placeholder="Detailed instructions for the field staff…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <div className="sup-input-group" style={{ flex: 1 }}>
                  <label className="sup-label">Due Date</label>
                  <input
                    type="date"
                    required
                    className="sup-input"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>

                <div className="sup-input-group" style={{ flex: 1 }}>
                  <label className="sup-label">Priority</label>
                  <select
                    className="sup-select"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>

              <button type="submit" className="sup-btn" disabled={submitting}>
                {submitting ? 'Assigning…' : 'Confirm & Assign Task'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
