import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

/**
 * The QR of the EMIs of the members the staff chose (one Razorpay QR for their total). It asks the server every few seconds whether it is paid; when it is, the
 * server has made every member's EMI as an online payment, and the result is shown member by member. `onDone` is told once the EMIs are made (the list is
 * refreshed behind), `onClose` closes the window.
 */
export default function OnlineEmiQrModal({ qr, onClose, onDone }) {
  const [state, setState] = useState({ paid: false, done: false, items: [], paymentId: '', status: 'created', error: '' });

  useEffect(() => {
    if (!qr?.linkId) return undefined;
    let stop = false;
    let timer;
    const tick = async () => {
      try {
        const r = await api.employeeApp.onlineEmiQrStatus(qr.linkId);
        if (stop) return;
        setState({ paid: !!r.paid, done: !!r.done, items: r.items || [], paymentId: r.paymentId || '', status: r.status, error: '' });
        if (r.done) { if (onDone) onDone(r); return; }
        if (r.status === 'expired' || r.status === 'cancelled') return;
      } catch (err) {
        if (!stop) setState((s) => ({ ...s, error: err.message || 'Could not check the payment' }));
      }
      timer = setTimeout(tick, 3000);
    };
    timer = setTimeout(tick, 3000);
    return () => { stop = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qr?.linkId]);

  const expired = state.status === 'expired' || state.status === 'cancelled';
  const rows = state.done ? state.items : (qr.members || []).map((m) => ({ ...m, status: 'waiting' }));

  return (
    <div className="emp-modal-overlay" onClick={state.paid && !state.done ? undefined : onClose}>
      <div className="emp-modal-sheet" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center', maxHeight: '92vh', overflowY: 'auto' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 800, margin: '0 0 4px', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Icon name="qrcode" size={20} style={{ color: 'var(--emp-primary)' }} />
          <span>{state.done ? 'Payment received' : 'Scan & pay online'}</span>
        </h3>

        {!state.paid && (
          <>
            <p style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', margin: '0 0 10px' }}>
              One QR for {qr.members.length} member{qr.members.length === 1 ? '' : 's'}. When it is paid the EMIs are saved by themselves.
            </p>
            <div style={{ display: 'inline-block', padding: 10, background: '#fff', borderRadius: 12, border: '2px solid var(--emp-border)' }}>
              <img src={qr.qrImageUrl} alt="Payment QR" style={{ width: 220, height: 220, display: 'block' }} />
            </div>
          </>
        )}

        <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#059669', margin: '8px 0 2px' }}>{inr(qr.amount)}</div>

        <div style={{ margin: '4px 0 10px', padding: '8px 12px', borderRadius: 8, fontSize: '0.82rem', fontWeight: 700, background: state.done ? '#dcfce7' : expired ? '#fee2e2' : state.paid ? '#fef9c3' : '#eff6ff', color: state.done ? '#166534' : expired ? '#991b1b' : state.paid ? '#854d0e' : '#1e40af' }}>
          {state.done ? `✓ Paid online${state.paymentId ? ` — ${state.paymentId}` : ''}` : expired ? 'This QR has expired. Close it and make it again.' : state.paid ? 'Payment received, saving the EMIs…' : 'Waiting for the payment… (any UPI app)'}
        </div>
        {qr.testMode && <div style={{ fontSize: '0.68rem', color: '#92400e', marginBottom: 6 }}>Test mode — no real money</div>}
        {state.error && !state.paid && <div style={{ fontSize: '0.72rem', color: '#b91c1c', marginBottom: 6 }}>{state.error}</div>}

        <div style={{ textAlign: 'left', margin: '6px 0 10px', border: '1px solid var(--emp-border)', borderRadius: 8 }}>
          {rows.map((m) => (
            <div key={m.memberCode} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '7px 10px', borderTop: '1px solid var(--emp-border)', fontSize: '0.8rem' }}>
              <span style={{ minWidth: 0 }}><strong>{m.memberName}</strong><span style={{ color: 'var(--emp-text-muted)' }}> · {m.memberCode}</span>
                {m.status === 'pending' && <div style={{ fontSize: '0.7rem', color: '#c2410c' }}>Paid online · waiting for the approval</div>}
                {m.status === 'failed' && <div style={{ fontSize: '0.7rem', color: '#b91c1c' }}>{m.note}</div>}
              </span>
              <span style={{ fontWeight: 700, whiteSpace: 'nowrap', color: m.status === 'posted' ? '#166534' : 'inherit' }}>
                {inr(m.amount)}{m.status === 'posted' ? ' ✓ Online paid' : ''}
              </span>
            </div>
          ))}
        </div>

        {!state.paid && qr.shortUrl && (
          <a href={qr.shortUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginBottom: 8, fontSize: '0.76rem' }}>Open payment page</a>
        )}
        <button type="button" className="emp-btn-primary" style={{ width: '100%', padding: '12px', fontSize: '0.95rem' }} onClick={onClose} disabled={state.paid && !state.done}>
          {state.done ? 'Done' : state.paid ? 'Saving…' : 'Close'}
        </button>
      </div>
    </div>
  );
}
