import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorProductSaleReport() {
  const [report, setReport] = useState({
    summary: {
      actualSoldAmount: 0,
      actualSoldUnits: 0,
      actualSoldOrders: 0,
      totalAmount: 0,
      totalUnits: 0,
      totalOrders: 0,
      pendingOrders: 0,
    },
    sales: [],
  });
  const [filter, setFilter] = useState('all'); // 'all' | 'sold' | 'pending'
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
      setError(err.message || 'Failed to load product sell report');
    } finally {
      setLoading(false);
    }
  }

  const { summary = {}, sales = [] } = report;

  const filteredSales = sales.filter((s) => {
    if (filter === 'sold') return s.status === 'completed' || s.status === 'approved';
    if (filter === 'pending') return s.status === 'pending' || !s.status;
    return true;
  });

  return (
    <div className="sup-page-container">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>Actual Product Sell Report</h2>
        <div style={{ fontSize: '0.8rem', color: 'var(--sup-text-muted)' }}>
          Branch-wise Cross-Sell &amp; Actual Product Deliveries
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
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--sup-text-muted)' }}>Actual Sell</span>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--sup-success)', marginTop: 4 }}>
            ₹{(summary.actualSoldAmount ?? summary.totalAmount ?? 0).toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--sup-text-muted)', marginTop: 2 }}>
            Delivered / Completed
          </div>
        </div>
        <div className="sup-metric-card" style={{ flex: 1, borderLeft: '4px solid var(--sup-primary)' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--sup-text-muted)' }}>Units Sold</span>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--sup-primary)', marginTop: 4 }}>
            {summary.actualSoldUnits ?? summary.totalUnits ?? 0}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--sup-text-muted)', marginTop: 2 }}>
            Total Qty Sold
          </div>
        </div>
        <div className="sup-metric-card" style={{ flex: 1, borderLeft: '4px solid var(--sup-accent)' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--sup-text-muted)' }}>Orders</span>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--sup-accent)', marginTop: 4 }}>
            {summary.actualSoldOrders ?? summary.totalOrders ?? 0}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--sup-text-muted)', marginTop: 2 }}>
            Total {summary.totalOrders || 0} Booked
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', background: 'var(--sup-border)', borderRadius: 10, padding: 3, marginBottom: 14 }}>
        <button
          type="button"
          style={{
            flex: 1,
            padding: '7px 0',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.8rem',
            background: filter === 'all' ? 'var(--sup-card-bg)' : 'transparent',
            color: filter === 'all' ? 'var(--sup-primary)' : 'var(--sup-text-muted)',
            cursor: 'pointer',
          }}
          onClick={() => setFilter('all')}
        >
          All ({sales.length})
        </button>
        <button
          type="button"
          style={{
            flex: 1,
            padding: '7px 0',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.8rem',
            background: filter === 'sold' ? 'var(--sup-card-bg)' : 'transparent',
            color: filter === 'sold' ? 'var(--sup-success)' : 'var(--sup-text-muted)',
            cursor: 'pointer',
          }}
          onClick={() => setFilter('sold')}
        >
          Actual Sold ({summary.actualSoldOrders || 0})
        </button>
        <button
          type="button"
          style={{
            flex: 1,
            padding: '7px 0',
            border: 'none',
            borderRadius: 8,
            fontWeight: 700,
            fontSize: '0.8rem',
            background: filter === 'pending' ? 'var(--sup-card-bg)' : 'transparent',
            color: filter === 'pending' ? 'var(--sup-warning)' : 'var(--sup-text-muted)',
            cursor: 'pointer',
          }}
          onClick={() => setFilter('pending')}
        >
          Bookings ({summary.pendingOrders || 0})
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--sup-text-muted)' }}>
          Loading actual product sales records…
        </div>
      ) : filteredSales.length === 0 ? (
        <div className="sup-card" style={{ textAlign: 'center', padding: '24px 0', color: 'var(--sup-text-muted)' }}>
          No product sales recorded matching this filter
        </div>
      ) : (
        filteredSales.map((s) => {
          const isSold = s.status === 'completed' || s.status === 'approved';
          return (
            <div key={s._id} className="sup-card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <strong style={{ fontSize: '0.95rem' }}>{s.productName || s.product?.name || 'Product Item'}</strong>
                  <div style={{ fontSize: '0.75rem', color: 'var(--sup-text-muted)' }}>
                    Customer: {s.customerName || s.memberName || 'Customer'} • {s.branch?.name || 'Branch'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <strong style={{ fontSize: '1rem', color: isSold ? 'var(--sup-success)' : 'var(--sup-primary)' }}>
                    ₹{(s.totalAmount || 0).toLocaleString('en-IN')}
                  </strong>
                  <div style={{ fontSize: '0.72rem', color: 'var(--sup-text-muted)' }}>
                    Qty: {s.quantity || 1}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, fontSize: '0.75rem' }}>
                <span style={{ color: 'var(--sup-text-muted)' }}>
                  Sold by: <strong>{s.soldByCode || s.employeeCode || 'Staff'}</strong>
                </span>
                <span
                  style={{
                    background: isSold ? 'var(--sup-success-light)' : 'var(--sup-warning-light)',
                    color: isSold ? 'var(--sup-success)' : 'var(--sup-warning)',
                    padding: '2px 8px',
                    borderRadius: 10,
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                >
                  {isSold ? 'Sold / Delivered' : (s.status || 'Booking Pending')}
                </span>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--sup-text-muted)', marginTop: 4, textAlign: 'right' }}>
                {s.createdAt ? new Date(s.createdAt).toLocaleDateString() : ''}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

