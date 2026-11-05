import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

export default function EmployeeReports() {
  const { t } = useEmployeeApp();
  const [tab, setTab] = useState('disbursements'); // 'disbursements' | 'requisitions' | 'approvals' | 'npa' | 'targets'
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [reportData, setReportData] = useState(null);
  const [error, setError] = useState('');

  const fetchReports = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.employeeApp.employeeReports({ dateFrom, dateTo });
      setReportData(res);
    } catch (err) {
      setError(err.message || 'Failed to fetch employee reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [dateFrom, dateTo]);

  const summary = reportData?.summary || {};

  return (
    <div className="emp-page-container">
      {/* Header & Date Filter Card */}
      <div className="emp-card">
        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 8px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="chart" size={20} style={{ color: 'var(--emp-primary)' }} /> My Performance &amp; Reports
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 2 }}>From Date:</label>
            <input type="date" className="emp-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ padding: '6px' }} />
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 2 }}>To Date:</label>
            <input type="date" className="emp-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ padding: '6px' }} />
          </div>
        </div>
      </div>

      {/* KPI Overview Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 12 }}>
        <div className="emp-card" style={{ margin: 0, padding: 12, background: 'linear-gradient(135deg, #1e40af, #3b82f6)', color: '#fff' }}>
          <div style={{ fontSize: '0.72rem', opacity: 0.9 }}>My Disbursements</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, marginTop: 2 }}>
            ₹{Number(summary.totalDisbursed || 0).toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: '0.7rem', opacity: 0.85, marginTop: 2 }}>
            {summary.disbursementCount || 0} Loans Disbursed
          </div>
        </div>

        <div className="emp-card" style={{ margin: 0, padding: 12, background: 'linear-gradient(135deg, #065f46, #10b981)', color: '#fff' }}>
          <div style={{ fontSize: '0.72rem', opacity: 0.9 }}>NPA Recovered</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, marginTop: 2 }}>
            ₹{Number(summary.totalNpaRecovered || 0).toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: '0.7rem', opacity: 0.85, marginTop: 2 }}>
            {summary.npaRecoveryCount || 0} Recoveries
          </div>
        </div>

        <div className="emp-card" style={{ margin: 0, padding: 12, border: '1px solid var(--emp-border)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Requisitions</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--emp-text)', marginTop: 2 }}>
            {summary.requisitionCount || 0}
          </div>
          <div style={{ fontSize: '0.7rem', color: '#059669', marginTop: 2 }}>
            {summary.approvalCount || 0} Approved
          </div>
        </div>

        <div className="emp-card" style={{ margin: 0, padding: 12, border: '1px solid var(--emp-border)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Target Status</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--emp-primary)', marginTop: 2 }}>
            Active
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
            View Target Tab
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', overflowX: 'auto', gap: 6, marginBottom: 12, paddingBottom: 4 }}>
        {[
          { id: 'disbursements', label: 'Disbursements' },
          { id: 'requisitions', label: 'Requisitions' },
          { id: 'approvals', label: 'Approvals' },
          { id: 'npa', label: 'NPA Recovery' },
          { id: 'targets', label: 'Targets' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              padding: '6px 12px',
              borderRadius: 20,
              fontSize: '0.78rem',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              border: tab === t.id ? '2px solid var(--emp-primary)' : '1px solid var(--emp-border)',
              background: tab === t.id ? 'var(--emp-primary)' : 'var(--emp-card-bg)',
              color: tab === t.id ? '#fff' : 'var(--emp-text)',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px', color: 'var(--emp-text-muted)' }}>Loading reports...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Tab 1: Disbursements */}
          {tab === 'disbursements' && (
            reportData.disbursements?.length === 0 ? (
              <div className="emp-card" style={{ textAlign: 'center', padding: '24px', color: 'var(--emp-text-muted)' }}>
                No disbursements under your code for this period.
              </div>
            ) : (
              reportData.disbursements.map((d, i) => (
                <div key={i} className="emp-card" style={{ margin: 0, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '0.92rem' }}>{d.borrower}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)' }}>
                        Loan: <strong>{d.loanId}</strong> • Date: {d.date} • {d.mode}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 800, color: 'var(--emp-primary)' }}>₹{d.amount.toLocaleString('en-IN')}</div>
                      <span className="emp-badge emp-badge-success" style={{ fontSize: '0.68rem' }}>Disbursed</span>
                    </div>
                  </div>
                </div>
              ))
            )
          )}

          {/* Tab 2: Requisitions */}
          {tab === 'requisitions' && (
            reportData.requisitions?.length === 0 ? (
              <div className="emp-card" style={{ textAlign: 'center', padding: '24px', color: 'var(--emp-text-muted)' }}>
                No loan requisitions created in this period.
              </div>
            ) : (
              reportData.requisitions.map((r, i) => (
                <div key={i} className="emp-card" style={{ margin: 0, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '0.92rem' }}>{r.borrower}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)' }}>
                        Form: {r.formId} • Date: {r.date}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 800 }}>₹{r.amount.toLocaleString('en-IN')}</div>
                      <span className={`emp-badge ${r.status === 'approved' ? 'emp-badge-success' : 'emp-badge-warning'}`} style={{ fontSize: '0.68rem' }}>
                        {r.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )
          )}

          {/* Tab 3: Approvals */}
          {tab === 'approvals' && (
            reportData.approvals?.length === 0 ? (
              <div className="emp-card" style={{ textAlign: 'center', padding: '24px', color: 'var(--emp-text-muted)' }}>
                No approved requisitions found.
              </div>
            ) : (
              reportData.approvals.map((a, i) => (
                <div key={i} className="emp-card" style={{ margin: 0, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '0.92rem' }}>{a.borrower}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)' }}>Form: {a.formId}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 800, color: '#059669' }}>₹{a.amount.toLocaleString('en-IN')}</div>
                      <span className="emp-badge emp-badge-success" style={{ fontSize: '0.68rem', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <Icon name="checkcircle" size={10} /> Approved
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )
          )}

          {/* Tab 4: NPA Recovery */}
          {tab === 'npa' && (
            reportData.npaRecovery?.length === 0 ? (
              <div className="emp-card" style={{ textAlign: 'center', padding: '24px', color: 'var(--emp-text-muted)' }}>
                No NPA recovery payments logged in this period.
              </div>
            ) : (
              reportData.npaRecovery.map((p, i) => (
                <div key={i} className="emp-card" style={{ margin: 0, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '0.92rem' }}>{p.member}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)' }}>
                        Rcpt: {p.receiptNo} • Date: {p.date} • Mode: {p.payMode}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 800, color: '#059669' }}>+₹{p.amount.toLocaleString('en-IN')}</div>
                      <span className="emp-badge emp-badge-danger" style={{ fontSize: '0.68rem' }}>NPA Recovered</span>
                    </div>
                  </div>
                </div>
              ))
            )
          )}

          {/* Tab 5: Targets Show */}
          {tab === 'targets' && (
            reportData.targets?.length === 0 ? (
              <div className="emp-card" style={{ textAlign: 'center', padding: '24px', color: 'var(--emp-text-muted)' }}>
                No active targets assigned.
              </div>
            ) : (
              reportData.targets.map((t) => (
                <div key={t.id} className="emp-card">
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 800, margin: '0 0 10px 0' }}>
                    Period: {new Date(t.fromDate).toLocaleDateString()} — {new Date(t.toDate).toLocaleDateString()}
                  </h4>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 2 }}>
                        <span>Disbursement Target (D6):</span>
                        <strong>₹{t.achieved?.d6 || 0} / ₹{t.targets?.d6 || 0}</strong>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: 'var(--emp-border)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(100, Math.round(((t.achieved?.d6 || 0) / (t.targets?.d6 || 1)) * 100))}%`, background: 'var(--emp-primary)' }} />
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 2 }}>
                        <span>NPA Recovery Target:</span>
                        <strong>₹{t.achieved?.npaRecovery || 0} / ₹{t.targets?.npaRecoveryPaise ? t.targets.npaRecoveryPaise / 100 : 0}</strong>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: 'var(--emp-border)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: '40%', background: '#059669' }} />
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )
          )}
        </div>
      )}
    </div>
  );
}

