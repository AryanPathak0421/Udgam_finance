import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

export default function EmployeeProductSale() {
  const { t } = useEmployeeApp();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selectedProduct, setSelectedProduct] = useState('');
  const [memberCode, setMemberCode] = useState('');
  const [quantity, setQuantity] = useState(1);
  const payMode = 'upi'; // Strictly QR payment only (Point 19)

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [qrData, setQrData] = useState(null);
  const [loadingQr, setLoadingQr] = useState(false);

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!memberCode.trim()) return setError('Please enter member code');
    if (!prod) return setError('Please select a product');

    setSubmitting(true);
    setError('');
    setResult(null);
    try {
      const res = await api.employeeApp.sellStockProduct({
        memberCode: memberCode.trim(),
        productCode: selectedProduct,
        quantity: Number(quantity),
        payMode,
      });
      setResult(res);
      setMemberCode('');
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
          Book consumer products, electronics, or solar goods from branch stock for members.
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
            <div style={{ fontSize: '0.78rem', marginTop: 4 }}>Booking ID: <strong>{result.receiptNo}</strong> • Total Amount: ₹{result.totalAmount}</div>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '20px', color: 'var(--emp-text-muted)' }}>Loading branch products...</div>
        ) : products.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px', color: 'var(--emp-text-muted)' }}>
            No stock products currently available in branch inventory.
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                  Member / Customer Code *
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
                  Quantity * (Max: {availableStock})
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

            {/* Locked Payment Mode: strictly QR Payment */}
            <div>
              <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                Payment Mode (Locked)
              </label>
              <div style={{ padding: '10px 12px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e40af', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="qr" size={16} /> Company Dynamic QR Code Only
                </span>
                <span style={{ fontSize: '0.72rem', background: '#dbeafe', color: '#1d4ed8', padding: '2px 8px', borderRadius: 12, fontWeight: 700 }}>Strict Rule</span>
              </div>
            </div>

            {/* Total Booking Value Summary & QR Display */}
            <div style={{ background: 'var(--emp-card-bg)', border: '1px solid var(--emp-border)', borderRadius: 8, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: qrData?.qrCode ? 10 : 0 }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--emp-text-muted)' }}>Total Booking Amount:</span>
                <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#059669' }}>
                  ₹{Number(total).toLocaleString('en-IN')}
                </span>
              </div>

              {/* Dynamic QR Preview */}
              {loadingQr ? (
                <div style={{ textAlign: 'center', padding: '10px', fontSize: '0.8rem', color: 'var(--emp-text-muted)' }}>Generating Company QR Code...</div>
              ) : qrData?.qrCode && !isOutOfStock && total > 0 ? (
                <div style={{ textAlign: 'center', paddingTop: 10, borderTop: '1px solid var(--emp-border)' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--emp-text)', marginBottom: 6 }}>
                    Scan & Pay via Company UPI QR ({qrData.companyName || 'Company Bank A/C'})
                  </div>
                  <img src={qrData.qrCode} alt="Company Payment QR" style={{ width: 170, height: 170, borderRadius: 8, border: '1px solid #cbd5e1' }} />
                  <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)', marginTop: 4 }}>
                    UPI ID: <strong>{qrData.upiId || 'company@upi'}</strong> • Exact Amount: ₹{total}
                  </div>
                </div>
              ) : null}
            </div>

            <button
              type="submit"
              className="emp-btn-primary"
              style={{ padding: '12px', fontSize: '0.95rem', fontWeight: 800, marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              disabled={submitting || isOutOfStock || availableStock < quantity}
            >
              <Icon name="checkcircle" size={16} />
              {submitting ? 'Processing Booking...' : isOutOfStock ? 'Cannot Book — Out of Stock' : `Pay via QR & Book Product (${quantity} pcs)`}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

