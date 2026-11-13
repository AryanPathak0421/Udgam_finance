import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

const LOAN_TYPES = [
  {
    id: 'group',
    label: 'Group Loan',
    icon: 'group',
    color: '#059669',
    gradient: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
    borderColor: '#059669',
    lightBg: '#ecfdf5',
  },
  {
    id: 'personal',
    label: 'Personal Loan',
    icon: 'customer',
    color: '#2563eb',
    gradient: 'linear-gradient(135deg, #1d4ed8 0%, #3b82f6 100%)',
    borderColor: '#2563eb',
    lightBg: '#eff6ff',
  },
  {
    id: 'business_msme',
    label: 'Business / MSME',
    icon: 'building',
    color: '#7c3aed',
    gradient: 'linear-gradient(135deg, #6d28d9 0%, #8b5cf6 100%)',
    borderColor: '#7c3aed',
    lightBg: '#f5f3ff',
  },
  {
    id: 'product',
    label: 'Product Loan',
    icon: 'product',
    color: '#d97706',
    gradient: 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)',
    borderColor: '#d97706',
    lightBg: '#fffbeb',
  },
];

const MODES = [
  { id: 'all', label: 'All Modes' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'daily', label: 'Daily' },
];

export default function EmployeeEmiPayment() {
  const { t } = useEmployeeApp();
  const [loanType, setLoanType] = useState('group');
  const [mode, setMode] = useState('all');
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);
  const [searchQuery, setSearchQuery] = useState('');

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

  // Dynamic QR Code Modal
  const [qrModal, setQrModal] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);

  const getLoanKey = (m) => `${m.loanPaymentId || ''}_${m.memberCode || ''}`;

  // 1. Fetch Groups when loanType === 'group' or mode/date changes
  const fetchGroups = async (keepActive = false) => {
    setLoadingGroups(true);
    if (!keepActive) {
      setActiveGroup(null);
    }
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
    setSearchQuery('');
    try {
      const res = await api.employeeApp.groupEmiMembers(group.groupCode, { date });
      const members = res.members || [];
      setGroupMembers(members);

      // Whole group collection summary
      const actualCol = res.actualCollection ?? members.reduce((s, m) => s + (m.emiAmount || 0), 0);
      const colToday = res.totalCollectedToday ?? members.reduce((s, m) => s + (m.todayPaidAmount || 0), 0);
      setActiveGroup((prev) => ({
        ...prev,
        ...group,
        actualCollection: actualCol,
        totalDueAmount: res.totalDueAmount ?? actualCol,
        totalCollectedToday: colToday,
        pendingDue: res.pendingDue ?? Math.max(0, actualCol - colToday),
      }));

      // Pre-fill collection map: 100% of members pre-filled with regular EMI to match Actual Collection
      const initialMap = {};
      members.forEach((m) => {
        const k = getLoanKey(m);
        const defaultEmi = m.emiAmount || m.suggestedAmount || 0;
        initialMap[k] = {
          selected: true,
          amount: defaultEmi,
          loanPaymentId: m.loanPaymentId,
          memberId: m.memberId,
          memberCode: m.memberCode,
          isAdvancePaid: Boolean(m.isAdvancePaid),
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
        const k = getLoanKey(item);
        const isFullyPaid = item.isAdvancePaid || (item.todayPaidAmount >= item.totalDue && item.dueAmount <= 0);
        const canCollect = !isFullyPaid && (item.dueAmount > 0 || !item.alreadyPaidToday);
        const defaultEmi = item.emiAmount || item.suggestedAmount || 0;
        initialMap[k] = {
          selected: canCollect,
          amount: defaultEmi,
          loanPaymentId: item.loanPaymentId,
          memberId: item.memberId,
          memberCode: item.memberCode,
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
  const toggleSelect = (key) => {
    setCollectionMap((prev) => {
      const current = prev[key] || {};
      if (current.isAdvancePaid) return prev;
      return {
        ...prev,
        [key]: {
          ...current,
          selected: !current.selected,
        },
      };
    });
  };

  // Handle editable amount change
  const handleAmountChange = (key, val) => {
    setCollectionMap((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        amount: val,
      },
    }));
  };

  // Toggle Select All
  const handleSelectAll = (checked, list) => {
    setCollectionMap((prev) => {
      const next = { ...prev };
      list.forEach((m) => {
        const k = getLoanKey(m);
        const isFullyPaid = m.isAdvancePaid || (m.todayPaidAmount >= m.totalDue && m.dueAmount <= 0);
        if (!isFullyPaid) {
          next[k] = {
            ...next[k],
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

  // Open Dynamic Company QR Modal
  const handleOpenQr = async () => {
    const amount = totalSelectedCollection > 0 ? totalSelectedCollection : 500;
    setQrLoading(true);
    try {
      const res = await api.employeeApp.companyQr({
        amount,
        loanId: activeGroup?.groupCode || (loanType === 'group' ? 'GROUP-EMI' : 'LOAN-EMI'),
        memberName: activeGroup?.groupName || `${loanType.toUpperCase()} Collection`,
      });
      setQrModal(res);
      setPayMode('upi');
    } catch (err) {
      console.error('Failed to load company QR', err);
      setMessage({ text: 'Unable to load company UPI QR code', type: 'error' });
    } finally {
      setQrLoading(false);
    }
  };

  const isSunday = new Date().getDay() === 0;

  // Submit Bulk EMI Collection (Save / Done)
  const handleSaveCollection = async () => {
    if (submitting) return;
    if (isSunday) {
      setMessage({ text: 'EMI collections and Loan Requisitions are blocked on Sundays (Weekly Off).', type: 'error' });
      return;
    }
    const itemsToPay = Object.values(collectionMap)
      .filter((v) => v.selected && Number(v.amount) > 0)
      .map((v) => ({
        loanPaymentId: v.loanPaymentId,
        memberCode: v.memberCode,
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
        text: `✓ Successfully collected ₹${res.totalCollected.toLocaleString('en-IN')} from ${res.collectedCount} member(s)!`,
        type: 'success',
      });

      // Refresh list to update 100% green status without resetting active group (Item 3 fix)
      if (loanType === 'group') {
        setTimeout(() => {
          fetchGroups(true);
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

  // Filter groups by search query
  const filteredGroups = groups.filter((g) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (g.groupName || '').toLowerCase().includes(q) || (g.groupCode || '').toLowerCase().includes(q);
  });

  // Filter group members by search query
  const filteredGroupMembers = groupMembers.filter((m) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (m.memberName || '').toLowerCase().includes(q) || (m.memberCode || '').toLowerCase().includes(q) || (m.loanId || '').toLowerCase().includes(q);
  });

  // Filter individual loans by search query
  const filteredIndividualLoans = individualLoans.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (item.memberName || '').toLowerCase().includes(q) || (item.memberCode || '').toLowerCase().includes(q) || (item.loanId || '').toLowerCase().includes(q);
  });

  return (
    <div className="emp-page-container">
      {/* Sunday Block Banner (Point 23) */}
      {isSunday && (
        <div style={{ background: '#fee2e2', border: '1.5px solid #ef4444', color: '#991b1b', padding: '12px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="alert" size={18} />
          <div>
            <div>Sunday Weekly Off — Collections Blocked</div>
            <div style={{ fontSize: '0.74rem', fontWeight: 500, marginTop: 2 }}>Posting EMI collections and Loan Requisitions is strictly blocked on Sundays & Company Holidays.</div>
          </div>
        </div>
      )}

      {/* 1. Loan Category Tabs - Vibrant and Colorful */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 12 }}>
        {LOAN_TYPES.map((lt) => {
          const isActive = loanType === lt.id;
          return (
            <button
              key={lt.id}
              type="button"
              onClick={() => {
                setLoanType(lt.id);
                setActiveGroup(null);
                setCollectionMap({});
                setMessage({ text: '', type: '' });
                setSearchQuery('');
              }}
              style={{
                padding: '12px 10px',
                borderRadius: 10,
                border: isActive ? `2px solid ${lt.borderColor}` : '1px solid var(--emp-border)',
                background: isActive ? lt.gradient : 'var(--emp-card-bg)',
                color: isActive ? '#ffffff' : 'var(--emp-text)',
                boxShadow: isActive ? `0 4px 14px ${lt.color}40` : '0 1px 3px rgba(0,0,0,0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                fontWeight: 800,
                fontSize: '0.88rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              <Icon name={lt.icon} size={18} style={{ color: isActive ? '#ffffff' : lt.color }} />
              <span>{lt.label}</span>
            </button>
          );
        })}
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
                padding: '8px 4px',
                borderRadius: 8,
                fontWeight: 700,
                fontSize: '0.82rem',
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

      {/* 3. Search Option Bar */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <span style={{ position: 'absolute', left: 12, color: 'var(--emp-text-muted)' }}>
            <Icon name="search" size={16} />
          </span>
          <input
            type="text"
            className="emp-input"
            placeholder={
              loanType === 'group' && !activeGroup
                ? 'Search group name or group code...'
                : 'Search borrower name, code, or loan ID...'
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: 38, width: '100%', fontSize: '0.85rem' }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute',
                right: 12,
                background: 'none',
                border: 'none',
                color: 'var(--emp-text-muted)',
                cursor: 'pointer',
                fontWeight: 800,
              }}
            >
              ✕
            </button>
          )}
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
            fontWeight: 600,
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
              {mode.toUpperCase()} Groups ({filteredGroups.length})
            </h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)' }}>Tap group card to collect</span>
          </div>

          {loadingGroups ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--emp-text-muted)' }}>Loading groups...</div>
          ) : filteredGroups.length === 0 ? (
            <div className="emp-card" style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--emp-text-muted)' }}>
              <div style={{ color: 'var(--emp-text-muted)', marginBottom: 8 }}><Icon name="group" size={40} /></div>
              <div style={{ fontWeight: 600 }}>No {mode} groups scheduled for this date</div>
              {searchQuery && <div style={{ fontSize: '0.8rem', marginTop: 4 }}>Try clearing the search query</div>}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filteredGroups.map((g) => {
                const is100Percent = (g.isCompleted || g.collectionProgressPercent >= 100) && (g.totalCollectedToday > 0);

                return (
                  <div
                    key={g.groupCode}
                    onClick={() => openGroup(g)}
                    className="emp-card"
                    style={{
                      margin: 0,
                      cursor: 'pointer',
                      border: is100Percent ? '2px solid #16a34a' : '1px solid var(--emp-border)',
                      background: is100Percent ? '#dcfce7' : 'var(--emp-card-bg)',
                      boxShadow: is100Percent ? '0 4px 14px rgba(22, 163, 74, 0.15)' : 'none',
                      borderRadius: 12,
                      padding: 14,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 800, fontSize: '1.05rem', color: is100Percent ? '#15803d' : 'var(--emp-text)' }}>
                            {g.groupName}
                          </span>
                          <span
                            style={{
                              background: is100Percent ? '#dcfce7' : '#e0e7ff',
                              color: is100Percent ? '#166534' : '#3730a3',
                              padding: '2px 8px',
                              borderRadius: 6,
                              fontSize: '0.72rem',
                              fontWeight: 800,
                            }}
                          >
                            Actual: ₹{Number(g.actualCollection || g.totalDueAmount || 0).toLocaleString('en-IN')}
                          </span>
                          {is100Percent && (
                            <span style={{ background: '#16a34a', color: '#fff', padding: '2px 8px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 800 }}>
                              ✓ 100% Collection Complete
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: is100Percent ? '#166534' : 'var(--emp-text-muted)', marginTop: 2 }}>
                          Code: <strong>{g.groupCode}</strong> • {g.membersCount} Members • {g.scheduledDay || 'Weekly'}
                        </div>
                      </div>

                      {/* Dues in RED */}
                      <div style={{ textAlign: 'right' }}>
                        <span style={{
                          display: 'inline-block',
                          fontSize: '0.82rem',
                          fontWeight: 800,
                          color: '#dc2626',
                          background: '#fee2e2',
                          border: '1px solid #fecaca',
                          padding: '2px 8px',
                          borderRadius: 6,
                        }}>
                          Dues: {g.dueCount !== undefined ? g.dueCount : 0}
                        </span>
                      </div>
                    </div>

                    {/* Actual Group Collection vs Target vs Pending Due (Point 2) */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1fr',
                      gap: 6,
                      marginTop: 10,
                      padding: '8px 10px',
                      background: is100Percent ? '#bbf7d0' : 'var(--emp-bg-subtle, #f8fafc)',
                      borderRadius: 8,
                    }}>
                      <div>
                        <div style={{ fontSize: '0.68rem', color: is100Percent ? '#166534' : 'var(--emp-text-muted)', fontWeight: 600 }}>
                          Actual Collection (Whole Group):
                        </div>
                        <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--emp-primary)' }}>
                          ₹{Number(g.actualCollection || g.totalDueAmount || 0).toLocaleString('en-IN')}
                        </div>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.68rem', color: is100Percent ? '#166534' : 'var(--emp-text-muted)', fontWeight: 600 }}>
                          Collected Today:
                        </div>
                        <div style={{ fontSize: '1rem', fontWeight: 800, color: '#15803d' }}>
                          ₹{Number(g.totalCollectedToday || 0).toLocaleString('en-IN')}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.68rem', color: is100Percent ? '#166534' : '#b91c1c', fontWeight: 600 }}>
                          Remaining Due:
                        </div>
                        <div style={{ fontSize: '1rem', fontWeight: 800, color: '#dc2626' }}>
                          ₹{Number(g.pendingDue ?? Math.max(0, (g.actualCollection || g.totalDueAmount || 0) - (g.totalCollectedToday || 0))).toLocaleString('en-IN')}
                        </div>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div style={{ marginTop: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: is100Percent ? '#166534' : 'var(--emp-text-muted)', marginBottom: 3 }}>
                        <span>Progress</span>
                        <strong>{g.collectionProgressPercent}%</strong>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: is100Percent ? '#86efac' : 'var(--emp-border)', overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${g.collectionProgressPercent}%`,
                            background: is100Percent ? '#16a34a' : 'var(--emp-primary)',
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
              border: activeGroup.isCompleted ? '2px solid #16a34a' : '1px solid var(--emp-border)',
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
                <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)' }}>Selected Collection</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#059669' }}>
                  ₹{Number(totalSelectedCollection).toLocaleString('en-IN')}
                </div>
              </div>
            </div>

            {/* Whole Group Collection Breakdown Bar */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: 8,
                marginTop: 12,
                padding: '8px 12px',
                background: 'var(--emp-bg-subtle, #f8fafc)',
                borderRadius: 8,
                border: '1px solid var(--emp-border)',
              }}
            >
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--emp-text-muted)', fontWeight: 600 }}>Actual Collection (Whole Group):</div>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--emp-primary)' }}>
                  ₹{Number(activeGroup.actualCollection || activeGroup.totalDueAmount || 0).toLocaleString('en-IN')}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--emp-text-muted)', fontWeight: 600 }}>Collected Today:</div>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#15803d' }}>
                  ₹{Number(activeGroup.totalCollectedToday || 0).toLocaleString('en-IN')}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.7rem', color: '#b91c1c', fontWeight: 600 }}>Remaining Due:</div>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#dc2626' }}>
                  ₹{Number(activeGroup.pendingDue ?? Math.max(0, (activeGroup.actualCollection || activeGroup.totalDueAmount || 0) - (activeGroup.totalCollectedToday || 0))).toLocaleString('en-IN')}
                </div>
              </div>
            </div>
          </div>

          {/* Members Collection List / Table */}
          {loadingMembers ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--emp-text-muted)' }}>Loading group members...</div>
          ) : filteredGroupMembers.length === 0 ? (
            <div className="emp-card" style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--emp-text-muted)' }}>
              <Icon name="group" size={36} style={{ opacity: 0.4, marginBottom: 8 }} />
              <div style={{ fontWeight: 700 }}>No active members found in this group</div>
              <div style={{ fontSize: '0.8rem', marginTop: 4 }}>All members might be settled or have no pending schedule.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={
                      filteredGroupMembers.length > 0 &&
                      filteredGroupMembers.filter((m) => !m.isAdvancePaid).every((m) => collectionMap[getLoanKey(m)]?.selected)
                    }
                    onChange={(e) => handleSelectAll(e.target.checked, filteredGroupMembers)}
                  />
                  Select All Unpaid
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    className="emp-btn-secondary"
                    style={{ fontSize: '0.72rem', padding: '2px 8px' }}
                    onClick={() => {
                      const reset = {};
                      groupMembers.forEach((m) => {
                        const k = getLoanKey(m);
                        reset[k] = {
                          selected: true,
                          amount: m.emiAmount || m.suggestedAmount || 0,
                          loanPaymentId: m.loanPaymentId,
                          memberId: m.memberId,
                          memberCode: m.memberCode,
                          isAdvancePaid: Boolean(m.isAdvancePaid),
                        };
                      });
                      setCollectionMap(reset);
                    }}
                  >
                    Reset to Group EMI
                  </button>
                  <span style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)' }}>{filteredGroupMembers.length} Members</span>
                </div>
              </div>

              {filteredGroupMembers.map((m) => {
                const k = getLoanKey(m);
                const itemState = collectionMap[k] || { selected: false, amount: m.emiAmount };
                const isAdvance = m.isAdvancePaid;

                return (
                  <div
                    key={k}
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
                      <input
                        type="checkbox"
                        checked={itemState.selected}
                        disabled={isAdvance}
                        onChange={() => toggleSelect(k)}
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
                            {/* EMI Amount directly under member name */}
                            <div style={{ fontSize: '0.8rem', color: '#059669', fontWeight: 700, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span>EMI Amount: ₹{Number(m.emiAmount || m.suggestedAmount || 0).toLocaleString('en-IN')}</span>
                              {m.oldDue > 0 && (
                                <span style={{ color: '#dc2626', fontWeight: 700, fontSize: '0.74rem' }}>
                                  • Overdue: ₹{Number(m.oldDue).toLocaleString('en-IN')}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                              <span>Total Due: <strong>₹{Number(m.totalDue || m.emiAmount).toLocaleString('en-IN')}</strong></span>
                              {m.todayPaidAmount > 0 && (
                                <span style={{ color: '#16a34a', fontWeight: 700 }}> • Collected: ₹{Number(m.todayPaidAmount).toLocaleString('en-IN')}</span>
                              )}
                              {m.dueAmount > 0 && m.dueAmount !== (m.totalDue || m.emiAmount) && (
                                <span style={{ color: '#dc2626', fontWeight: 700 }}> • Remaining Due: ₹{Number(m.dueAmount).toLocaleString('en-IN')}</span>
                              )}
                            </div>
                          </div>

                          <div>
                            {isAdvance ? (
                              <span className="emp-badge emp-badge-warning" style={{ fontSize: '0.72rem' }}>
                                Advance ₹{m.advanceAmount}
                              </span>
                            ) : m.dueAmount <= 0 || m.alreadyPaidToday ? (
                              <span className="emp-badge emp-badge-success" style={{ fontSize: '0.72rem' }}>
                                Paid
                              </span>
                            ) : m.oldDue > 0 ? (
                              <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#dc2626', background: '#fee2e2', padding: '2px 8px', borderRadius: 6 }}>
                                Overdue ₹{m.dueAmount}
                              </span>
                            ) : (
                              <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#059669', background: '#ecfdf5', padding: '2px 8px', borderRadius: 6 }}>
                                Due ₹{m.dueAmount}
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
                              onChange={(e) => handleAmountChange(k, e.target.value)}
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
                    <div style={{ display: 'flex', gap: 6, marginTop: 2, alignItems: 'center' }}>
                      <select
                        value={payMode}
                        onChange={(e) => {
                          setPayMode(e.target.value);
                          if (e.target.value === 'upi') handleOpenQr();
                        }}
                        style={{ fontSize: '0.8rem', padding: '4px 8px', borderRadius: 6, border: '1px solid var(--emp-border)' }}
                      >
                        <option value="cash">Cash</option>
                        <option value="upi">UPI / QR Code</option>
                      </select>
                      {payMode === 'upi' && (
                        <button
                          type="button"
                          className="emp-btn-primary"
                          style={{ padding: '4px 8px', fontSize: '0.75rem', background: '#059669' }}
                          onClick={handleOpenQr}
                        >
                          View QR
                        </button>
                      )}
                    </div>
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
              {loanType.replace(/_/g, ' ')} Loans ({filteredIndividualLoans.length})
            </h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)' }}>{mode.toUpperCase()}</span>
          </div>

          {loadingIndividual ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--emp-text-muted)' }}>Loading loans...</div>
          ) : filteredIndividualLoans.length === 0 ? (
            <div className="emp-card" style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--emp-text-muted)' }}>
              <div style={{ color: 'var(--emp-text-muted)', marginBottom: 8 }}><Icon name="briefcase" size={40} /></div>
              <div style={{ fontWeight: 600 }}>No {loanType} loans scheduled for this date</div>
              {searchQuery && <div style={{ fontSize: '0.8rem', marginTop: 4 }}>Try clearing the search query</div>}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={
                      filteredIndividualLoans.length > 0 &&
                      filteredIndividualLoans.filter((m) => !m.isAdvancePaid).every((m) => collectionMap[getLoanKey(m)]?.selected)
                    }
                    onChange={(e) => handleSelectAll(e.target.checked, filteredIndividualLoans)}
                  />
                  Select All Unpaid
                </label>
                <span style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)' }}>
                  Total: ₹{Number(totalSelectedCollection).toLocaleString('en-IN')}
                </span>
              </div>

              {filteredIndividualLoans.map((item) => {
                const k = getLoanKey(item);
                const itemState = collectionMap[k] || { selected: false, amount: item.emiAmount };
                const isAdvance = item.isAdvancePaid;
                const isCompleted = item.isCompleted || item.alreadyPaidToday;

                return (
                  <div
                    key={k}
                    className="emp-card"
                    style={{
                      margin: 0,
                      padding: 12,
                      opacity: isAdvance ? 0.75 : 1,
                      background: isCompleted ? '#dcfce7' : isAdvance ? '#fefce8' : itemState.selected ? 'rgba(37, 99, 235, 0.04)' : 'var(--emp-card-bg)',
                      border: isCompleted ? '2px solid #16a34a' : isAdvance ? '1px dashed #ca8a04' : itemState.selected ? '1px solid var(--emp-primary)' : '1px solid var(--emp-border)',
                      borderRadius: 12,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <input
                        type="checkbox"
                        checked={itemState.selected}
                        disabled={isAdvance || isCompleted}
                        onChange={() => toggleSelect(k)}
                        style={{ marginTop: 4, width: 18, height: 18, cursor: isAdvance ? 'not-allowed' : 'pointer' }}
                      />

                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.92rem', color: isCompleted ? '#15803d' : 'var(--emp-text)' }}>
                              {item.memberName}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 1 }}>
                              Code: <strong>{item.memberCode}</strong> • Loan A/c: <strong>{item.loanId}</strong>
                            </div>
                            {/* EMI Amount directly under member name */}
                            <div style={{ fontSize: '0.8rem', color: '#059669', fontWeight: 700, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span>EMI Amount: ₹{Number(item.emiAmount || item.suggestedAmount || 0).toLocaleString('en-IN')}</span>
                              {item.oldDue > 0 && (
                                <span style={{ color: '#dc2626', fontWeight: 700, fontSize: '0.74rem' }}>
                                  • Overdue: ₹{Number(item.oldDue).toLocaleString('en-IN')}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                              <span>Total Due: <strong>₹{Number(item.totalDue || item.emiAmount).toLocaleString('en-IN')}</strong></span>
                              {item.todayPaidAmount > 0 && (
                                <span style={{ color: '#16a34a', fontWeight: 700 }}> • Collected: ₹{Number(item.todayPaidAmount).toLocaleString('en-IN')}</span>
                              )}
                              {item.dueAmount > 0 && item.dueAmount !== (item.totalDue || item.emiAmount) && (
                                <span style={{ color: '#dc2626', fontWeight: 700 }}> • Remaining Due: ₹{Number(item.dueAmount).toLocaleString('en-IN')}</span>
                              )}
                            </div>
                          </div>

                          <div>
                            {isCompleted ? (
                              <span style={{ background: '#16a34a', color: '#fff', padding: '2px 8px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 800 }}>
                                ✓ 100% Paid
                              </span>
                            ) : isAdvance ? (
                              <span className="emp-badge emp-badge-warning" style={{ fontSize: '0.72rem' }}>
                                Advance ₹{item.advanceAmount}
                              </span>
                            ) : item.dueAmount > 0 ? (
                              <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#dc2626', background: '#fee2e2', padding: '2px 8px', borderRadius: 6 }}>
                                Due ₹{item.dueAmount}
                              </span>
                            ) : (
                              <span className="emp-badge emp-badge-success" style={{ fontSize: '0.72rem' }}>
                                Paid
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
                              onChange={(e) => handleAmountChange(k, e.target.value)}
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
                    <div style={{ display: 'flex', gap: 6, marginTop: 2, alignItems: 'center' }}>
                      <select
                        value={payMode}
                        onChange={(e) => {
                          setPayMode(e.target.value);
                          if (e.target.value === 'upi') handleOpenQr();
                        }}
                        style={{ fontSize: '0.8rem', padding: '4px 8px', borderRadius: 6, border: '1px solid var(--emp-border)' }}
                      >
                        <option value="cash">Cash</option>
                        <option value="upi">UPI / QR Code</option>
                      </select>
                      {payMode === 'upi' && (
                        <button
                          type="button"
                          className="emp-btn-primary"
                          style={{ padding: '4px 8px', fontSize: '0.75rem', background: '#059669' }}
                          onClick={handleOpenQr}
                        >
                          View QR
                        </button>
                      )}
                    </div>
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
                  disabled={submitting || totalSelectedCollection <= 0 || isSunday}
                >
                  {submitting ? 'Saving Collections...' : isSunday ? '⚠️ Blocked on Sundays' : '✓ Done / Save Collection'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Dynamic Company UPI QR Code Modal */}
      {qrModal && (
        <div className="emp-modal-overlay" onClick={() => setQrModal(null)}>
          <div className="emp-modal-sheet" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center' }}>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: '0 0 6px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Icon name="qrcode" size={20} style={{ color: 'var(--emp-primary)' }} />
              <span>Scan & Pay via Company UPI</span>
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', margin: '0 0 14px 0' }}>
              Borrower pays directly to <strong>{qrModal.companyName}</strong> bank account.
            </p>

            <div style={{ display: 'inline-block', padding: 12, background: '#fff', borderRadius: 12, border: '2px solid var(--emp-border)', margin: '0 auto 12px auto' }}>
              <img src={qrModal.qrImageUrl} alt="Company UPI QR" style={{ width: 220, height: 220, display: 'block' }} />
            </div>

            <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#059669', marginBottom: 4 }}>
              ₹{Number(qrModal.amount).toLocaleString('en-IN')}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', marginBottom: 16 }}>
              UPI ID: <strong>{qrModal.upiId}</strong>
            </div>

            <div style={{ background: '#fef3c7', padding: '10px 14px', borderRadius: 8, fontSize: '0.78rem', color: '#92400e', marginBottom: 16, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="shieldcheck" size={16} />
              <span><strong>Supported Apps:</strong> PhonePe, Google Pay, Paytm, BHIM, or any bank UPI app.</span>
            </div>

            <button
              type="button"
              className="emp-btn-primary"
              style={{ width: '100%', padding: '12px', fontSize: '0.95rem' }}
              onClick={() => setQrModal(null)}
            >
              Done Scanning
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
