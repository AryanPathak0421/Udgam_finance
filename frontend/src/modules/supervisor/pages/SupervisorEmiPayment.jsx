import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorEmiPayment() {
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [collections, setCollections] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadGroups();
  }, []);

  async function loadGroups() {
    setLoading(true);
    setError('');
    try {
      const res = await api.supervisorApp.emiGroups();
      setGroups(res.groups || []);
    } catch (err) {
      setError(err.message || 'Failed to load borrower groups');
    } finally {
      setLoading(false);
    }
  }

  async function selectGroup(grp) {
    setSelectedGroup(grp);
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.supervisorApp.groupEmiMembers(grp.code || grp._id);
      const list = res.members || [];
      setMembers(list);
      const initial = {};
      list.forEach((m) => {
        initial[m.loanId || m._id] = m.emiAmount || 0;
      });
      setCollections(initial);
    } catch (err) {
      setError(err.message || 'Failed to load group members');
    } finally {
      setLoading(false);
    }
  }

  async function handleBulkSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const payments = Object.entries(collections)
        .filter(([, amt]) => Number(amt) > 0)
        .map(([loanId, amount]) => ({ loanId, amount: Number(amount) }));

      if (payments.length === 0) {
        setError('Please enter collection amount for at least one borrower');
        setBusy(false);
        return;
      }

      await api.supervisorApp.collectBulkEmi({
        groupId: selectedGroup._id,
        payments,
      });

      setSuccess(`Successfully settled ${payments.length} collections!`);
      setTimeout(() => {
        setSelectedGroup(null);
        setMembers([]);
        loadGroups();
      }, 1500);
    } catch (err) {
      setError(err.message || 'Collection settlement failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Group EMI Collection</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>Supervisor Center & Bulk EMI Settlement</div>
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

      {!selectedGroup ? (
        <div>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: 8, color: 'var(--sup-text-muted)' }}>
            SELECT JLG / SHG GROUP FOR COLLECTION
          </div>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
              Loading collection groups…
            </div>
          ) : groups.length === 0 ? (
            <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
              No active collection groups found for today
            </div>
          ) : (
            groups.map((grp) => (
              <div
                key={grp._id}
                className="sup-card"
                style={{ padding: 14, cursor: 'pointer', transition: 'border-color 0.15s ease' }}
                onClick={() => selectGroup(grp)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong style={{ fontSize: '0.95rem' }}>{grp.name}</strong>
                    <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>
                      Code: {grp.code} • Center: {grp.center || '—'}
                    </div>
                  </div>
                  <span className="sup-btn sm secondary" style={{ width: 'auto' }}>
                    Select Group →
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="sup-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <strong style={{ fontSize: '1rem' }}>{selectedGroup.name}</strong>
              <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>Center: {selectedGroup.center}</div>
            </div>
            <button
              type="button"
              className="sup-btn sm secondary"
              style={{ width: 'auto' }}
              onClick={() => setSelectedGroup(null)}
            >
              Change Group
            </button>
          </div>

          <form onSubmit={handleBulkSubmit}>
            {members.map((m) => {
              const key = m.loanId || m._id;
              return (
                <div
                  key={key}
                  style={{
                    padding: '10px 0',
                    borderBottom: '1px solid var(--sup-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>{m.name}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>Loan #{m.loanNo}</div>
                  </div>
                  <div style={{ width: 110 }}>
                    <input
                      type="number"
                      className="sup-input"
                      style={{ padding: '6px 8px', fontSize: '0.85rem', textAlign: 'right' }}
                      value={collections[key] ?? ''}
                      onChange={(e) => setCollections({ ...collections, [key]: e.target.value })}
                    />
                  </div>
                </div>
              );
            })}

            <button type="submit" className="sup-btn" disabled={busy} style={{ marginTop: 14 }}>
              {busy ? 'Settling Collections…' : 'Submit Group Collection'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
