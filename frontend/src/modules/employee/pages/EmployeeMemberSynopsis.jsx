import { useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

export default function EmployeeMemberSynopsis() {
  const { t } = useEmployeeApp();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const handleSearch = async (e) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    setData(null);
    try {
      const res = await api.employeeApp.memberSynopsis(query.trim());
      const mem = res?.member || res;
      setData(mem);
    } catch (err) {
      setError(err.message || 'No synopsis found for this query');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="emp-page-container">
      {/* Search Header */}
      <div className="emp-card">
        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 10px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="file" size={20} style={{ color: 'var(--emp-primary)' }} /> {t('borrowerSynopsis')}
        </h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--emp-text-muted)', margin: '0 0 14px 0' }}>
          Comprehensive 360° Borrower Report including profile, KYC badges, loan exposure, and repayment history.
        </p>

        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10 }}>
          <input
            type="text"
            className="emp-input"
            placeholder="Member Code, Phone, or Aadhaar..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="submit" className="emp-btn-primary" style={{ padding: '0 16px' }} disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '12px 14px', borderRadius: 8, fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Member Profile Overview */}
          <div className="emp-card">
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <div
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: '50%',
                  background: 'var(--emp-primary)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.4rem',
                  fontWeight: 700,
                  overflow: 'hidden',
                }}
              >
                {(data.photo || data.memberPhoto) ? (
                  <img src={data.photo || data.memberPhoto} alt={data.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  data.name?.charAt(0) || 'M'
                )}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: 'var(--emp-text)' }}>
                    {data.name}
                  </h3>
                  {data.mobileVerified && (
                    <span className="emp-verified-badge" title="Phone verified">
                      ✓
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                  Code: <strong>{data.code}</strong> • Branch: {data.branchName || (typeof data.branch === 'object' ? (data.branch?.name || data.branch?.code) : data.branch)}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', marginTop: 1 }}>
                  Group: <strong>{data.groupCode ? `${data.groupCode} — ${data.groupName}` : (data.groupName || 'Individual')}</strong> • Joined: {data.createdAt ? new Date(data.createdAt).toLocaleDateString() : 'N/A'}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--emp-primary)', fontWeight: 600, marginTop: 2 }}>
                  CIBIL Score: <strong>{data.civilScore || 740}</strong>
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--emp-border)' }}>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Mobile Number</div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {data.mobile}
                  {data.mobileVerified && <span className="emp-verified-badge" style={{ fontSize: '0.65rem' }}>✓</span>}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Aadhaar Number</div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                  {data.aadhaar ? `•••• •••• ${data.aadhaar.slice(-4)}` : 'N/A'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Husband/Father</div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{data.husbandName || 'N/A'}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Occupation / Gender</div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', textTransform: 'capitalize' }}>
                  {data.occupation || 'N/A'} ({data.gender || 'N/A'})
                </div>
              </div>
            </div>
          </div>

          {/* Address & Bank Details */}
          <div className="emp-card">
            <h4 style={{ fontSize: '0.92rem', fontWeight: 700, margin: '0 0 10px 0', color: 'var(--emp-text)' }}>
              Bank & Guarantor Information
            </h4>
            <div style={{ fontSize: '0.82rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div><strong>Address:</strong> {data.address || ''}, {data.area || ''}, {data.district || ''} - {data.pincode || ''}</div>
              <div><strong>Bank:</strong> {data.bankName || 'N/A'} (A/C: {data.accountNumber || 'N/A'}, IFSC: {data.ifsc || 'N/A'})</div>
              <div><strong>Guarantor:</strong> {data.guarantorName || data.guarantor?.name || 'None'} ({data.guarantorRelation || data.guarantor?.relation || 'N/A'}, Phone: {data.guarantorMobile || data.guarantor?.phone || 'N/A'})</div>
            </div>
          </div>

          {/* Loans Summary */}
          <div className="emp-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h4 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: 'var(--emp-text)' }}>
                Loan Exposure ({data.loans?.length || 0})
              </h4>
              <span className="emp-badge emp-badge-info">Active & Past</span>
            </div>

            {!data.loans || data.loans.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--emp-text-muted)', fontSize: '0.85rem' }}>
                No loan records found for this member.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.loans.map((loan, lIdx) => (
                  <div key={loan.id || loan._id || loan.loanId || lIdx} style={{ border: '1px solid var(--emp-border)', borderRadius: 8, padding: 10, background: 'var(--emp-card-bg)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{loan.loanId || loan.loanAccountNo || loan.kind || 'Microfinance Loan'}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                          Type: {loan.kind || 'Group Loan'} • Mode: {loan.mode || 'Weekly'} • Disbursed: {loan.disbursedOn || loan.disbursedDate || 'Active'}
                        </div>
                      </div>
                      <span className={`emp-badge ${loan.status === 'closed' ? 'emp-badge-info' : 'emp-badge-success'}`}>
                        {loan.status || 'Active'}
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--emp-border)', fontSize: '0.78rem' }}>
                      <div>
                        <span style={{ color: 'var(--emp-text-muted)' }}>Sanctioned / Borrowed:</span>
                        <div style={{ fontWeight: 600 }}>₹{Number(loan.amount || 0).toLocaleString('en-IN')}</div>
                      </div>
                      <div>
                        <span style={{ color: 'var(--emp-text-muted)' }}>Payment Mode:</span>
                        <div style={{ fontWeight: 600 }}>{loan.mode || 'Weekly'}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent EMI Collections */}
          {data.recentEmis && data.recentEmis.length > 0 && (
            <div className="emp-card">
              <h4 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 10px 0', color: 'var(--emp-text)' }}>
                Recent EMI Payments ({data.recentEmis.length})
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.recentEmis.map((e, eIdx) => (
                  <div key={e.receiptNo || eIdx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '8px 10px', borderRadius: 6, fontSize: '0.8rem' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>Rcpt: {e.receiptNo}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>Paid on: {e.paidOn || 'N/A'} • {e.mode}</div>
                    </div>
                    <div style={{ fontWeight: 700, color: '#059669' }}>
                      ₹{Number(e.amount).toLocaleString('en-IN')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

