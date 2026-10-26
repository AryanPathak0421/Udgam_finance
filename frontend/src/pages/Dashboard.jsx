import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Icon from '../components/Icon.jsx';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const short = (n) => (n >= 10000000 ? `${(n / 10000000).toFixed(1)}Cr` : n >= 100000 ? `${(n / 100000).toFixed(1)}L` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const dm = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
const monthName = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' });

function StatCard({ label, icon, tone, value, to }) {
  const body = (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`}><Icon name={icon} /></div>
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value ?? '—'}</div>
      </div>
    </div>
  );
  return to ? <Link to={to} style={{ textDecoration: 'none', color: 'inherit' }}>{body}</Link> : body;
}

/** The collection of every day of the last 30 days as an area: the line shows the rhythm of the month, the dot is the best day. */
function PulseChart({ days }) {
  const W = 620; const H = 230; const L = 44; const R = 10; const T = 14; const B = 28;
  const max = Math.max(...days.map((d) => d.collected), 1);
  const x = (i) => L + (i * (W - L - R)) / (days.length - 1);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const line = days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.collected).toFixed(1)}`).join(' ');
  const best = days.reduce((a, d, i) => (d.collected > days[a].collected ? i : a), 0);
  const total = days.reduce((s, d) => s + d.collected, 0);
  return (
    <div className="chart-box">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Collection of the last 30 days">
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} stroke="currentColor" opacity="0.12" /><text x={L - 6} y={y(max * f) + 4} fontSize="10" textAnchor="end" fill="currentColor" opacity="0.6">{short(max * f)}</text></g>)}
        <path d={`${line} L${x(days.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill="#2a9d8f" opacity="0.18" />
        <path d={line} fill="none" stroke="#2a9d8f" strokeWidth="2.2" strokeLinejoin="round" />
        {days.map((d, i) => <circle key={d.date} cx={x(i)} cy={y(d.collected)} r="6" fill="transparent"><title>{`${dm(d.date)}: ${inr(d.collected)}`}</title></circle>)}
        {days[best].collected > 0 && <><circle cx={x(best)} cy={y(days[best].collected)} r="4.5" fill="#e9a23b" stroke="#fff" strokeWidth="1.5" /><text x={Math.min(x(best), W - 70)} y={y(days[best].collected) - 9} fontSize="10" fill="currentColor">{`Best ${dm(days[best].date)} · ${inr(days[best].collected)}`}</text></>}
        {[0, 7, 14, 21, 29].map((i) => <text key={i} x={x(i)} y={H - 8} fontSize="10" textAnchor="middle" fill="currentColor" opacity="0.6">{dm(days[i].date)}</text>)}
      </svg>
      <div className="muted small">Last 30 days: <strong>{inr(total)}</strong> collected</div>
    </div>
  );
}

/** Loans paid out against EMI collected, month by month. */
function MonthBars({ months }) {
  const W = 620; const H = 230; const L = 44; const R = 10; const T = 14; const B = 28;
  const max = Math.max(...months.flatMap((m) => [m.disbursed, m.collected]), 1);
  const slot = (W - L - R) / months.length;
  const bw = Math.min(26, slot / 3);
  const y = (v) => T + (H - T - B) * (1 - v / max);
  return (
    <div className="chart-box">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Loans paid out and EMI collected, last 6 months">
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} stroke="currentColor" opacity="0.12" /><text x={L - 6} y={y(max * f) + 4} fontSize="10" textAnchor="end" fill="currentColor" opacity="0.6">{short(max * f)}</text></g>)}
        {months.map((m, i) => {
          const cx = L + slot * i + slot / 2;
          return (
            <g key={m.month}>
              <rect x={cx - bw - 1} y={y(m.disbursed)} width={bw} height={Math.max(y(0) - y(m.disbursed), 0)} rx="3" fill="#264653"><title>{`${monthName(m.month)} paid out: ${inr(m.disbursed)}`}</title></rect>
              <rect x={cx + 1} y={y(m.collected)} width={bw} height={Math.max(y(0) - y(m.collected), 0)} rx="3" fill="#2a9d8f"><title>{`${monthName(m.month)} collected: ${inr(m.collected)}`}</title></rect>
              <text x={cx} y={H - 8} fontSize="10" textAnchor="middle" fill="currentColor" opacity="0.7">{monthName(m.month)}</text>
            </g>
          );
        })}
      </svg>
      <div className="small muted" style={{ display: 'flex', gap: 16 }}>
        <span><span style={{ background: '#264653', width: 12, height: 12, display: 'inline-block', borderRadius: 3 }} /> Loans paid out</span>
        <span><span style={{ background: '#2a9d8f', width: 12, height: 12, display: 'inline-block', borderRadius: 3 }} /> EMI collected</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [d, setD] = useState(null);
  const [notes, setNotes] = useState({ unread: 0, items: [] });
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api.dashboard().then((r) => { if (live) setD(r); }).catch((e) => live && setError(e.message));
    api.myNotifications().then((r) => { if (live) setNotes(r); }).catch(() => {});
    return () => { live = false; };
  }, []);
  async function markRead() {
    try { await api.readNotifications(); setNotes((n) => ({ unread: 0, items: n.items.map((i) => ({ ...i, read: true })) })); } catch { /* not worth an error */ }
  }
  const stats = d && [
    { label: 'Members', icon: 'customer', tone: 'teal', value: d.members.toLocaleString('en-IN') },
    { label: 'Working employees', icon: 'users', tone: 'gold', value: d.employees.toLocaleString('en-IN'), to: '/hr/employees' },
    { label: 'Loans paid out this month', icon: 'loan', tone: 'purple', value: d.loansMonth.toLocaleString('en-IN') },
    { label: 'Paid out this month', icon: 'cash', tone: 'teal', value: inr(d.disbursedMonth) },
    { label: "Today's collection", icon: 'collect', tone: 'gold', value: inr(d.collectedToday) },
    { label: 'Collected this month', icon: 'ledger', tone: 'purple', value: inr(d.collectedMonth) },
    { label: 'Waiting for approval', icon: 'file', tone: 'teal', value: d.pending.toLocaleString('en-IN') },
    { label: 'Open complaints', icon: 'alert', tone: 'red', value: d.openComplaints.toLocaleString('en-IN'), to: '/hr/complaints' },
  ];
  return (
    <>
      <div className="page-head">
        <div>
          <h2>Welcome back, {user.name}</h2>
          <p>{error ? `The figures could not be loaded: ${error}` : 'Here is an overview of your branches.'}</p>
        </div>
      </div>

      <section className="stat-grid">
        {(stats || Array.from({ length: 8 }, (_, i) => ({ label: '…', icon: 'chart', tone: 'teal' }))).map((s, i) => <StatCard key={s.label + i} {...s} />)}
      </section>

      <section className="panel-grid">
        <div className="panel">
          <h3>Collection of the last 30 days</h3>
          {d ? <PulseChart days={d.days} /> : <div className="empty">Loading…</div>}
        </div>
        <div className="panel">
          <h3>Paid out and collected, last 6 months</h3>
          {d ? <MonthBars months={d.months} /> : <div className="empty">Loading…</div>}
        </div>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h3 style={{ margin: 0 }}>Notifications{notes.unread ? ` (${notes.unread} new)` : ''}</h3>
          {notes.unread > 0 && <button className="btn sm" onClick={markRead}>Mark all as read</button>}
        </div>
        {notes.items.length === 0 ? <div className="empty">No notification.</div> : (
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
            {notes.items.slice(0, 8).map((n) => (
              <li key={n.id} style={{ padding: '8px 0', borderTop: '1px solid var(--border)', opacity: n.read ? 0.7 : 1 }}>
                <strong>{n.title}</strong>{!n.read && <span className="badge danger" style={{ marginLeft: 8 }}>New</span>}
                <div className="muted small">{n.message}</div>
                <div className="muted small">{new Date(n.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
