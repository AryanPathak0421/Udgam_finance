import { useEffect, useState } from 'react';
import Modal from './ui/Modal.jsx';
import { Spinner } from './ui/Feedback.jsx';
import { api } from '../api/client.js';

export default function CompanyQrModal({ open, onClose, amount, loanId, memberName, branch }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');
    api.emi
      .companyQr({
        amount: Number(amount) > 0 ? amount : 500,
        loanId: loanId || 'LOAN-EMI',
        memberName: memberName || 'Borrower EMI',
        branch: branch || undefined,
      })
      .then((res) => {
        setData(res);
      })
      .catch((err) => {
        setError(err.message || 'Failed to generate company QR code');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open, amount, loanId, memberName, branch]);

  if (!open) return null;

  return (
    <Modal
      open
      title="Company UPI QR Code"
      onClose={onClose}
      size="md"
      footer={<button className="btn primary" onClick={onClose}>Done</button>}
    >
      {loading ? (
        <Spinner label="Loading company QR code…" />
      ) : error ? (
        <div className="notice danger">{error}</div>
      ) : data ? (
        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0 0 4px', color: 'var(--text-color, #111)' }}>
            Scan & Pay via Company UPI
          </h3>
          <p className="muted small" style={{ margin: '0 0 14px' }}>
            Pay directly to <strong>{data.companyName}</strong> official bank account
          </p>

          <div
            style={{
              display: 'inline-block',
              padding: 12,
              background: '#fff',
              borderRadius: 12,
              border: '2px solid var(--border-color, #e2e8f0)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
              margin: '0 auto 12px',
            }}
          >
            <img
              src={data.qrImageUrl}
              alt="Company UPI QR"
              style={{ width: 220, height: 220, display: 'block', margin: '0 auto' }}
            />
          </div>

          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#059669', marginBottom: 4 }}>
            ₹{Number(data.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted, #64748b)', marginBottom: 12 }}>
            UPI ID: <strong style={{ color: 'var(--text-color, #111)' }}>{data.upiId}</strong>
            {data.bankName && <span> · Bank: <strong>{data.bankName}</strong></span>}
          </div>

          <div
            style={{
              background: '#fef3c7',
              padding: '10px 14px',
              borderRadius: 8,
              fontSize: '0.78rem',
              color: '#92400e',
              textAlign: 'left',
              lineHeight: 1.5,
            }}
          >
            <strong>Supported UPI Apps:</strong> PhonePe, Google Pay, Paytm, BHIM, Amazon Pay, or any bank UPI app.
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
