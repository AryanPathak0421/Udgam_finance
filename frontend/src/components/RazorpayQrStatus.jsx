import { useEffect, useState } from 'react';

/**
 * Shown under a Razorpay QR: asks every few seconds whether the payment is made and tells it ("Waiting for payment" / "Paid"), with the payment id.
 * `check(linkId)` is the api call of the screen (software or staff app); `onPaid(paymentId)` is told once when the payment is done.
 */
export default function RazorpayQrStatus({ razorpay, check, onPaid, dark = false }) {
  const [state, setState] = useState({ paid: false, paymentId: '', status: 'created', error: '' });
  const linkId = razorpay?.linkId;

  useEffect(() => {
    if (!linkId || !check) return undefined;
    let stop = false;
    let timer;
    const tick = async () => {
      try {
        const r = await check(linkId);
        if (stop) return;
        setState({ paid: !!r.paid, paymentId: r.paymentId || '', status: r.status, error: '' });
        if (r.paid) { if (onPaid) onPaid(r.paymentId || ''); return; }
        if (r.status === 'expired' || r.status === 'cancelled') return;
      } catch (err) {
        if (!stop) setState((s) => ({ ...s, error: err.message || 'Could not check the payment' }));
      }
      timer = setTimeout(tick, 4000);
    };
    timer = setTimeout(tick, 3000);
    return () => { stop = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkId]);

  if (!razorpay) return null;
  const box = { marginTop: 8, padding: '8px 12px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 700, textAlign: 'center' };
  return (
    <div>
      {state.paid ? (
        <div style={{ ...box, background: '#dcfce7', color: '#166534' }}>
          ✓ Payment received{state.paymentId ? ` — ${state.paymentId}` : ''}
        </div>
      ) : state.status === 'expired' || state.status === 'cancelled' ? (
        <div style={{ ...box, background: '#fee2e2', color: '#991b1b' }}>This QR has expired. Close and open it again.</div>
      ) : (
        <div style={{ ...box, background: dark ? '#1e293b' : '#eff6ff', color: dark ? '#cbd5e1' : '#1e40af' }}>
          Waiting for the payment… (Razorpay — any UPI app)
        </div>
      )}
      {razorpay.shortUrl && !state.paid && (
        <a href={razorpay.shortUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 6, fontSize: '0.74rem' }}>
          Open payment page
        </a>
      )}
      {razorpay.testMode && <div style={{ fontSize: '0.68rem', color: '#92400e', marginTop: 4 }}>Test mode — no real money</div>}
    </div>
  );
}
