import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';

export default function EmployeeTasks() {
  const { t } = useEmployeeApp();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const res = await api.employeeApp.tasks();
      setTasks(res.items || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const handleUpdate = async (id, status) => {
    try {
      await api.employeeApp.updateTask(id, { status, remark: `Updated to ${status} via Employee App` });
      fetchTasks();
    } catch (err) {
      alert(err.message || 'Failed to update task');
    }
  };

  return (
    <div className="emp-page-container">
      <div className="emp-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: 'var(--emp-text)' }}>
              📌 My Assigned Tasks
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', margin: '4px 0 0 0' }}>
              Field and collection tasks assigned by Branch Manager / Supervisor.
            </p>
          </div>
          <span className="emp-badge emp-badge-info" style={{ fontWeight: 800 }}>
            {tasks.length} Tasks
          </span>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px', color: 'var(--emp-text-muted)' }}>Loading tasks...</div>
      ) : tasks.length === 0 ? (
        <div className="emp-card" style={{ textAlign: 'center', padding: '36px', color: 'var(--emp-text-muted)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🎉</div>
          <div style={{ fontWeight: 700, fontSize: '1rem', color: '#059669' }}>No pending tasks!</div>
          <div style={{ fontSize: '0.8rem', marginTop: 4 }}>You have completed all your assigned tasks.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tasks.map((t) => {
            const isDone = t.status === 'done';
            const isHigh = t.priority === 'high';

            return (
              <div
                key={t._id}
                className="emp-card"
                style={{
                  margin: 0,
                  opacity: isDone ? 0.75 : 1,
                  border: isHigh && !isDone ? '1px solid #f87171' : '1px solid var(--emp-border)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--emp-text)', textDecoration: isDone ? 'line-through' : 'none' }}>
                        {t.title}
                      </span>
                      <span className={`emp-badge ${isHigh ? 'emp-badge-danger' : 'emp-badge-info'}`} style={{ fontSize: '0.68rem' }}>
                        {t.priority}
                      </span>
                    </div>

                    {t.description && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', marginTop: 4 }}>
                        {t.description}
                      </div>
                    )}

                    <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)', marginTop: 4 }}>
                      Due: {t.dueDate ? new Date(t.dueDate).toLocaleDateString() : 'No deadline'}
                    </div>
                  </div>

                  <span className={`emp-badge ${isDone ? 'emp-badge-success' : t.status === 'in_progress' ? 'emp-badge-warning' : 'emp-badge-info'}`}>
                    {t.status}
                  </span>
                </div>

                {!isDone && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--emp-border)' }}>
                    {t.status !== 'in_progress' && (
                      <button
                        type="button"
                        className="emp-btn-secondary"
                        style={{ flex: 1, padding: '6px', fontSize: '0.75rem' }}
                        onClick={() => handleUpdate(t._id, 'in_progress')}
                      >
                        Start Task
                      </button>
                    )}
                    <button
                      type="button"
                      className="emp-btn-primary"
                      style={{ flex: 1, padding: '6px', fontSize: '0.75rem', background: '#059669' }}
                      onClick={() => handleUpdate(t._id, 'done')}
                    >
                      ✓ Mark as Done
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

