import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

const LOAN_TYPES = [
  { id: 'group', label: 'Group Loan', icon: 'group' },
  { id: 'personal', label: 'Personal Loan', icon: 'customer' },
  { id: 'business_msme', label: 'Business / MSME', icon: 'building' },
  { id: 'product', label: 'Product Loan', icon: 'product' },
];

const MODES = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
];

export default function EmployeeEmiPayment() {
  const { t } = useEmployeeApp();
  const [loanType, setLoanType] = useState('group');
  const [mode, setMode] = useState('daily');
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);

  // Group loan state
  const [groups, setGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [activeGroup, setActiveGroup] = useState(null); // when a group is clicked
  const [groupMembers, setGroupMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // Individual loans state
  const [individualLoans, setIndividualLoans] = useState([]);
  const [loadingIndividual, setLoadingIndividual] = useState(false);

  // Selection & editable amounts
  // memberCode -> { selected: boolean, amount: number, loanPaymentId, memberId }
  const [collectionMap, setCollectionMap] = useState({});
  const [payMode, setPayMode] = useState('cash');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  // 1. Fetch Groups when loanType === 'group' or mode/date changes
  const fetchGroups = async () => {
    setLoadingGroups(true);
    setActiveGroup(null);
    try {
      const res = await api.employeeApp.emiGroups({ mode, date });
      setGroups(res.groups || []);
    } catch (err) {
      console.error(err);
      setGroups([]);
    } finally {
      setLoadingGroups(false);
    }
  };

  // 2. Fetch Group Members when a group is selected
  const openGroup = async (group) => {
    setActiveGroup(group);
    setLoadingMembers(true);
    setMessage({ text: '', type: '' });
    try {
      const res = await api.employeeApp.groupEmiMembers(group.groupCode, { date });
      const members = res.members || [];
      setGroupMembers(members);

      // Pre-fill collection map
      const initialMap = {};
      members.forEach((m) => {
        // If member already has advance payment or paid today, do not auto-select
        const canCollect = !m.isAdvancePaid && !m.alreadyPaidToday;
        initialMap[m.memberCode] = {
          selected: canCollect,
          amount: m.suggestedAmount || m.emiAmount || 0,
          loanPaymentId: m.loanPaymentId,
          memberId: m.memberId,
          isAdvancePaid: m.isAdvancePaid,
        };
      });
      setCollectionMap(initialMap);
    } catch (err) {
      setMessage({ text: err.message || 'Failed to load group members', type: 'error' });
    } finally {
      setLoadingMembers(false);
    }
  };

  // 3. Fetch Individual Loans when loanType !== 'group'
  const fetchIndividualLoans = async () => {
    setLoadingIndividual(true);
    setMessage({ text: '', type: '' });
    try {
      const res = await api.employeeApp.individualLoans({ loanType, mode, date });
      const items = res.items || [];
      setIndividualLoans(items);

      const initialMap = {};
      items.forEach((item) => {
        const canCollect = !item.isAdvancePaid && !item.alreadyPaidToday;
        initialMap[item.memberCode] = {
          selected: canCollect,
          amount: item.suggestedAmount || item.emiAmount || 0,
          loanPaymentId: item.loanPaymentId,
          memberId: item.memberId,
          isAdvancePaid: item.isAdvancePaid,
        };
      });
      setCollectionMap(initialMap);
    } catch (err) {
      console.error(err);
      setIndividualLoans([]);
    } finally {
      setLoadingIndividual(false);
    }
  };

  useEffect(() => {
    if (loanType === 'group') {
      fetchGroups();
    } else {
      fetchIndividualLoans();
    }
  }, [loanType, mode, date]);

  // Handle single tick checkbox toggle
  const toggleSelect = (memberCode) => {
    setCollectionMap((prev) => {
      const current = prev[memberCode] || {};
      if (current.isAdvancePaid) return prev; // Cannot select advance paid member
      return {
        ...prev,
        [memberCode]: {
          ...current,
          selected: !current.selected,
        },
      };
    });
  };

  // Handle editable amount change
  const handleAmountChange = (memberCode, val) => {
    setCollectionMap((prev) => ({
      ...prev,
      [memberCode]: {
        ...prev[memberCode],
        amount: val,
      },
    }));
  };

  // Toggle Select All
  const handleSelectAll = (checked, list) => {
    setCollectionMap((prev) => {
      const next = { ...prev };
      list.forEach((m) => {
        if (!m.isAdvancePaid && !m.alreadyPaidToday) {
          next[m.memberCode] = {
            ...next[m.memberCode],
            selected: checked,
          };
        }
      });
      return next;
    });
  };

  // Calculate live total collection
  const totalSelectedCollection = Object.values(collectionMap)
    .filter((v) => v.selected)
    .reduce((sum, v) => sum + (Number(v.amount) || 0), 0);

  // Submit Bulk EMI Collection (Save / Done)
  const handleSaveCollection = async () => {
    const itemsToPay = Object.entries(collectionMap)
      .filter(([, v]) => v.selected && Number(v.amount) > 0)
      .map(([code, v]) => ({
        loanPaymentId: v.loanPaymentId,
        memberCode: code,
        memberId: v.memberId,
        amount: Number(v.amount),
        payMode,
      }));

    if (!itemsToPay.length) {
      setMessage({ text: 'Please select at least one member with amount to collect', type: 'error' });
      return;
    }

    setSubmitting(true);
    setMessage({ text: '', type: '' });
    try {
      const res = await api.employeeApp.collectBulkEmi({
        items: itemsToPay,
        date,
        payMode,
      });

      setMessage({
        text: `Successfully collected ₹${res.totalCollected.toLocaleString('en-IN')} from ${res.collectedCount} member(s)!`,
        type: 'success',
      });

      // Refresh list to update 100% green status
      if (loanType === 'group') {
        setTimeout(() => {
          fetchGroups();
          if (activeGroup) openGroup(activeGroup);
        }, 1200);
      } else {
        setTimeout(() => {
          fetchIndividualLoans();
        }, 1200);
      }
    } catch (err) {
      setMessage({ text: err.message || 'Collection submission failed', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="emp-page-container">
      {/* 1. Loan Category Tabs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 12 }}>
        {LOAN_TYPES.map((lt) => (
          <button
            key={lt.id}
            type="button"
            className={loanType === lt.id ? 'emp-btn-primary' : 'emp-btn-secondary'}
            style={{ padding: '8px 6px', fontSize: '0.82rem', fontWeight: 700 }}
            onClick={() => {
              setLoanType(lt.id);
              setActiveGroup(null);
            }}
          >
            {lt.label}
          </button>
        ))}
      </div>

      {/* 2. Frequency Filter Tabs (Daily, Weekly, Monthly) */}
      <div className="emp-card" style={{ padding: '10px 14px', marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--emp-text)' }}>Collection Frequency:</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ fontSize: '0.78rem', padding: '4px 8px', border: '1px solid var(--emp-border)', borderRadius: 6 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setMode(m.id);
                setActiveGroup(null);
              }}
              style={{
                flex: 1,
                padding: '6px',
                borderRadius: 6,
                fontWeight: 700,
                fontSize: '0.8rem',
                border: mode === m.id ? '2px solid var(--emp-primary)' : '1px solid var(--emp-border)',
                background: mode === m.id ? 'var(--emp-primary)' : 'var(--emp-card-bg)',
                color: mode === m.id ? '#fff' : 'var(--emp-text)',
                cursor: 'pointer',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {message.text && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: '0.85rem',
            marginBottom: 12,
            background: message.type === 'success' ? '#dcfce7' : '#fee2e2',
            color: message.type === 'success' ? '#166534' : '#991b1b',
          }}
        >
          {message.text}
        </div>
      )}

      {/* ========================================================= */}
      {/* CASE A: GROUP LOAN VIEW */}
      {/* ========================================================= */}
      {loanType === 'group' && !activeGroup && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, color: 'var(--emp-text)' }}>
              {mode.toUpperCase()} Groups ({groups.length})
            </h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)' }}>Tap group to collect</span>
          </div>

          {loadingGroups ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--emp-text-muted)' }}>Loading groups...</div>
          ) : groups.length === 0 ? (
            <div className="emp-card" style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--emp-text-muted)' }}>
              <div style={{ color: 'var(--emp-text-muted)', marginBottom: 8 }}><Icon name="group" size={40} /></div>
              <div style={{ fontWeight: 600 }}>No {mode} groups found for this date</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {groups.map((g) => {
                const is100Percent = g.isCompleted || g.collectionProgressPercent >= 100;

                return (
                  <div
                    key={g.groupCode}
                    onClick={() => openGroup(g)}
                    className="emp-card"
                    style={{
                      margin: 0,
                      cursor: 'pointer',
                      border: is100Percent ? '2px solid #10b981' : '1px solid var(--emp-border)',
                      background: is100Percent ? '#f0fdf4' : 'var(--emp-card-bg)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontWeight: 800, fontSize: '1rem', color: is100Percent ? '#047857' : 'var(--emp-text)' }}>
                            {g.groupName}
                          </span>
                          {is100Percent && <span className="emp-badge emp-badge-success">✓ 100% Complete</span>}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                          Code: <strong>{g.groupCode}</strong> • {g.membersCount} Members
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '1.05rem', fontWeight: 800, color: is100Percent ? '#059669' : 'var(--emp-primary)' }}>
                          ₹{Number(g.totalDueAmount).toLocaleString('en-IN')}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Target Due</div>
                      </div>
                    </div>

                    {/* Progress Bar (Green when 100%) */}
                    <div style={{ marginTop: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--emp-text-muted)', marginBottom: 3 }}>
                        <span>Collected: ₹{Number(g.totalCollectedToday).toLocaleString('en-IN')}</span>
                        <strong style={{ color: is100Percent ? '#059669' : 'inherit' }}>{g.collectionProgressPercent}%</strong>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: 'var(--emp-border)', overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${g.collectionProgressPercent}%`,
                            background: is100Percent ? '#10b981' : 'var(--emp-primary)',
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* CASE B: ACTIVE GROUP EMI COLLECTION VIEW (TABLE / DESIGN) */}
      {/* ========================================================= */}
      {loanType === 'group' && activeGroup && (
        <div>
          {/* Back button & Group Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <button
              type="button"
              className="emp-btn-secondary"
              style={{ padding: '6px 12px', fontSize: '0.8rem' }}
              onClick={() => setActiveGroup(null)}
            >
              ← Back to Groups
            </button>
            <div style={{ flex: 1, textAlign: 'right' }}>
              <span className="emp-badge emp-badge-info" style={{ textTransform: 'capitalize' }}>
                {mode} Collection
              </span>
            </div>
          </div>

          {/* Group Details Header Card */}
          <div
            className="emp-card"
            style={{
              background: activeGroup.isCompleted ? '#f0fdf4' : 'var(--emp-card-bg)',
              border: activeGroup.isCompleted ? '2px solid #10b981' : '1px solid var(--emp-border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: 'var(--emp-text)' }}>
                  {activeGroup.groupName}
                </h3>
                <div style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                  Group Code: <strong>{activeGroup.groupCode}</strong>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)' }}>Total Collection</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#059669' }}>
                  ₹{Number(totalSelectedCollection).toLocaleString('en-IN')}
                </div>
              </div>
            </div>
          </div>

          {/* Members Collection List / Table */}
          {loadingMembers ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--emp-text-muted)' }}>Loading group members...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={groupMembers.length > 0 && groupMembers.filter((m) => !m.isAdvancePaid).every((m) => collectionMap[m.memberCode]?.selected)}
                    onChange={(e) => handleSelectAll(e.target.checked, groupMembers)}
                  />
                  Select All Unpaid
                </label>
                <span style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)' }}>{groupMembers.length} Members</span>
              </div>

              {groupMembers.map((m) => {
                const itemState = collectionMap[m.memberCode] || { selected: false, amount: m.emiAmount };
                const isAdvance = m.isAdvancePaid;

                return (
                  <div
                    key={m.memberCode}
                    className="emp-card"
                    style={{
                      margin: 0,
                      padding: 12,
                      opacity: isAdvance ? 0.75 : 1,
                      background: isAdvance ? '#fefce8' : itemState.selected ? 'rgba(37, 99, 235, 0.04)' : 'var(--emp-card-bg)',
                      border: isAdvance ? '1px dashed #ca8a04' : itemState.selected ? '1px solid var(--emp-primary)' : '1px solid var(--emp-border)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      {/* Checkbox (Single Tick) */}
                      <input
                        type="checkbox"
                        checked={itemState.selected}
                        disabled={isAdvance}
                        onChange={() => toggleSelect(m.memberCode)}
                        style={{ marginTop: 4, width: 18, height: 18, cursor: isAdvance ? 'not-allowed' : 'pointer' }}
                      />

                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--emp-text)' }}>
                              {m.memberName}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 1 }}>
                              Code: <strong>{m.memberCode}</strong> • Loan A/c: <strong>{m.loanId}</strong>
                            </div>
                          </div>

                          {/* Advance or Dues Status Badge */}
                          <div>
                            {isAdvance ? (
                              <span className="emp-badge emp-badge-warning" style={{ fontSize: '0.72rem' }}>
                                Advance ₹{m.advanceAmount} (No EMI Update)
                              </span>
                            ) : m.dueAmount > 0 ? (
                              <span className="emp-badge emp-badge-danger" style={{ fontSize: '0.72rem' }}>
                                Due ₹{m.dueAmount}
                              </span>
                            ) : (
                              <span className="emp-badge emp-badge-success" style={{ fontSize: '0.72rem' }}>
                                Regular
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Editable EMI Amount */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                          <span style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)' }}>EMI Amount:</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>₹</span>
                            <input
                              type="number"
                              className="emp-input"
                              disabled={isAdvance || !itemState.selected}
                              value={itemState.amount}
                              onChange={(e) => handleAmountChange(m.memberCode, e.target.value)}
                              style={{
                                width: 90,
                                padding: '4px 8px',
                                fontSize: '0.85rem',
                                fontWeight: 700,
                                textAlign: 'right',
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Bottom Sticky Action Bar */}
              <div
                className="emp-card"
                style={{
                  position: 'sticky',
                  bottom: 70,
                  boxShadow: '0 -4px 12px rgba(0,0,0,0.1)',
                  zIndex: 20,
                  marginTop: 10,
                  padding: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Payment Mode:</div>
                    <select
                      value={payMode}
                      onChange={(e) => setPayMode(e.target.value)}
                      style={{ fontSize: '0.8rem', padding: '4px 8px', borderRadius: 6, border: '1px solid var(--emp-border)', marginTop: 2 }}
                    >
                      <option value="cash">Cash</option>
                      <option value="upi">UPI / QR Code</option>
                    </select>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Total to Save:</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#059669' }}>
                      ₹{Number(totalSelectedCollection).toLocaleString('en-IN')}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="emp-btn-primary"
                  style={{ width: '100%', padding: '12px', fontSize: '0.95rem', fontWeight: 800 }}
                  onClick={handleSaveCollection}
                  disabled={submitting || totalSelectedCollection <= 0}
                >
                  {submitting ? 'Saving Collections...' : '✓ Done / Save Group EMI'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* CASE C: PERSONAL / BUSINESS / PRODUCT LOANS VIEW */}
      {/* ========================================================= */}
      {loanType !== 'group' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, color: 'var(--emp-text)', textTransform: 'capitalize' }}>
              {loanType.replace(/_/g, ' ')} Loans ({individualLoans.length})
            </h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)' }}>{mode.toUpperCase()}</span>
          </div>

          {loadingIndividual ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--emp-text-muted)' }}>Loading loans...</div>
          ) : individualLoans.length === 0 ? (
            <div className="emp-card" style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--emp-text-muted)' }}>
              <div style={{ color: 'var(--emp-text-muted)', marginBottom: 8 }}><Icon name="briefcase" size={40} /></div>
              <div style={{ fontWeight: 600 }}>No {loanType} {mode} loans found for this date</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={individualLoans.length > 0 && individualLoans.filter((m) => !m.isAdvancePaid).every((m) => collectionMap[m.memberCode]?.selected)}
                    onChange={(e) => handleSelectAll(e.target.checked, individualLoans)}
                  />
                  Select All Unpaid
                </label>
                <span style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)' }}>
                  Total: ₹{Number(totalSelectedCollection).toLocaleString('en-IN')}
                </span>
              </div>

              {individualLoans.map((item) => {
                const itemState = collectionMap[item.memberCode] || { selected: false, amount: item.emiAmount };
                const isAdvance = item.isAdvancePaid;
                const isCompleted = item.isCompleted || item.alreadyPaidToday;

                return (
                  <div
                    key={item.memberCode}
                    className="emp-card"
                    style={{
                      margin: 0,
                      padding: 12,
                      opacity: isAdvance ? 0.75 : 1,
                      background: isCompleted ? '#f0fdf4' : isAdvance ? '#fefce8' : itemState.selected ? 'rgba(37, 99, 235, 0.04)' : 'var(--emp-card-bg)',
                      border: isCompleted ? '2px solid #10b981' : isAdvance ? '1px dashed #ca8a04' : itemState.selected ? '1px solid var(--emp-primary)' : '1px solid var(--emp-border)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <input
                        type="checkbox"
                        checked={itemState.selected}
                        disabled={isAdvance || isCompleted}
                        onChange={() => toggleSelect(item.memberCode)}
                        style={{ marginTop: 4, width: 18, height: 18, cursor: isAdvance ? 'not-allowed' : 'pointer' }}
                      />

                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--emp-text)' }}>
                              {item.memberName}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 1 }}>
                              Code: <strong>{item.memberCode}</strong> • Loan A/c: <strong>{item.loanId}</strong>
                            </div>
                          </div>

                          <div>
                            {isCompleted ? (
                              <span className="emp-badge emp-badge-success" style={{ fontSize: '0.72rem' }}>
                                ✓ 100% Paid
                              </span>
                            ) : isAdvance ? (
                              <span className="emp-badge emp-badge-warning" style={{ fontSize: '0.72rem' }}>
                                Advance ₹{item.advanceAmount}
                              </span>
                            ) : (
                              <span className="emp-badge emp-badge-danger" style={{ fontSize: '0.72rem' }}>
                                Due ₹{item.dueAmount}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Editable EMI Amount */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                          <span style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)' }}>EMI Amount:</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>₹</span>
                            <input
                              type="number"
                              className="emp-input"
                              disabled={isAdvance || isCompleted || !itemState.selected}
                              value={itemState.amount}
                              onChange={(e) => handleAmountChange(item.memberCode, e.target.value)}
                              style={{
                                width: 90,
                                padding: '4px 8px',
                                fontSize: '0.85rem',
                                fontWeight: 700,
                                textAlign: 'right',
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Bottom Sticky Action Bar */}
              <div
                className="emp-card"
                style={{
                  position: 'sticky',
                  bottom: 70,
                  boxShadow: '0 -4px 12px rgba(0,0,0,0.1)',
                  zIndex: 20,
                  marginTop: 10,
                  padding: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Payment Mode:</div>
                    <select
                      value={payMode}
                      onChange={(e) => setPayMode(e.target.value)}
                      style={{ fontSize: '0.8rem', padding: '4px 8px', borderRadius: 6, border: '1px solid var(--emp-border)', marginTop: 2 }}
                    >
                      <option value="cash">Cash</option>
                      <option value="upi">UPI / QR Code</option>
                    </select>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Total to Save:</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#059669' }}>
                      ₹{Number(totalSelectedCollection).toLocaleString('en-IN')}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="emp-btn-primary"
                  style={{ width: '100%', padding: '12px', fontSize: '0.95rem', fontWeight: 800 }}
                  onClick={handleSaveCollection}
                  disabled={submitting || totalSelectedCollection <= 0}
                >
                  {submitting ? 'Saving Collections...' : '✓ Done / Save Collection'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

