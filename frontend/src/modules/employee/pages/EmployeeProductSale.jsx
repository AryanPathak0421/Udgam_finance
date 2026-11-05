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
  const [payMode, setPayMode] = useState('cash');

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

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
  const total = prod ? prod.unitPrice * quantity : 0;

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
      setError(err.message || 'Product sale failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="emp-page-container">
      <div className="emp-card">
        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 6px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="product" size={20} style={{ color: 'var(--emp-primary)' }} /> Product Sale &amp; Booking
        </h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', margin: '0 0 14px 0' }}>
          Sell consumer products, electronics, or solar goods from branch stock to members.
        </p>

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
            <div style={{ fontSize: '0.78rem', marginTop: 4 }}>Receipt No: <strong>{result.receiptNo}</strong> • Total Paid: ₹{result.totalAmount}</div>
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
              <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                Select Stock Product *
              </label>
              <select className="emp-input" value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)}>
                {products.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name} — ₹{p.unitPrice} (Stock: {p.stockQty})
                  </option>
                ))}
              </select>
            </div>

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
                  Quantity *
                </label>
                <input
                  type="number"
                  className="emp-input"
                  min="1"
                  max={prod?.stockQty || 10}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--emp-text-muted)', display: 'block', marginBottom: 4 }}>
                Payment Mode
              </label>
              <select className="emp-input" value={payMode} onChange={(e) => setPayMode(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="upi">UPI / QR Code</option>
                <option value="loan_adjust">Add to Loan EMI</option>
              </select>
            </div>

            {/* Total Sale Value Summary */}
            <div style={{ background: 'var(--emp-card-bg)', border: '1px solid var(--emp-border)', borderRadius: 8, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--emp-text-muted)' }}>Total Sale Amount:</span>
              <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#059669' }}>
                ₹{Number(total).toLocaleString('en-IN')}
              </span>
            </div>

            <button
              type="submit"
              className="emp-btn-primary"
              style={{ padding: '12px', fontSize: '0.95rem', fontWeight: 800, marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              disabled={submitting}
            >
              <Icon name="checkcircle" size={16} />
              {submitting ? 'Processing Sale...' : 'Complete Product Sale'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

