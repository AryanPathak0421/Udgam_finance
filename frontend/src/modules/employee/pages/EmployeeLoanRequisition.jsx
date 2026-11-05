import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import { compressImage } from '../../../utils/image.js';
import Icon from '../../../components/Icon.jsx';

const LOAN_TYPES = [
  { id: 'group', label: 'Group Loan', desc: 'Joint liability microfinance loan for SHG members', icon: 'group' },
  { id: 'personal', label: 'Personal Loan', desc: 'Direct unsecured loan for individual borrowers', icon: 'customer' },
  { id: 'business_msme', label: 'Business / MSME', desc: 'Micro & small enterprise financing with shop verification', icon: 'building' },
  { id: 'product', label: 'Product Loan', desc: 'Consumer durables, solar, or equipment financing', icon: 'product' },
];

export default function EmployeeLoanRequisition() {
  const { t } = useEmployeeApp();
  const [activeTab, setActiveTab] = useState('new'); // 'new' | 'list'
  const [loanType, setLoanType] = useState('group');

  // Search Member
  const [memberQuery, setMemberQuery] = useState('');
  const [memberLoading, setMemberLoading] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);

  // Schemes & Branches
  const [branches, setBranches] = useState([]);
  const [schemes, setSchemes] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [selectedScheme, setSelectedScheme] = useState('');

  // Form Fields
  const [form, setForm] = useState({
    amount: '30000',
    mode: 'monthly',
    term: '12',
    rate: '18',
    purpose: '',
    // Business specific
    businessName: '',
    businessType: '',
    shopPhoto: '',
    staffWithShopPhoto: '',
    // Product specific
    productName: '',
    productQty: '1',
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Requisitions List
  const [requisitions, setRequisitions] = useState([]);
  const [listLoading, setListLoading] = useState(false);

  // Load branches & schemes
  useEffect(() => {
    api.branches.options()
      .then((res) => {
        setBranches(res.branches || []);
        if (res.branches && res.branches.length > 0) {
          setSelectedBranch(res.branches[0].id);
        }
      })
      .catch(() => {});

    api.loanSchemes.options()
      .then((res) => {
        setSchemes(res.items || []);
        if (res.items && res.items.length > 0) {
          const s = res.items[0];
          setSelectedScheme(s.id);
          setForm((f) => ({
            ...f,
            amount: String(s.amountMin || 30000),
            rate: String(s.roiMin || 18),
            mode: s.modes?.[0]?.value || 'monthly',
          }));
        }
      })
      .catch(() => {});
  }, []);

  const fetchRequisitions = async () => {
    setListLoading(true);
    try {
      const data = await api.employeeApp.requisitions();
      setRequisitions(data.items || []);
    } catch (err) {
      console.error(err);
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'list') {
      fetchRequisitions();
    }
  }, [activeTab]);

  const handleSearchMember = async (e) => {
    e?.preventDefault();
    if (!memberQuery.trim()) return;
    setMemberLoading(true);
    setError('');
    setSelectedMember(null);
    try {
      const res = await api.employeeApp.memberSynopsis(memberQuery.trim());
      setSelectedMember(res);
    } catch (err) {
      setError(err.message || 'Member not found');
    } finally {
      setMemberLoading(false);
    }
  };

  const handleSchemeChange = (schemeId) => {
    setSelectedScheme(schemeId);
    const s = schemes.find((x) => x.id === schemeId);
    if (s) {
      setForm((f) => ({
        ...f,
        amount: String(s.amountMin || f.amount),
        rate: String(s.roiMin || f.rate),
        mode: s.modes?.[0]?.value || f.mode,
      }));
    }
  };

  const handleFile = (key) => async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const b64 = await compressImage(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.8 });
      setForm((f) => ({ ...f, [key]: b64 }));
    } catch (err) {
      alert('Failed to process image');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedMember) return setError('Please search and select a member first');
    if (!form.amount || Number(form.amount) <= 0) return setError('Please enter a valid loan amount');

    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const payload = {
        memberId: selectedMember.id || selectedMember._id,
        loanType,
        branch: selectedBranch,
        schemeId: selectedScheme,
        amount: Number(form.amount),
        mode: form.mode,
        term: Number(form.term),
        rate: Number(form.rate),
        purpose: form.purpose,
        businessName: form.businessName,
        businessType: form.businessType,
        shopPhoto: form.shopPhoto,
        staffWithShopPhoto: form.staffWithShopPhoto,
        productName: form.productName,
        productQty: Number(form.productQty || 1),
      };

      await api.employeeApp.createRequisition(payload);
      setSuccess('Loan requisition submitted successfully! Waiting for Branch Manager sanction.');
      setSelectedMember(null);
      setMemberQuery('');
    } catch (err) {
      setError(err.message || 'Failed to submit loan requisition');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="emp-page-container">
      {/* Top Tab Switcher */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button
          type="button"
          className={activeTab === 'new' ? 'emp-btn-primary' : 'emp-btn-secondary'}
          style={{ flex: 1, padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 700 }}
          onClick={() => setActiveTab('new')}
        >
          <Icon name="userplus" size={16} />
          <span>New Requisition</span>
        </button>
        <button
          type="button"
          className={activeTab === 'list' ? 'emp-btn-primary' : 'emp-btn-secondary'}
          style={{ flex: 1, padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 700 }}
          onClick={() => setActiveTab('list')}
        >
          <Icon name="file" size={16} />
          <span>Recent Requisitions</span>
        </button>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '12px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 14 }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ background: '#dcfce7', color: '#166534', padding: '12px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 14 }}>
          {success}
        </div>
      )}

      {activeTab === 'new' && (
        <>
          {/* Loan Category Selector */}
          <div className="emp-card" style={{ padding: '12px 14px' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 8 }}>
              Select Loan Type:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {LOAN_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setLoanType(t.id)}
                  style={{
                    padding: '10px 8px',
                    borderRadius: 8,
                    textAlign: 'left',
                    cursor: 'pointer',
                    border: loanType === t.id ? '2px solid var(--emp-primary)' : '1px solid var(--emp-border)',
                    background: loanType === t.id ? 'rgba(37, 99, 235, 0.08)' : 'var(--emp-card-bg)',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: loanType === t.id ? 'var(--emp-primary)' : 'var(--emp-text)' }}>
                    {t.label}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--emp-text-muted)', marginTop: 2, lineHeight: 1.2 }}>
                    {t.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Member Search Card */}
          <div className="emp-card">
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 10px 0', color: 'var(--emp-text)' }}>
              1. Select Borrower Member
            </h3>

            {!selectedMember ? (
              <form onSubmit={handleSearchMember} style={{ display: 'flex', gap: 10 }}>
                <input
                  type="text"
                  className="emp-input"
                  placeholder="Enter Member Code, Phone, or Aadhaar..."
                  value={memberQuery}
                  onChange={(e) => setMemberQuery(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button type="submit" className="emp-btn-primary" style={{ padding: '0 16px' }} disabled={memberLoading}>
                  {memberLoading ? '...' : 'Search'}
                </button>
              </form>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--emp-card-bg)', border: '1px solid var(--emp-border)', padding: 12, borderRadius: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {selectedMember.name}
                    {selectedMember.mobileVerified && <span className="emp-verified-badge">✓</span>}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                    Code: <strong>{selectedMember.code}</strong> • Mobile: {selectedMember.mobile}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 1 }}>
                    Branch: {selectedMember.branchName || selectedMember.branch} • Group: {selectedMember.groupName || 'Individual'}
                  </div>
                </div>
                <button
                  type="button"
                  className="emp-btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '0.75rem' }}
                  onClick={() => setSelectedMember(null)}
                >
                  Change
                </button>
              </div>
            )}
          </div>

          {/* Loan Configuration Form */}
          {selectedMember && (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="emp-card">
                <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 12px 0', color: 'var(--emp-text)' }}>
                  2. Loan Terms & Details
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      Loan Scheme *
                    </label>
                    <select
                      className="emp-input"
                      value={selectedScheme}
                      onChange={(e) => handleSchemeChange(e.target.value)}
                      required
                    >
                      {schemes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.calculationType}, {s.roiMin}%)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                        Loan Amount (₹) *
                      </label>
                      <input
                        type="number"
                        className="emp-input"
                        value={form.amount}
                        onChange={(e) => setForm({ ...form, amount: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                        Interest Rate (% p.a.)
                      </label>
                      <input
                        type="number"
                        className="emp-input"
                        value={form.rate}
                        onChange={(e) => setForm({ ...form, rate: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                        Repayment Mode
                      </label>
                      <select className="emp-input" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="daily">Daily</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                        Term ({form.mode === 'weekly' ? 'Weeks' : form.mode === 'daily' ? 'Days' : 'Months'})
                      </label>
                      <input
                        type="number"
                        className="emp-input"
                        value={form.term}
                        onChange={(e) => setForm({ ...form, term: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      Loan Purpose
                    </label>
                    <input
                      type="text"
                      className="emp-input"
                      placeholder="e.g. Livestock, Grocery store inventory, Sewing machine"
                      value={form.purpose}
                      onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {/* Conditional: Business / MSME Loan Specific Section */}
              {loanType === 'business_msme' && (
                <div className="emp-card">
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 12px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="building" size={18} style={{ color: 'var(--emp-primary)' }} />
                    <span>Business &amp; Shop Verification</span>
                  </h3>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                        Business / Enterprise Name *
                      </label>
                      <input
                        type="text"
                        className="emp-input"
                        placeholder="e.g. Sharma Kirana Store"
                        value={form.businessName}
                        onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                        required
                      />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                          Shop / Work Photo
                        </label>
                        <input type="file" accept="image/*" onChange={handleFile('shopPhoto')} style={{ fontSize: '0.8rem', width: '100%' }} />
                        {form.shopPhoto && <img src={form.shopPhoto} alt="shop" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, marginTop: 4 }} />}
                      </div>
                      <div>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                          Staff with Shop Photo
                        </label>
                        <input type="file" accept="image/*" onChange={handleFile('staffWithShopPhoto')} style={{ fontSize: '0.8rem', width: '100%' }} />
                        {form.staffWithShopPhoto && <img src={form.staffWithShopPhoto} alt="staff shop" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 6, marginTop: 4 }} />}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Conditional: Product Loan Specific Section */}
              {loanType === 'product' && (
                <div className="emp-card">
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 12px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="product" size={18} style={{ color: 'var(--emp-primary)' }} /> Product Item Details
                  </h3>

                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                        Product Name / Model
                      </label>
                      <input
                        type="text"
                        className="emp-input"
                        placeholder="e.g. Solar Home Light 50W"
                        value={form.productName}
                        onChange={(e) => setForm({ ...form, productName: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                        Quantity
                      </label>
                      <input
                        type="number"
                        className="emp-input"
                        value={form.productQty}
                        onChange={(e) => setForm({ ...form, productQty: e.target.value })}
                        min="1"
                      />
                    </div>
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="emp-btn-primary"
                style={{ padding: '14px', fontSize: '1rem', fontWeight: 700, margin: '4px 0 24px 0' }}
                disabled={submitting}
              >
                {submitting ? 'Submitting Requisition...' : 'Submit Requisition for Approval'}
              </button>
            </form>
          )}
        </>
      )}

      {activeTab === 'list' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {listLoading ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--emp-text-muted)' }}>
              Loading requisitions...
            </div>
          ) : requisitions.length === 0 ? (
            <div className="emp-card" style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--emp-text-muted)' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: '50%', background: 'rgba(16, 120, 112, 0.08)', color: 'var(--emp-primary)', margin: '0 auto 12px' }}>
                <Icon name="inbox" size={30} />
              </div>
              <div style={{ fontWeight: 600 }}>No loan requisitions found</div>
            </div>
          ) : (
            requisitions.map((r) => (
              <div key={r.id || r._id} className="emp-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{r.memberName}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                      Code: {r.memberCode} • Type: <strong style={{ textTransform: 'capitalize' }}>{r.loanType?.replace(/_/g, ' ')}</strong>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                      Req Date: {new Date(r.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--emp-primary)' }}>
                      ₹{Number(r.amount || 0).toLocaleString('en-IN')}
                    </div>
                    <span
                      className={`emp-badge ${
                        r.status === 'approved' ? 'emp-badge-success' : r.status === 'rejected' ? 'emp-badge-danger' : 'emp-badge-warning'
                      }`}
                      style={{ marginTop: 4 }}
                    >
                      {r.status || 'Pending'}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

