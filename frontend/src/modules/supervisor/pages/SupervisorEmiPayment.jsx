import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

const MODES = [
  { id: 'all', label: 'All Modes' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'daily', label: 'Daily' },
];

export default function SupervisorEmiPayment() {
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [collections, setCollections] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filters
  const [mode, setMode] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    loadGroups();
  }, [mode, date]);

  async function loadGroups() {
    setLoading(true);
    setError('');
    try {
      const res = await api.supervisorApp.emiGroups({
        mode: mode !== 'all' ? mode : undefined,
        date,
        showAll: true,
      });
      setGroups(res.groups || []);
    } catch (err) {
      setError(err.message || 'Failed to load borrower groups');
    } finally {
      setLoading(false);
    }
  }

  const getMemberKey = (m) => `${m.loanPaymentId || m.loanId || ''}_${m.memberCode || m.code || m.memberId || m._id}`;

  async function selectGroup(grp) {
    setSelectedGroup(grp);
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const gIdentifier = grp.code || grp.groupCode || grp._id;
      const res = await api.supervisorApp.groupEmiMembers(gIdentifier, { date });
      const list = res.members || [];
      setMembers(list);
      const initial = {};
      list.forEach((m) => {
        const key = getMemberKey(m);
        initial[key] = m.emiAmount || m.suggestedAmount || 0;
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
      const items = members
        .map((m) => {
          const key = getMemberKey(m);
          const amount = Number(collections[key]);
          if (!amount || amount < 1) return null;
          return {
            loanPaymentId: m.loanPaymentId,
            memberCode: m.memberCode || m.code,
            memberId: m.memberId || m._id,
            amount,
            payMode: 'cash',
          };
        })
        .filter(Boolean);

      if (items.length === 0) {
        setError('Please enter collection amount for at least one borrower');
        setBusy(false);
        return;
      }

      await api.supervisorApp.collectBulkEmi({
        items,
        groupId: selectedGroup._id || selectedGroup.id || selectedGroup.code || selectedGroup.groupCode,
        date,
      });

      const totalAmt = items.reduce((s, x) => s + x.amount, 0);
      setSuccess(`✓ Successfully recorded ₹${totalAmt.toLocaleString('en-IN')} across ${items.length} collection(s) (Receipts generated & pending Approval)`);
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

  const filteredGroups = groups.filter((g) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    const name = (g.name || g.groupName || '').toLowerCase();
    const code = (g.code || g.groupCode || '').toLowerCase();
    const center = (g.center || '').toLowerCase();
    return name.includes(q) || code.includes(q) || center.includes(q);
  });

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Group EMI Collection</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>
          Supervised Center & JLG/SHG Bulk EMI Settlement
        </div>
      </div>

      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            background: 'var(--sup-danger-light)',
            color: 'var(--sup-danger)',
            borderRadius: 10,
            fontSize: '0.85rem',
            marginBottom: 14,
          }}
        >
          <Icon name="alertcircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            background: 'var(--sup-success-light)',
            color: 'var(--sup-success)',
            borderRadius: 10,
            fontSize: '0.85rem',
            marginBottom: 14,
          }}
        >
          <Icon name="checkcircle" size={16} />
          <span>{success}</span>
        </div>
      )}

      {!selectedGroup ? (
        <div>
          {/* Controls: Mode & Date */}
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 6, marginBottom: 10 }}>
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`sup-btn sm ${mode === m.id ? 'primary' : 'secondary'}`}
                style={{ width: 'auto', whiteSpace: 'nowrap', padding: '6px 12px', fontSize: '0.78rem' }}
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <input
                type="text"
                className="sup-input"
                placeholder="Search group name, code or center…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ fontSize: '0.85rem' }}
              />
            </div>
            <div style={{ width: 130 }}>
              <input
                type="date"
                className="sup-input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{ fontSize: '0.85rem' }}
              />
            </div>
          </div>

          <div style={{ fontSize: '0.82rem', fontWeight: 700, marginBottom: 8, color: 'var(--sup-text-muted)' }}>
            ASSIGNED COLLECTION GROUPS ({filteredGroups.length})
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
              Loading collection groups…
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
              No collection groups found for selected filter / date
            </div>
          ) : (
            filteredGroups.map((grp) => {
              const gName = grp.name || grp.groupName || grp.code || 'Group';
              const gCode = grp.code || grp.groupCode || '';
              const gId = grp._id || grp.id || gCode;
              return (
                <div
                  key={gId}
                  className="sup-card"
                  style={{ padding: 14, cursor: 'pointer', transition: 'border-color 0.15s ease', marginBottom: 10 }}
                  onClick={() => selectGroup(grp)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <strong style={{ fontSize: '0.98rem' }}>{gName}</strong>
                      <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)', marginTop: 2 }}>
                        Code: {gCode} • Center: {grp.center || 'Main Center'}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: 'var(--sup-border)', borderRadius: 4, textTransform: 'capitalize' }}>
                          {grp.mode || 'Weekly'}
                        </span>
                        <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: '#dbeafe', color: '#1e40af', borderRadius: 4 }}>
                          {grp.membersCount || 0} Members
                        </span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--sup-primary)' }}>
                        ₹{Math.round(grp.actualCollection || grp.totalDueAmount || 0).toLocaleString('en-IN')}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--sup-text-muted)' }}>Collection Due</div>
                      <button
                        type="button"
                        className="sup-btn sm primary"
                        style={{ width: 'auto', marginTop: 8, padding: '4px 10px', fontSize: '0.75rem' }}
                      >
                        Collect EMI →
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div className="sup-card" style={{ borderTop: '4px solid var(--sup-primary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <strong style={{ fontSize: '1.05rem' }}>
                {selectedGroup.name || selectedGroup.groupName || selectedGroup.code}
              </strong>
              <div style={{ fontSize: '0.78rem', color: 'var(--sup-text-muted)' }}>
                Code: {selectedGroup.code || selectedGroup.groupCode} • Center: {selectedGroup.center || 'Main Center'}
              </div>
            </div>
            <button
              type="button"
              className="sup-btn sm secondary"
              style={{ width: 'auto' }}
              onClick={() => setSelectedGroup(null)}
            >
              ← Change Group
            </button>
          </div>

          <form onSubmit={handleBulkSubmit}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--sup-text-muted)' }}>
                MEMBER-WISE EMI COLLECTION ({members.length})
              </div>
              <button
                type="button"
                className="sup-btn sm secondary"
                style={{ fontSize: '0.72rem', padding: '2px 8px' }}
                onClick={() => {
                  const reset = {};
                  members.forEach((m) => {
                    const key = getMemberKey(m);
                    reset[key] = m.emiAmount || m.suggestedAmount || 0;
                  });
                  setCollections(reset);
                }}
              >
                Reset to Scheduled EMI
              </button>
            </div>

            {members.map((m) => {
              const key = getMemberKey(m);
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
                    <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{m.name || m.memberName}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>
                      Code: {m.memberCode || m.code || '—'} • Loan #{m.loanId || m.loanNo} • EMI: ₹{m.emiAmount || 0}
                    </div>
                    {m.oldDue > 0 && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--sup-danger)', fontWeight: 600 }}>
                        Overdue: ₹{m.oldDue}
                      </div>
                    )}
                  </div>
                  <div style={{ width: 120 }}>
                    <input
                      type="number"
                      className="sup-input"
                      style={{ padding: '6px 8px', fontSize: '0.88rem', textAlign: 'right', fontWeight: 700 }}
                      value={collections[key] ?? ''}
                      onChange={(e) => setCollections({ ...collections, [key]: e.target.value })}
                      placeholder="₹0"
                    />
                  </div>
                </div>
              );
            })}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, padding: '10px 12px', background: 'var(--sup-bg)', borderRadius: 8 }}>
              <span style={{ fontSize: '0.88rem', fontWeight: 700 }}>Total Group Collection:</span>
              <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--sup-primary)' }}>
                ₹{Object.values(collections).reduce((s, x) => s + (Number(x) || 0), 0).toLocaleString('en-IN')}
              </span>
            </div>

            <button type="submit" className="sup-btn" disabled={busy} style={{ marginTop: 14 }}>
              {busy ? 'Settling Collections…' : 'Submit Group Collection (Send to Approval)'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
