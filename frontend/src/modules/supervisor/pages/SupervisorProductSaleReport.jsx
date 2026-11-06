import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorProductSaleReport() {
  const [report, setReport] = useState({ summary: { totalAmount: 0, totalUnits: 0, totalOrders: 0 }, sales: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadSalesReport();
  }, []);

  async function loadSalesReport() {
    setLoading(true);
    setError('');
    try {
      const res = await api.supervisorApp.productSalesReport();
      setReport(res || { summary: {}, sales: [] });
    } catch (err) {
      setError(err.message || 'Failed to load product booking report');
    } finally {
      setLoading(false);
    }
  }

  const { summary, sales } = report;

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Product Booking Report</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>
          Branch-wise Cross-Sell &amp; Product Bookings
        </div>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--sup-danger-light)', color: 'var(--sup-danger)', borderRadius: 10, fontSize: '0.85rem', marginBottom: 14 }}>
          <Icon name="alertcircle" size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* KPI Summary Cards */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <div className="sup-metric-card" style={{ flex: 1, borderLeft: '4px solid var(--sup-success)' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--sup-text-muted)' }}>Total Bookings</span>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--sup-success)', marginTop: 4 }}>
            ₹{(summary.totalAmount || 0).toLocaleString('en-IN')}
          </div>
        </div>
        <div className="sup-metric-card" style={{ flex: 1, borderLeft: '4px solid var(--sup-primary)' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--sup-text-muted)' }}>Units Sold</span>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--sup-primary)', marginTop: 4 }}>
            {summary.totalUnits || 0}
          </div>
        </div>
        <div className="sup-metric-card" style={{ flex: 1, borderLeft: '4px solid var(--sup-accent)' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--sup-text-muted)' }}>Orders</span>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--sup-accent)', marginTop: 4 }}>
            {summary.totalOrders || 0}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
          Loading sales records…
        </div>
      ) : sales.length === 0 ? (
        <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
          No product bookings recorded across your supervised branches
        </div>
      ) : (
        sales.map((s) => (
          <div key={s._id} className="sup-card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <strong style={{ fontSize: '0.95rem' }}>{s.productName || s.product?.name || 'Product Item'}</strong>
                <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>
                  Customer: {s.customerName || s.memberName || 'Customer'} • {s.branch?.name || 'Branch'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <strong style={{ fontSize: '1rem', color: 'var(--sup-success)' }}>
                  ₹{(s.totalAmount || 0).toLocaleString('en-IN')}
                </strong>
                <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>
                  Qty: {s.quantity || 1}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>
              <span>Sold by: <strong>{s.soldByCode || s.employeeCode || 'Staff'}</strong></span>
              <span>{s.createdAt ? new Date(s.createdAt).toLocaleDateString() : ''}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

