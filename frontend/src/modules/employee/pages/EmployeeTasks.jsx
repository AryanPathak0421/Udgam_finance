import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

export default function EmployeeTasks() {
  const { t } = useEmployeeApp();
  const [tasks, setTasks] = useState([]);
  const [activeTab, setActiveTab] = useState('pending'); // 'pending' | 'completed'
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
    const taskId = id;
    if (!taskId) return;

    // Optimistic UI update: immediately update task status in state so count decreases
    setTasks((prev) =>
      prev.map((item) => ((item._id === taskId || item.id === taskId) ? { ...item, status } : item))
    );

    try {
      await api.employeeApp.updateTask(taskId, { status, remark: `Updated to ${status} via Employee App` });
      fetchTasks();
    } catch (err) {
      alert(err.message || 'Failed to update task');
      fetchTasks();
    }
  };

  const pendingTasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  const completedTasks = tasks.filter((t) => t.status === 'done');
  const displayedTasks = activeTab === 'pending' ? pendingTasks : completedTasks;

  return (
    <div className="emp-page-container">
      <div className="emp-card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="ticket" size={20} style={{ color: 'var(--emp-primary)' }} />
              <span>My Assigned Tasks</span>
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', margin: '4px 0 0 0' }}>
              Field and collection tasks assigned by Branch Manager / Supervisor.
            </p>
          </div>
          <span className="emp-badge emp-badge-info" style={{ fontWeight: 800 }}>
            {pendingTasks.length} Pending
          </span>
        </div>

        {/* Tab switch */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className={activeTab === 'pending' ? 'emp-btn-primary' : 'emp-btn-secondary'}
            style={{ flex: 1, padding: '8px', fontSize: '0.82rem', fontWeight: 700 }}
            onClick={() => setActiveTab('pending')}
          >
            Pending Tasks ({pendingTasks.length})
          </button>
          <button
            type="button"
            className={activeTab === 'completed' ? 'emp-btn-primary' : 'emp-btn-secondary'}
            style={{ flex: 1, padding: '8px', fontSize: '0.82rem', fontWeight: 700 }}
            onClick={() => setActiveTab('completed')}
          >
            Completed ({completedTasks.length})
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px', color: 'var(--emp-text-muted)' }}>Loading tasks...</div>
      ) : displayedTasks.length === 0 ? (
        <div className="emp-card" style={{ textAlign: 'center', padding: '36px', color: 'var(--emp-text-muted)' }}>
          <div style={{ color: 'var(--emp-success)', marginBottom: 8 }}><Icon name="checkcircle" size={40} /></div>
          <div style={{ fontWeight: 700, fontSize: '1rem', color: '#059669' }}>
            {activeTab === 'pending' ? 'No pending tasks!' : 'No completed tasks yet.'}
          </div>
          <div style={{ fontSize: '0.8rem', marginTop: 4 }}>
            {activeTab === 'pending' ? 'All assigned tasks have been completed.' : 'Tasks you mark as done will appear here.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {displayedTasks.map((t) => {
            const taskId = t._id || t.id;
            const isDone = t.status === 'done';
            const isHigh = t.priority === 'high';

            return (
              <div
                key={taskId}
                className="emp-card"
                style={{
                  margin: 0,
                  opacity: isDone ? 0.8 : 1,
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
                        onClick={() => handleUpdate(taskId, 'in_progress')}
                      >
                        Start Task
                      </button>
                    )}
                    <button
                      type="button"
                      className="emp-btn-primary"
                      style={{ flex: 1, padding: '6px', fontSize: '0.75rem', background: '#059669' }}
                      onClick={() => handleUpdate(taskId, 'done')}
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

