import { useEffect, useState, useRef } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

export default function EmployeeProductSale() {
  const { t } = useEmployeeApp();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selectedProduct, setSelectedProduct] = useState('');
  const [quantity, setQuantity] = useState(1);
  const payMode = 'upi'; // Strictly QR payment only (Point 19)

  // Item 21: Sell Mode Options (Company Member Sell vs Direct Unknown Customer Sell)
  const [sellType, setSellType] = useState('company_member'); // 'company_member' | 'direct_customer'

  // Member sell state
  const [memberCode, setMemberCode] = useState('');
  const [memberName, setMemberName] = useState('');
  const [memberMobile, setMemberMobile] = useState('');
  const [memberBranch, setMemberBranch] = useState('');
  const [lookingUpMember, setLookingUpMember] = useState(false);
  const [memberLookupError, setMemberLookupError] = useState('');

  // Direct Customer sell state
  const [customerName, setCustomerName] = useState('');
  const [customerMobile, setCustomerMobile] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');

  // QR Payment & Confirmation Modal (Item 21 Fix)
  const [showQrModal, setShowQrModal] = useState(false);
  const [utrNumber, setUtrNumber] = useState('');
  const [qrData, setQrData] = useState(null);
  const [loadingQr, setLoadingQr] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const lookupTimeoutRef = useRef(null);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const res = await api.employeeApp.stockProducts();
      setProducts(res.items || []);
      if (res.items && res.items.length > 0) {
        setSelectedProduct(res.items[0].code);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const prod = products.find((p) => p.code === selectedProduct);
  const availableStock = prod?.stockQty || 0;
  const isOutOfStock = availableStock <= 0;
  const total = prod ? prod.unitPrice * quantity : 0;

  // Auto-fetch Member Name & Details on Member Code change
  useEffect(() => {
    if (sellType !== 'company_member') return;
    const cleanCode = memberCode.trim().toUpperCase();
    if (!cleanCode || cleanCode.length < 3) {
      setMemberName('');
      setMemberMobile('');
      setMemberBranch('');
      setMemberLookupError('');
      return;
    }

    if (lookupTimeoutRef.current) clearTimeout(lookupTimeoutRef.current);

    lookupTimeoutRef.current = setTimeout(async () => {
      setLookingUpMember(true);
      setMemberLookupError('');
      try {
        const res = await api.employeeApp.memberSynopsis(cleanCode);
        if (res?.member) {
          setMemberName(res.member.name || '');
          setMemberMobile(res.member.mobile || '');
          setMemberBranch(res.member.branchName || res.member.branch?.name || '');
          setMemberLookupError('');
        } else {
          setMemberName('');
          setMemberLookupError(`Member not found with code "${cleanCode}"`);
        }
      } catch (err) {
        setMemberName('');
        setMemberLookupError(err.message || `Member not found with code "${cleanCode}"`);
      } finally {
        setLookingUpMember(false);
      }
    }, 400);

    return () => {
      if (lookupTimeoutRef.current) clearTimeout(lookupTimeoutRef.current);
    };
  }, [memberCode, sellType]);

  // Load company QR for the booking amount
  useEffect(() => {
    if (total > 0) {
      setLoadingQr(true);
      api.employeeApp.companyQr({ amount: total })
        .then((r) => setQrData(r))
        .catch(() => setQrData(null))
        .finally(() => setLoadingQr(false));
    }
  }, [total]);

  // Step 1: Open Payment QR Modal before booking completes (Item 21 Fix)
  const handleOpenQrModal = (e) => {
    e.preventDefault();
    setError('');

    if (!prod) return setError('Please select a product');
    if (isOutOfStock) return setError('Selected product is out of stock');

    if (sellType === 'company_member') {
      if (!memberCode.trim()) return setError('Please enter Member Code');
      if (!memberName) return setError('Please enter a valid existing Member Code to verify member name');
    } else {
      if (!customerName.trim()) return setError('Please enter Customer Name for Direct Sell');
      if (!customerMobile.trim()) return setError('Please enter Customer Mobile Number for Direct Sell');
    }

    setShowQrModal(true);
  };

  // Step 2: Finalize booking after scanning QR & collecting payment
  const handleConfirmBooking = async () => {
    setSubmitting(true);
    setError('');
    setResult(null);

    try {
      const res = await api.employeeApp.sellStockProduct({
        sellType,
        memberCode: sellType === 'company_member' ? memberCode.trim().toUpperCase() : 'DIRECT',
        customerName: sellType === 'direct_customer' ? customerName.trim() : memberName,
        customerMobile: sellType === 'direct_customer' ? customerMobile.trim() : memberMobile,
        customerAddress: customerAddress.trim(),
        productCode: selectedProduct,
        quantity: Number(quantity),
        payMode,
        utrNumber: utrNumber.trim(),
      });

      setResult(res);
      setShowQrModal(false);
      setMemberCode('');
      setMemberName('');
      setCustomerName('');
      setCustomerMobile('');
      setCustomerAddress('');
      setUtrNumber('');
      setQuantity(1);
      fetchProducts();
    } catch (err) {
      setError(err.message || 'Product booking failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="emp-page-container">
      <div className="emp-card">
        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 6px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="product" size={20} style={{ color: 'var(--emp-primary)' }} /> Product Booking
        </h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', margin: '0 0 10px 0' }}>
          Book consumer products, electronics, or appliances from branch stock with Company UPI QR payment.
        </p>

        {/* Note on Actual Sales vs Booking (Item 11) */}
        <div style={{ background: '#f8fafc', border: '1px solid var(--emp-border)', borderRadius: 8, padding: '8px 12px', fontSize: '0.75rem', color: 'var(--emp-text-muted)', marginBottom: 12 }}>
          ℹ️ <strong>Note on Target:</strong> Booked products are submitted for BM verification &amp; delivery. Once delivered/approved, they count towards your monthly <strong>Actual Product Sales Target</strong>.
        </div>

        {error && (
          <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 12 }}>
            {error}
          </div>
        )}

        {result && (
          <div style={{ background: '#dcfce7', color: '#166534', padding: '14px', borderRadius: 8, fontSize: '0.88rem', marginBottom: 14 }}>
            <div style={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="checkcircle" size={16} /> {result.message}
            </div>
            <div style={{ fontSize: '0.78rem', marginTop: 4 }}>
              Booking ID: <strong>{result.receiptNo}</strong> • Buyer: <strong>{result.memberName}</strong> • Total Paid: ₹{result.totalAmount}
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '20px', color: 'var(--emp-text-muted)' }}>Loading branch products...</div>
        ) : products.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px', color: 'var(--emp-text-muted)' }}>
            No stock products currently available in branch inventory.
          </div>
        ) : (
          <form onSubmit={handleOpenQrModal} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Item 21 Fix: 2 Clear Sell Mode Options */}
            <div>
              <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 6 }}>
                Select Sell Type *
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => { setSellType('company_member'); setError(''); }}
                  style={{
                    padding: '10px 8px',
                    borderRadius: 8,
                    border: sellType === 'company_member' ? '2px solid var(--emp-primary)' : '1px solid var(--emp-border)',
                    background: sellType === 'company_member' ? 'rgba(5, 150, 105, 0.08)' : 'var(--emp-card-bg)',
                    color: sellType === 'company_member' ? 'var(--emp-primary)' : 'var(--emp-text)',
                    fontWeight: 700,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 3,
                  }}
                >
                  <span>🏢 Company Member Sell</span>
                  <span style={{ fontSize: '0.68rem', fontWeight: 500, color: 'var(--emp-text-muted)' }}>Requires Member Code</span>
                </button>

                <button
                  type="button"
                  onClick={() => { setSellType('direct_customer'); setError(''); }}
                  style={{
                    padding: '10px 8px',
                    borderRadius: 8,
                    border: sellType === 'direct_customer' ? '2px solid var(--emp-primary)' : '1px solid var(--emp-border)',
                    background: sellType === 'direct_customer' ? 'rgba(5, 150, 105, 0.08)' : 'var(--emp-card-bg)',
                    color: sellType === 'direct_customer' ? 'var(--emp-primary)' : 'var(--emp-text)',
                    fontWeight: 700,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 3,
                  }}
                >
                  <span>👤 Direct Unknown Customer</span>
                  <span style={{ fontSize: '0.68rem', fontWeight: 500, color: 'var(--emp-text-muted)' }}>Member Code NOT required</span>
                </button>
              </div>
            </div>

            {/* Product Selection */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--emp-text-muted)' }}>
                  Select Stock Product *
                </label>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: isOutOfStock ? '#dc2626' : '#059669' }}>
                  {isOutOfStock ? '⚠️ Out of Stock' : `✓ Available Stock: ${availableStock} pcs`}
                </span>
              </div>
              <select className="emp-input" value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)}>
                {products.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name} — ₹{p.unitPrice} ({p.stockQty > 0 ? `Stock: ${p.stockQty} pcs` : 'Out of Stock'})
                  </option>
                ))}
              </select>
            </div>

            {isOutOfStock && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '10px 12px', borderRadius: 8, fontSize: '0.82rem', color: '#991b1b', fontWeight: 600 }}>
                ⚠️ This product currently has 0 available stock in branch inventory and cannot be booked.
              </div>
            )}

            {/* Buyer Details Fields based on Sell Type */}
            {sellType === 'company_member' ? (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      Member Code * {lookingUpMember && <span style={{ color: 'var(--emp-primary)', fontSize: '0.72rem' }}>Verifying...</span>}
                    </label>
                    <input
                      type="text"
                      className="emp-input"
                      placeholder="e.g. MEM00123"
                      value={memberCode}
                      onChange={(e) => setMemberCode(e.target.value.toUpperCase())}
                      required
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      Quantity *
                    </label>
                    <input
                      type="number"
                      className="emp-input"
                      min="1"
                      max={Math.max(1, availableStock)}
                      disabled={isOutOfStock}
                      value={quantity}
                      onChange={(e) => setQuantity(Math.min(availableStock || 1, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                      required
                    />
                  </div>
                </div>

                {/* Auto-Fetched Member Name Card (Item 21 Fix) */}
                {memberName ? (
                  <div style={{ marginTop: 8, background: '#f0fdf4', border: '1px solid #86efac', padding: '10px 12px', borderRadius: 8, fontSize: '0.82rem' }}>
                    <div style={{ fontWeight: 800, color: '#166534', fontSize: '0.92rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>✓ Member: {memberName}</span>
                    </div>
                    <div style={{ fontSize: '0.74rem', color: '#15803d', marginTop: 2 }}>
                      Mobile: <strong>{memberMobile || 'N/A'}</strong> • Branch: <strong>{memberBranch || 'Main'}</strong>
                    </div>
                  </div>
                ) : memberLookupError ? (
                  <div style={{ marginTop: 6, fontSize: '0.75rem', color: '#dc2626', fontWeight: 600 }}>
                    ⚠️ {memberLookupError}
                  </div>
                ) : (
                  <div style={{ marginTop: 4, fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>
                    Enter member code to automatically load and display Member Name.
                  </div>
                )}
              </div>
            ) : (
              /* Direct Unknown Customer Sell Form (No Member Code Required) */
              <div>
                <div style={{ background: '#fefce8', border: '1px solid #fef08a', padding: '8px 10px', borderRadius: 6, fontSize: '0.74rem', color: '#854d0e', marginBottom: 10 }}>
                  💡 <strong>Direct Sell:</strong> Member code is not required. Enter walk-in / unknown customer details directly.
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      Customer Name *
                    </label>
                    <input
                      type="text"
                      className="emp-input"
                      placeholder="Full Name"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      Mobile Number *
                    </label>
                    <input
                      type="tel"
                      maxLength="10"
                      className="emp-input"
                      placeholder="10-digit mobile"
                      value={customerMobile}
                      onChange={(e) => setCustomerMobile(e.target.value.replace(/\D/g, ''))}
                      required
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      Address / Village (Optional)
                    </label>
                    <input
                      type="text"
                      className="emp-input"
                      placeholder="Village, Landmark or City"
                      value={customerAddress}
                      onChange={(e) => setCustomerAddress(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                      Quantity *
                    </label>
                    <input
                      type="number"
                      className="emp-input"
                      min="1"
                      max={Math.max(1, availableStock)}
                      disabled={isOutOfStock}
                      value={quantity}
                      onChange={(e) => setQuantity(Math.min(availableStock || 1, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                      required
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Total Booking Value Card */}
            <div style={{ background: '#f8fafc', border: '1px solid var(--emp-border)', borderRadius: 8, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--emp-text-muted)' }}>Total Booking Amount:</span>
                <span style={{ fontSize: '1.35rem', fontWeight: 800, color: '#059669' }}>
                  ₹{Number(total).toLocaleString('en-IN')}
                </span>
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)', marginTop: 4 }}>
                Payment Method: <strong>Company Dynamic QR Code</strong> (Mandatory payment scan before submission)
              </div>
            </div>

            {/* Trigger Button: Opens Company QR Modal (Item 21 Fix) */}
            <button
              type="submit"
              className="emp-btn-primary"
              style={{ padding: '13px', fontSize: '0.95rem', fontWeight: 800, marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              disabled={submitting || isOutOfStock || availableStock < quantity || (sellType === 'company_member' && !memberName)}
            >
              <Icon name="qr" size={18} />
              {isOutOfStock ? 'Cannot Book — Out of Stock' : `Open Company QR Code & Collect ₹${total}`}
            </button>
          </form>
        )}
      </div>

      {/* Item 21 Fix: Company QR Code Payment Modal */}
      {showQrModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              maxWidth: 420,
              width: '100%',
              padding: '20px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderBottom: '1px solid #e2e8f0', paddingBottom: 8 }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0, color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="qr" size={18} style={{ color: 'var(--emp-primary)' }} />
                Company UPI QR Payment
              </h3>
              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                style={{ background: 'transparent', border: 'none', fontSize: '1.3rem', color: '#64748b', cursor: 'pointer', lineHeight: 1 }}
              >
                ✕
              </button>
            </div>

            {/* Order Details in Modal */}
            <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: 8, fontSize: '0.8rem', marginBottom: 12, border: '1px solid var(--emp-border)' }}>
              <div>Product: <strong>{prod?.name}</strong> (Qty: {quantity})</div>
              <div style={{ marginTop: 2 }}>
                Buyer: <strong>{sellType === 'direct_customer' ? customerName : memberName}</strong>
                {sellType === 'direct_customer' && ` (${customerMobile})`}
              </div>
              <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px dashed #cbd5e1', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Payable Amount:</span>
                <span style={{ fontSize: '1.15rem', fontWeight: 800, color: '#059669' }}>₹{total}</span>
              </div>
            </div>

            {/* QR Code Container */}
            <div style={{ textAlign: 'center', margin: '14px 0' }}>
              {loadingQr ? (
                <div style={{ padding: '30px', color: 'var(--emp-text-muted)', fontSize: '0.85rem' }}>
                  Generating official Company QR Code...
                </div>
              ) : qrData?.qrCode ? (
                <div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--emp-text)', marginBottom: 8 }}>
                    {qrData.companyName || 'UDGAM URBAN & GRAMIN MICROFINANCE'}
                  </div>
                  <img
                    src={qrData.qrCode}
                    alt="Company Payment QR"
                    style={{ width: 190, height: 190, borderRadius: 10, border: '2px solid #059669', padding: 4 }}
                  />
                  <div style={{ fontSize: '0.74rem', color: 'var(--emp-text-muted)', marginTop: 6 }}>
                    UPI ID: <strong style={{ color: 'var(--emp-text)' }}>{qrData.upiId || 'company@upi'}</strong>
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#059669', fontWeight: 700, marginTop: 2 }}>
                    ✓ Scan with GPay, PhonePe, Paytm, or BHIM
                  </div>
                </div>
              ) : (
                <div style={{ padding: '20px', color: '#dc2626', fontSize: '0.82rem' }}>
                  Unable to load QR Code. Please check internet connection or company bank setup.
                </div>
              )}
            </div>

            {/* UTR / Reference Input */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                UPI Reference / UTR Number (Optional)
              </label>
              <input
                type="text"
                className="emp-input"
                placeholder="e.g. 12-digit UTR / UPI Ref"
                value={utrNumber}
                onChange={(e) => setUtrNumber(e.target.value)}
              />
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                className="emp-btn-secondary"
                style={{ padding: '10px', fontSize: '0.85rem', fontWeight: 700 }}
                disabled={submitting}
              >
                Back / Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmBooking}
                className="emp-btn-primary"
                style={{ padding: '10px', fontSize: '0.85rem', fontWeight: 800 }}
                disabled={submitting}
              >
                {submitting ? 'Confirming...' : 'Payment Done ✓'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
