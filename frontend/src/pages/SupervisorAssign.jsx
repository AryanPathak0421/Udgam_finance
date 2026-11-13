import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';
import { PageHeader, Spinner, EmptyState, ErrorState } from '../components/ui/Feedback.jsx';
import Modal from '../components/ui/Modal.jsx';
import FormField from '../components/ui/FormField.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { staffLabel, branchLabel } from '../utils/staffLabel.js';

function useLoad(fn, deps) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setData(await fn()); } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { data, setData, loading, error, load };
}

export default function SupervisorAssign() {
  const toast = useToast();
  const [mode, setMode] = useState('branch'); // 'branch' | 'supervisor' | 'employee'
  const [selectedBranchIds, setSelectedBranchIds] = useState([]);
  const [selectedSupervisorId, setSelectedSupervisorId] = useState('');
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState(new Set());
  const [targetDesignationId, setTargetDesignationId] = useState('');
  const [assignSupervisorId, setAssignSupervisorId] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [singleAssignEmp, setSingleAssignEmp] = useState(null);

  // Load active employees and HR options
  const employeesLoad = useLoad(() => api.hr.employees({ status: 'active' }), []);
  const optionsLoad = useLoad(() => api.hr.options(), []);

  const allEmployees = useMemo(() => employeesLoad.data?.items || [], [employeesLoad.data]);
  const branches = useMemo(() => optionsLoad.data?.branches || [], [optionsLoad.data]);
  const designations = useMemo(() => optionsLoad.data?.designations || [], [optionsLoad.data]);

  // List of all supervisors (employees who have a supervisor designation, supervise branches, or have a team)
  const isSupervisorCandidate = (e) => Boolean(
    (e.teamCount && e.teamCount > 0) ||
    (Array.isArray(e.supervisedBranches) && e.supervisedBranches.length > 0) ||
    /supervisor|manager|officer|head|lead/i.test(e.designation?.name || '') ||
    /supervisor/i.test(e.name || '')
  );

  // Supervisors filtered by target designation (Point 1: click krne k select k baad designation select hoga)
  const eligibleSupervisors = useMemo(() => {
    let list = allEmployees.filter(isSupervisorCandidate);
    if (list.length === 0) list = allEmployees;
    if (!targetDesignationId) return list;
    return list.filter((e) => (e.designation?.id || e.designation?._id || e.designation) === targetDesignationId);
  }, [allEmployees, targetDesignationId]);

  // All supervisors for the "Supervisor wise" filter
  const allSupervisorsList = useMemo(() => {
    const list = allEmployees.filter(isSupervisorCandidate);
    return list.length > 0 ? list : allEmployees;
  }, [allEmployees]);

  // Filtered employees to display based on selected mode
  const displayedEmployees = useMemo(() => {
    let list = allEmployees;

    // 1. Branch wise: jitne Branch select honge utne Branch ka data show hoga
    if (mode === 'branch') {
      if (selectedBranchIds.length > 0) {
        const idSet = new Set(selectedBranchIds);
        list = list.filter((e) => idSet.has(e.branch?.id || e.branch?._id || e.branch));
      }
    }
    // 2. Supervisor wise: pure supervisor ka data show hoga
    else if (mode === 'supervisor') {
      if (selectedSupervisorId) {
        list = list.filter((e) => {
          const supId = e.supervisor?.id || e.supervisor?._id || e.supervisor;
          return supId === selectedSupervisorId;
        });
      }
    }
    // 3. Employee wise: pure employee ka data will employee jo select kiya hai
    else if (mode === 'employee') {
      if (selectedEmployeeIds.size > 0) {
        list = list.filter((e) => selectedEmployeeIds.has(e.id || e._id));
      }
    }

    // Text search filter
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((e) =>
        (e.employeeCode || '').toLowerCase().includes(q) ||
        (e.name || '').toLowerCase().includes(q) ||
        (e.mobile || '').toLowerCase().includes(q) ||
        (e.designation?.name || '').toLowerCase().includes(q) ||
        (e.branch?.name || '').toLowerCase().includes(q) ||
        (e.supervisor?.name || '').toLowerCase().includes(q)
      );
    }

    return list;
  }, [allEmployees, mode, selectedBranchIds, selectedSupervisorId, selectedEmployeeIds, search]);

  // Multi-selection set of checkboxes for assignment
  const [checkedIds, setCheckedIds] = useState(new Set());

  // Toggle single checkbox
  const toggleCheck = (id) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Toggle all visible
  const toggleSelectAll = (e) => {
    if (e.target.checked) {
      setCheckedIds(new Set(displayedEmployees.map((emp) => emp.id || emp._id)));
    } else {
      setCheckedIds(new Set());
    }
  };

  // Handle Branch multi-select toggle
  const toggleBranch = (branchId) => {
    setSelectedBranchIds((prev) =>
      prev.includes(branchId) ? prev.filter((id) => id !== branchId) : [...prev, branchId]
    );
  };

  // Submit Supervisor Assignment
  async function handleAssign(supId) {
    const targetSupervisor = supId !== undefined ? supId : assignSupervisorId;
    const targets = singleAssignEmp ? [singleAssignEmp.id || singleAssignEmp._id] : [...checkedIds];

    if (!targets.length) {
      toast.error('Select at least one employee to assign');
      return;
    }
    if (!targetSupervisor && targetSupervisor !== null) {
      toast.error('Select a supervisor to assign');
      return;
    }

    setBusy(true);
    try {
      const r = await api.hr.supervisorAssign({
        supervisorId: targetSupervisor || null,
        employeeIds: targets,
      });
      toast.success(r.message || 'Supervisor assigned successfully');
      setCheckedIds(new Set());
      setSingleAssignEmp(null);
      employeesLoad.load();
    } catch (err) {
      toast.error(err.message || 'Failed to assign supervisor');
    } finally {
      setBusy(false);
    }
  }

  // Statistics
  const totalCount = allEmployees.length;
  const withSupervisor = allEmployees.filter((e) => e.supervisor).length;
  const withoutSupervisor = totalCount - withSupervisor;

  const allVisibleSelected = displayedEmployees.length > 0 && displayedEmployees.every((e) => checkedIds.has(e.id || e._id));

  return (
    <>
      <PageHeader
        title="Supervisor Assign"
        description="Assign supervisors to employees. Filter by Branch, Supervisor, or Employee, select Designation, and assign supervisors."
      />

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div className="panel" style={{ padding: '12px 16px', background: '#f8fafc' }}>
          <div className="muted small">Total Employees</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#0f172a' }}>{totalCount}</div>
        </div>
        <div className="panel" style={{ padding: '12px 16px', background: '#f0fdf4' }}>
          <div className="muted small" style={{ color: '#166534' }}>Assigned Supervisor</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#15803d' }}>{withSupervisor}</div>
        </div>
        <div className="panel" style={{ padding: '12px 16px', background: '#fef2f2' }}>
          <div className="muted small" style={{ color: '#991b1b' }}>Pending Assignment</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#b91c1c' }}>{withoutSupervisor}</div>
        </div>
        <div className="panel" style={{ padding: '12px 16px', background: '#eff6ff' }}>
          <div className="muted small" style={{ color: '#1e40af' }}>Selected for Action</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1d4ed8' }}>{checkedIds.size}</div>
        </div>
      </div>

      {/* 3 Main Options (Point 1: Branch wise, Supervisor wise, employee wise teen option hoga) */}
      <div className="panel" style={{ marginBottom: 16, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: '0.9rem', marginRight: 6 }}>Filter View:</span>
            <button
              type="button"
              className={`btn ${mode === 'branch' ? 'primary' : ''}`}
              onClick={() => { setMode('branch'); setCheckedIds(new Set()); }}
            >
              1. Branch wise
            </button>
            <button
              type="button"
              className={`btn ${mode === 'supervisor' ? 'primary' : ''}`}
              onClick={() => { setMode('supervisor'); setCheckedIds(new Set()); }}
            >
              2. Supervisor wise
            </button>
            <button
              type="button"
              className={`btn ${mode === 'employee' ? 'primary' : ''}`}
              onClick={() => { setMode('employee'); setCheckedIds(new Set()); }}
            >
              3. Employee wise
            </button>
          </div>

          <input
            type="search"
            placeholder="Search code, name, designation..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 260 }}
          />
        </div>

        {/* Mode 1: Branch Wise Filters */}
        {mode === 'branch' && (
          <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#334155' }}>
                Select Branches ({selectedBranchIds.length === 0 ? 'All Branches Showing' : `${selectedBranchIds.length} Selected`}):
              </span>
              {selectedBranchIds.length > 0 && (
                <button type="button" className="btn sm" onClick={() => setSelectedBranchIds([])}>
                  Clear Branch Filter (Show All)
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', maxHeight: 120, overflowY: 'auto' }}>
              {branches.map((b) => (
                <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.85rem' }}>
                  <input
                    type="checkbox"
                    checked={selectedBranchIds.includes(b.id)}
                    onChange={() => toggleBranch(b.id)}
                  />
                  <span><strong>{b.code}</strong> — {b.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Mode 2: Supervisor Wise Filter */}
        {mode === 'supervisor' && (
          <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 16 }}>
            <label style={{ fontWeight: 600, fontSize: '0.85rem', color: '#334155', minWidth: 140 }}>
              Select Supervisor:
            </label>
            <select
              value={selectedSupervisorId}
              onChange={(e) => setSelectedSupervisorId(e.target.value)}
              style={{ maxWidth: 380, flex: 1 }}
            >
              <option value="">All Supervisors (Show All)</option>
              {allSupervisorsList.map((s) => (
                <option key={s.id} value={s.id}>
                  {staffLabel(s)} · Team: {s.teamCount || 0}
                </option>
              ))}
            </select>
            {selectedSupervisorId && (
              <button type="button" className="btn sm" onClick={() => setSelectedSupervisorId('')}>
                Show All
              </button>
            )}
          </div>
        )}

        {/* Mode 3: Employee Wise Filter */}
        {mode === 'employee' && (
          <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <label style={{ fontWeight: 600, fontSize: '0.85rem', color: '#334155', minWidth: 140 }}>
              Pick Specific Employee:
            </label>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  setSelectedEmployeeIds((prev) => new Set([...prev, e.target.value]));
                }
              }}
              style={{ maxWidth: 360, flex: 1 }}
            >
              <option value="">Choose employee to add to view...</option>
              {allEmployees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.employeeCode} — {emp.name} ({emp.designation?.name || 'Staff'})
                </option>
              ))}
            </select>
            {selectedEmployeeIds.size > 0 && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span className="muted small">({selectedEmployeeIds.size} chosen)</span>
                <button type="button" className="btn sm" onClick={() => setSelectedEmployeeIds(new Set())}>
                  Show All Employees
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Assignment Control Bar (Point 1: Designation select hoga -> fir Supervisor select hoga) */}
      <div className="panel" style={{ marginBottom: 16, padding: '14px 16px', background: '#f0fdf4', border: '1.5px solid #bbf7d0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', flex: 1 }}>
            <span style={{ fontWeight: 700, color: '#166534', fontSize: '0.95rem' }}>
              Assign Supervisor to ({checkedIds.size}) Selected:
            </span>

            {/* Step 1: Select Designation */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#374151' }}>Designation:</label>
              <select
                value={targetDesignationId}
                onChange={(e) => {
                  setTargetDesignationId(e.target.value);
                  setAssignSupervisorId('');
                }}
                style={{ minWidth: 160 }}
              >
                <option value="">All Designations</option>
                {designations.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>

            {/* Step 2: Select Supervisor */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#374151' }}>Supervisor:</label>
              <select
                value={assignSupervisorId}
                onChange={(e) => setAssignSupervisorId(e.target.value)}
                style={{ minWidth: 220 }}
              >
                <option value="">Select Supervisor</option>
                {eligibleSupervisors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.employeeCode} — {s.name} ({s.branch?.code || 'HO'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="btn primary"
              disabled={busy || checkedIds.size === 0 || !assignSupervisorId}
              onClick={() => handleAssign()}
            >
              {busy ? 'Assigning…' : `Assign Supervisor (${checkedIds.size})`}
            </button>
            <button
              type="button"
              className="btn danger-outline"
              disabled={busy || checkedIds.size === 0}
              onClick={() => {
                if (window.confirm(`Unassign supervisor from ${checkedIds.size} selected employee(s)?`)) {
                  handleAssign(null);
                }
              }}
              title="Remove supervisor from selected employees"
            >
              Remove Supervisor
            </button>
          </div>
        </div>
      </div>

      {/* Employees Table */}
      <div className="panel">
        {employeesLoad.loading && !employeesLoad.data ? (
          <Spinner label="Loading employees…" />
        ) : employeesLoad.error ? (
          <ErrorState message={employeesLoad.error} onRetry={employeesLoad.load} />
        ) : displayedEmployees.length === 0 ? (
          <EmptyState
            title="No employees found"
            description="Try changing the filter options or search term."
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 40, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all employees"
                    />
                  </th>
                  <th>Employee</th>
                  <th>Branch</th>
                  <th>Department · Designation</th>
                  <th>Current Supervisor</th>
                  <th>Status</th>
                  <th className="actions-col">Action</th>
                </tr>
              </thead>
              <tbody>
                {displayedEmployees.map((e) => {
                  const empId = e.id || e._id;
                  const isChecked = checkedIds.has(empId);
                  const hasSup = Boolean(e.supervisor);

                  return (
                    <tr key={empId} className={isChecked ? 'row-selected' : ''}>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleCheck(empId)}
                          aria-label={`Select ${e.name}`}
                        />
                      </td>
                      <td data-label="Employee">
                        <strong>{e.employeeCode}</strong> {e.name}
                        {e.teamCount > 0 && (
                          <span style={{ marginLeft: 6, background: '#dbeafe', color: '#1e40af', padding: '1px 6px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600 }}>
                            Team ({e.teamCount})
                          </span>
                        )}
                        <div className="muted small">{e.mobile || '—'}</div>
                      </td>
                      <td data-label="Branch">{branchLabel(e.branch)}</td>
                      <td data-label="Department">
                        {e.department?.name || '—'}
                        <div className="muted small">{e.designation?.name || '—'}</div>
                      </td>
                      <td data-label="Supervisor">
                        {hasSup ? (
                          <div>
                            <span style={{ background: '#f0fdf4', color: '#166534', padding: '2px 8px', borderRadius: 4, fontSize: '0.8rem', fontWeight: 600, border: '1px solid #bbf7d0' }}>
                              {e.supervisor.code || ''} {e.supervisor.name}
                            </span>
                          </div>
                        ) : (
                          <span className="muted small">No supervisor</span>
                        )}
                      </td>
                      <td data-label="Status">
                        <span className={`badge ${e.status === 'active' ? 'green' : 'grey'}`}>
                          {e.status === 'active' ? 'Working' : 'Inactive'}
                        </span>
                      </td>
                      <td data-label="Action" className="actions-col">
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => setSingleAssignEmp(e)}
                          >
                            Assign
                          </button>
                          {hasSup && (
                            <button
                              type="button"
                              className="btn sm danger-outline"
                              onClick={() => {
                                if (window.confirm(`Unassign supervisor from ${e.name} (${e.employeeCode})?`)) {
                                  api.hr.supervisorAssign({ supervisorId: null, employeeIds: [empId] })
                                    .then(() => {
                                      toast.success(`Supervisor removed from ${e.name}`);
                                      employeesLoad.load();
                                    })
                                    .catch((err) => toast.error(err.message));
                                }
                              }}
                            >
                              Unassign
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Single Employee Assign Modal */}
      {singleAssignEmp && (
        <Modal
          open
          title={`Assign Supervisor to ${singleAssignEmp.employeeCode} ${singleAssignEmp.name}`}
          onClose={() => setSingleAssignEmp(null)}
          size="md"
          footer={
            <>
              <button className="btn" onClick={() => setSingleAssignEmp(null)}>Cancel</button>
              <button
                className="btn primary"
                disabled={busy || !assignSupervisorId}
                onClick={() => handleAssign()}
              >
                {busy ? 'Saving…' : 'Save Supervisor'}
              </button>
            </>
          }
        >
          <div style={{ marginBottom: 12 }}>
            <div className="muted small">Employee: <strong>{singleAssignEmp.employeeCode} — {singleAssignEmp.name}</strong></div>
            <div className="muted small">Branch: {branchLabel(singleAssignEmp.branch)} · Designation: {singleAssignEmp.designation?.name || '—'}</div>
            {singleAssignEmp.supervisor && (
              <div className="muted small" style={{ marginTop: 4 }}>
                Current Supervisor: <strong>{singleAssignEmp.supervisor.code} {singleAssignEmp.supervisor.name}</strong>
              </div>
            )}
          </div>

          <div className="form-grid">
            <FormField id="smodal-des" label="Select Designation" hint="Filters the supervisor list">
              <select
                id="smodal-des"
                value={targetDesignationId}
                onChange={(e) => {
                  setTargetDesignationId(e.target.value);
                  setAssignSupervisorId('');
                }}
              >
                <option value="">All Designations</option>
                {designations.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </FormField>

            <FormField id="smodal-sup" label="Select Supervisor" required>
              <select
                id="smodal-sup"
                value={assignSupervisorId}
                onChange={(e) => setAssignSupervisorId(e.target.value)}
              >
                <option value="">Select Supervisor</option>
                {eligibleSupervisors.filter((s) => s.id !== (singleAssignEmp.id || singleAssignEmp._id)).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.employeeCode} — {s.name} ({s.branch?.code || 'HO'})
                  </option>
                ))}
              </select>
            </FormField>
          </div>
        </Modal>
      )}
    </>
  );
}
