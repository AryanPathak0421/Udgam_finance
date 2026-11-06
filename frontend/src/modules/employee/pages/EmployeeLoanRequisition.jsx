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

  // Groups for Group Loan
  const [groups, setGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);

  // Search Member
  const [memberQuery, setMemberQuery] = useState('');
  const [memberLoading, setMemberLoading] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);

  // Schemes & Branches & Products
  const [branches, setBranches] = useState([]);
  const [schemes, setSchemes] = useState([]);
  const [stockProducts, setStockProducts] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [selectedScheme, setSelectedScheme] = useState('');

  // Form Fields
  const [form, setForm] = useState({
    amount: '30000',
    mode: 'weekly',
    term: '52',
    rate: '24',
    purpose: 'Business / Income Generation',
    // 25% Extra Product on Group Loan (Software matching)
    hasExtraProduct: false,
    extraProduct: '',
    extraProductName: '',
    extraUnitPrice: 0,
    extraQty: '1',
    // Business specific (software aligned)
    businessName: '',
    civilScore: '740',
    custNumber: '',
    vintageYears: '2',
    monthlyTurnover: '50000',
    shopAddress: '',
    shopPhoto1: '',
    shopPhoto2: '',
    staffWithShopPhoto: '',
    bankStatement: '',
    bankStatementName: '',
    itr: '',
    itrName: '',
    agreement: '',
    agreementName: '',
    udyamCertificate: '',
    udyamCertificateName: '',
    // Product specific
    productName: '',
    productId: '',
    productPrice: 0,
    productQty: '1',
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Requisitions List
  const [requisitions, setRequisitions] = useState([]);
  const [listLoading, setListLoading] = useState(false);

  // Load branches, schemes, stock products, and staff groups
  useEffect(() => {
    api.branches.options()
      .then((res) => {
        setBranches(res.branches || []);
        if (res.branches && res.branches.length > 0) {
          setSelectedBranch(res.branches[0].id);
        }
      })
      .catch(() => {});

    // Load active loan schemes
    const loadSchemes = async () => {
      try {
        let list = [];
        if (api.employeeApp?.loanSchemes) {
          const res = await api.employeeApp.loanSchemes().catch(() => null);
          if (res?.items?.length) list = res.items;
        }
        if (!list.length && api.loanSchemes?.options) {
          const res = await api.loanSchemes.options().catch(() => null);
          if (res?.items?.length) list = res.items;
        }
        setSchemes(list);
        if (list.length > 0) {
          const s = list[0];
          setSelectedScheme(s.id || s._id);
          const sMode = (Array.isArray(s.modes) && s.modes[0]?.value) || s.modes?.[0] || 'weekly';
          const sTerm = s.termMax || s.termMin || (sMode === 'weekly' ? 52 : 12);
          const sRate = s.roiMin != null ? s.roiMin : (s.roiMax != null ? s.roiMax : 24);
          setForm((f) => ({
            ...f,
            amount: String(s.amountMin || 30000),
            rate: String(sRate),
            mode: sMode,
            term: String(sTerm),
          }));
        }
      } catch (e) {
        setSchemes([]);
      }
    };
    loadSchemes();

    // Load branch stock products (e.g. 32-inch TV, Solar, etc.)
    const loadProducts = async () => {
      try {
        let list = [];
        if (api.employeeApp?.stockProducts) {
          const res = await api.employeeApp.stockProducts().catch(() => null);
          if (res?.items?.length) list = res.items;
        }
        setStockProducts(list);
      } catch (e) {
        setStockProducts([]);
      }
    };
    loadProducts();

    setLoadingGroups(true);
    api.employeeApp.groups()
      .then((res) => {
        setGroups(res.groups || []);
        if (res.groups && res.groups.length > 0) {
          setSelectedGroup(res.groups[0]);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingGroups(false));
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
      const m = res.member || res;
      setSelectedMember({
        id: m.id || m._id,
        code: m.code,
        name: m.name,
        mobile: m.mobile,
        mobileVerified: m.isMobileVerified || m.mobileVerified,
        branchName: m.branch?.name || m.branchName,
        groupName: m.groupName,
        civilScore: m.civilScore || 740,
      });
      setForm((f) => ({
        ...f,
        civilScore: String(m.civilScore || 740),
        custNumber: m.code || '',
      }));
    } catch (err) {
      setError(err.message || 'Member not found');
    } finally {
      setMemberLoading(false);
    }
  };

  const handleSchemeChange = (schemeId) => {
    setSelectedScheme(schemeId);
    const s = schemes.find((x) => (x.id || x._id) === schemeId);
    if (s) {
      const sMode = (Array.isArray(s.modes) && s.modes[0]?.value) || s.modes?.[0] || form.mode || 'weekly';
      const sTerm = s.termMax || s.termMin || (sMode === 'weekly' ? 52 : 12);
      const sRate = s.roiMin != null ? s.roiMin : (s.roiMax != null ? s.roiMax : 24);
      setForm((f) => ({
        ...f,
        amount: String(s.amountMin || f.amount || 30000),
        rate: String(sRate),
        mode: sMode,
        term: String(sTerm),
      }));
    }
  };

  const handleProductChange = (prodId) => {
    const p = stockProducts.find((x) => (x.id || x._id || x.code) === prodId);
    if (p) {
      const qty = Number(form.productQty) || 1;
      setForm((f) => ({
        ...f,
        productId: p.id || p.code,
        productName: p.name,
        productPrice: p.unitPrice,
        amount: String(p.unitPrice * qty),
      }));
    } else {
      setForm((f) => ({ ...f, productId: '', productName: prodId }));
    }
  };

  const handleExtraProductChange = (prodId) => {
    const p = stockProducts.find((x) => (x.id || x._id || x.code) === prodId);
    if (p) {
      setForm((f) => ({
        ...f,
        extraProduct: p.id || p.code,
        extraProductName: p.name,
        extraUnitPrice: p.unitPrice,
      }));
    } else {
      setForm((f) => ({ ...f, extraProduct: '', extraProductName: '', extraUnitPrice: 0 }));
    }
  };

  const handleFile = (key, nameKey) => async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const b64 = await compressImage(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.8 });
      setForm((f) => ({
        ...f,
        [key]: b64,
        ...(nameKey ? { [nameKey]: file.name } : {}),
      }));
    } catch (err) {
      alert('Failed to process file');
    }
  };

  const extraProductTotal = (form.extraUnitPrice || 0) * (Number(form.extraQty) || 1);
  const extraProductMaxAllowed = Math.floor((Number(form.amount) || 0) * 0.25);
  const extraProductExceeds = form.hasExtraProduct && extraProductTotal > extraProductMaxAllowed;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedMember) return setError('Please select or search a borrower member first');
    if (!form.amount || Number(form.amount) <= 0) return setError('Please enter a valid loan amount');
    if (extraProductExceeds) {
      return setError(`Extra product value (₹${extraProductTotal}) cannot exceed 25% of loan amount (Max: ₹${extraProductMaxAllowed})`);
    }

    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const payload = {
        memberId: selectedMember.id || selectedMember._id,
        borrowerName: selectedMember.name,
        borrowerCode: selectedMember.code,
        borrowerMobile: selectedMember.mobile,
        loanType,
        kind: loanType === 'business_msme' ? 'business' : loanType,
        groupCode: selectedGroup?.code,
        groupName: selectedGroup?.name,
        branch: selectedBranch,
        schemeId: selectedScheme,
        schemeName: schemes.find((s) => (s.id || s._id) === selectedScheme)?.name || 'Standard Loan Scheme',
        amount: Number(form.amount),
        mode: form.mode,
        term: Number(form.term),
        rate: Number(form.rate),
        purpose: form.purpose,
        // 25% Extra Product
        extraProduct: form.hasExtraProduct ? form.extraProduct : '',
        extraProductName: form.hasExtraProduct ? form.extraProductName : '',
        extraQty: form.hasExtraProduct ? Number(form.extraQty) || 1 : 0,
        extraUnitPrice: form.hasExtraProduct ? form.extraUnitPrice : 0,
        // Business / MSME specific
        businessName: form.businessName,
        civilScore: Number(form.civilScore) || 740,
        custNumber: form.custNumber,
        businessType: form.businessType,
        vintageYears: Number(form.vintageYears || 1),
        monthlyTurnover: Number(form.monthlyTurnover || 0),
        shopAddress: form.shopAddress,
        shopPhoto1: form.shopPhoto1,
        shopPhoto2: form.shopPhoto2,
        staffWithShopPhoto: form.staffWithShopPhoto,
        bankStatement: form.bankStatement,
        itr: form.itr,
        agreement: form.agreement,
        udyamCertificate: form.udyamCertificate,
        // Product specific
        productId: form.productId,
        productName: form.productName,
        productPrice: form.productPrice,
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

          {/* Step 1: Member / Group Selection */}
          <div className="emp-card">
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 10px 0', color: 'var(--emp-text)' }}>
              1. Select Borrower Member
            </h3>

            {/* When Group Loan is selected, show Group Selector and its Members */}
            {loanType === 'group' && (
              <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--emp-border)' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  Assigned Group *
                </label>
                {loadingGroups ? (
                  <div style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)' }}>Loading your groups...</div>
                ) : groups.length === 0 ? (
                  <div style={{ fontSize: '0.8rem', color: '#991b1b', background: '#fee2e2', padding: 8, borderRadius: 6 }}>
                    No groups assigned to your staff code.
                  </div>
                ) : (
                  <select
                    className="emp-input"
                    value={selectedGroup?.code || ''}
                    onChange={(e) => {
                      const g = groups.find((x) => x.code === e.target.value);
                      setSelectedGroup(g);
                    }}
                  >
                    {groups.map((g) => (
                      <option key={g.code} value={g.code}>
                        {g.code} — {g.name} ({g.membersCount || 0} members)
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Member Search input */}
            <div>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                Search Borrower Member by Code / Phone / ID *
              </label>
              <form onSubmit={handleSearchMember} style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  className="emp-input"
                  placeholder="e.g. M001001 or 9876543210..."
                  value={memberQuery}
                  onChange={(e) => setMemberQuery(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button type="submit" className="emp-btn-primary" style={{ padding: '0 16px' }} disabled={memberLoading}>
                  {memberLoading ? '...' : 'Search'}
                </button>
              </form>
            </div>

            {/* Selected Member Preview Card */}
            {selectedMember && (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 12, marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong style={{ fontSize: '0.95rem', color: '#166534' }}>{selectedMember.name}</strong>
                    <div style={{ fontSize: '0.78rem', color: '#15803d', marginTop: 2 }}>
                      Code: {selectedMember.code} • Mobile: +91 {selectedMember.mobile}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#166534', marginTop: 2 }}>
                      Group: {selectedMember.groupName || 'Individual'} • CIBIL: <strong>{selectedMember.civilScore || 740}</strong>
                    </div>
                  </div>
                  <span className="emp-verified-badge">✓ Selected</span>
                </div>
              </div>
            )}
          </div>

          {/* Step 2: Loan Terms & Scheme Form */}
          {selectedMember && (
            <form onSubmit={handleSubmit}>
              <div className="emp-card">
                <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 12px 0', color: 'var(--emp-text)' }}>
                  2. Loan Parameters & Scheme
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
                      <option value="">-- Select Active Scheme --</option>
                      {schemes.map((s) => (
                        <option key={s.id || s._id} value={s.id || s._id}>
                          {s.name} ({s.code ? `${s.code} • ` : ''}{s.roiMin ?? s.roiMax ?? 24}%, {s.calculationType || 'Flat'})
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
                        Interest Rate (% p.a.) *
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
                        Repayment Mode *
                      </label>
                      <select className="emp-input" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="daily">Daily</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                        Term ({form.mode === 'weekly' ? 'Weeks' : form.mode === 'daily' ? 'Days' : 'Months'}) *
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
                      placeholder="e.g. Livestock, Grocery store inventory, Working capital"
                      value={form.purpose}
                      onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {/* 25% Extra Product on Group Loan (Software matching) */}
              {loanType === 'group' && (
                <div className="emp-card" style={{ background: '#fdf4ff', border: '1px solid #f0abfc' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: '#86198f', display: 'flex', alignItems: 'center', gap: 6 }}>
                      📦 Optional Cross-Sell Product (Up to 25%)
                    </h3>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={form.hasExtraProduct}
                        onChange={(e) => setForm({ ...form, hasExtraProduct: e.target.checked })}
                      />
                      Add Product
                    </label>
                  </div>
                  <p style={{ fontSize: '0.78rem', color: '#a21caf', margin: '0 0 10px 0' }}>
                    Max 25% of loan amount allowed: <strong>₹{extraProductMaxAllowed.toLocaleString('en-IN')}</strong>
                  </p>

                  {form.hasExtraProduct && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 8, borderTop: '1px dashed #e879f9' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                        <div>
                          <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                            Select Product from Catalog *
                          </label>
                          <select
                            className="emp-input"
                            value={form.extraProduct}
                            onChange={(e) => handleExtraProductChange(e.target.value)}
                          >
                            <option value="">-- Choose Product --</option>
                            {stockProducts.map((p) => (
                              <option key={p.id || p.code} value={p.id || p.code}>
                                {p.name} (₹{p.unitPrice})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                            Qty
                          </label>
                          <input
                            type="number"
                            className="emp-input"
                            value={form.extraQty}
                            min="1"
                            onChange={(e) => setForm({ ...form, extraQty: e.target.value })}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', padding: '6px 10px', background: '#fae8ff', borderRadius: 6 }}>
                        <span>Extra Product Total: <strong>₹{extraProductTotal.toLocaleString('en-IN')}</strong></span>
                        <span style={{ color: extraProductExceeds ? '#dc2626' : '#16a34a', fontWeight: 700 }}>
                          {extraProductExceeds ? '⚠️ Exceeds 25% limit!' : '✓ Within 25% limit'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Business / MSME Loan Specific Section (Software Aligned) */}
              {loanType === 'business_msme' && (
                <div className="emp-card">
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 12px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="building" size={18} style={{ color: 'var(--emp-primary)' }} />
                    <span>Business / MSME Verification (Software Aligned)</span>
                  </h3>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                        1) Business Name *
                      </label>
                      <input
                        type="text"
                        className="emp-input"
                        placeholder="e.g. Sharma Kirana & General Store"
                        value={form.businessName}
                        onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                        required
                      />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div>
                        <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                          2) CIBIL Score (Auto) *
                        </label>
                        <input
                          type="text"
                          className="emp-input"
                          value={form.civilScore}
                          readOnly
                          style={{ background: '#f8fafc', fontWeight: 700 }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                          3) Customer / Udgam / GST No.
                        </label>
                        <input
                          type="text"
                          className="emp-input"
                          placeholder="Cust / GST / Udgam ID"
                          value={form.custNumber}
                          onChange={(e) => setForm({ ...form, custNumber: e.target.value })}
                        />
                      </div>
                    </div>

                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                        Shop Address
                      </label>
                      <input
                        type="text"
                        className="emp-input"
                        placeholder="Shop / Work location address"
                        value={form.shopAddress}
                        onChange={(e) => setForm({ ...form, shopAddress: e.target.value })}
                      />
                    </div>

                    {/* 4) Shop Photos (1, 2, 3 Staff + Shop) */}
                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 6 }}>
                        4) Shop Photos (3 Photos: Shop 1, Shop 2, Staff + Shop) *
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                        <div style={{ border: '1px dashed var(--emp-border)', padding: 8, borderRadius: 6, textAlign: 'center' }}>
                          <span style={{ fontSize: '0.72rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Shop Photo 1</span>
                          <input type="file" accept="image/*" onChange={handleFile('shopPhoto1')} style={{ fontSize: '0.7rem', width: '100%' }} />
                          {form.shopPhoto1 && <img src={form.shopPhoto1} alt="shop1" style={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 4, marginTop: 4 }} />}
                        </div>
                        <div style={{ border: '1px dashed var(--emp-border)', padding: 8, borderRadius: 6, textAlign: 'center' }}>
                          <span style={{ fontSize: '0.72rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Shop Photo 2</span>
                          <input type="file" accept="image/*" onChange={handleFile('shopPhoto2')} style={{ fontSize: '0.7rem', width: '100%' }} />
                          {form.shopPhoto2 && <img src={form.shopPhoto2} alt="shop2" style={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 4, marginTop: 4 }} />}
                        </div>
                        <div style={{ border: '1px dashed var(--emp-border)', padding: 8, borderRadius: 6, textAlign: 'center' }}>
                          <span style={{ fontSize: '0.72rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Staff + Shop</span>
                          <input type="file" accept="image/*" onChange={handleFile('staffWithShopPhoto')} style={{ fontSize: '0.7rem', width: '100%' }} />
                          {form.staffWithShopPhoto && <img src={form.staffWithShopPhoto} alt="staff shop" style={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 4, marginTop: 4 }} />}
                        </div>
                      </div>
                    </div>

                    {/* 5, 6, 7: Bank Statement, ITR, Agreement / Udyam */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                          5) Bank Statement
                        </label>
                        <input type="file" accept="image/*,.pdf" onChange={handleFile('bankStatement', 'bankStatementName')} style={{ fontSize: '0.75rem', width: '100%' }} />
                        {form.bankStatementName && <span style={{ fontSize: '0.7rem', color: '#16a34a' }}>✓ {form.bankStatementName}</span>}
                      </div>
                      <div>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                          6) ITR Document
                        </label>
                        <input type="file" accept="image/*,.pdf" onChange={handleFile('itr', 'itrName')} style={{ fontSize: '0.75rem', width: '100%' }} />
                        {form.itrName && <span style={{ fontSize: '0.7rem', color: '#16a34a' }}>✓ {form.itrName}</span>}
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                          7) Shop Business Agreement
                        </label>
                        <input type="file" accept="image/*,.pdf" onChange={handleFile('agreement', 'agreementName')} style={{ fontSize: '0.75rem', width: '100%' }} />
                        {form.agreementName && <span style={{ fontSize: '0.7rem', color: '#16a34a' }}>✓ {form.agreementName}</span>}
                      </div>
                      <div>
                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                          Udyam Certificate
                        </label>
                        <input type="file" accept="image/*,.pdf" onChange={handleFile('udyamCertificate', 'udyamCertificateName')} style={{ fontSize: '0.75rem', width: '100%' }} />
                        {form.udyamCertificateName && <span style={{ fontSize: '0.7rem', color: '#16a34a' }}>✓ {form.udyamCertificateName}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Product Loan Specific Section */}
              {loanType === 'product' && (
                <div className="emp-card">
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 12px 0', color: 'var(--emp-text)' }}>
                    📦 Product Item Details (Catalog Dropdown)
                  </h3>

                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                        Product Name (Dropdown e.g. 32-inch TV) *
                      </label>
                      <select
                        className="emp-input"
                        value={form.productId || form.productName}
                        onChange={(e) => handleProductChange(e.target.value)}
                        required
                      >
                        <option value="">-- Select Product (e.g. 32-inch TV) --</option>
                        {stockProducts.map((p) => (
                          <option key={p.id || p.code} value={p.id || p.code}>
                            {p.name} (₹{p.unitPrice})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                        Quantity
                      </label>
                      <input
                        type="number"
                        className="emp-input"
                        value={form.productQty}
                        onChange={(e) => {
                          const q = e.target.value;
                          setForm((f) => ({
                            ...f,
                            productQty: q,
                            amount: f.productPrice ? String(f.productPrice * (Number(q) || 1)) : f.amount,
                          }));
                        }}
                        min="1"
                      />
                    </div>
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="emp-btn-primary"
                style={{ width: '100%', padding: '14px 0', fontSize: '1rem', fontWeight: 700, margin: '6px 0 20px 0' }}
                disabled={submitting}
              >
                {submitting ? 'Submitting Requisition...' : 'Submit Loan Requisition'}
              </button>
            </form>
          )}
        </>
      )}

      {/* Requisitions List Tab */}
      {activeTab === 'list' && (
        <div className="emp-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--emp-text)' }}>
              My Recent Requisitions ({requisitions.length})
            </h3>
            <button
              type="button"
              className="emp-btn-secondary"
              style={{ padding: '4px 10px', fontSize: '0.75rem' }}
              onClick={fetchRequisitions}
              disabled={listLoading}
            >
              {listLoading ? '...' : 'Refresh'}
            </button>
          </div>

          {listLoading ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--emp-text-muted)' }}>
              Loading requisitions...
            </div>
          ) : requisitions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--emp-text-muted)' }}>
              No loan requisitions created yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {requisitions.map((r) => (
                <div
                  key={r.id || r._id}
                  style={{
                    border: '1px solid var(--emp-border)',
                    borderRadius: 8,
                    padding: 12,
                    background: 'var(--emp-card-bg)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <strong style={{ fontSize: '0.92rem', color: 'var(--emp-text)' }}>{r.borrowerName}</strong>
                      <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                        Form: <strong>{r.formId}</strong> • Type: <span style={{ textTransform: 'capitalize' }}>{r.loanType}</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                        {r.schemeName} • {r.mode} ({r.term} installments)
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--emp-primary)' }}>
                        ₹{Number(r.amount).toLocaleString('en-IN')}
                      </div>
                      <div style={{ marginTop: 4 }}>
                        {r.status === 'approved' ? (
                          <span className="emp-badge emp-badge-success" style={{ fontSize: '0.7rem' }}>Approved</span>
                        ) : r.status === 'rejected' ? (
                          <span className="emp-badge emp-badge-danger" style={{ fontSize: '0.7rem' }}>Rejected</span>
                        ) : (
                          <span className="emp-badge emp-badge-warning" style={{ fontSize: '0.7rem' }}>Pending</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
