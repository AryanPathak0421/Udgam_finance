import { useAuth } from '../context/AuthContext.jsx';
import Icon from '../components/Icon.jsx';

// Placeholder metrics: real values come from GET /api/dashboard/summary once that exists.
const STATS = [
  { label: 'Active Customers', icon: 'customer', tone: 'teal' },
  { label: 'Active Loans', icon: 'loan', tone: 'gold' },
  { label: 'Outstanding Principal', icon: 'cash', tone: 'purple' },
  { label: "Today's Demand", icon: 'ledger', tone: 'teal' },
  { label: "Today's Collection", icon: 'collect', tone: 'gold' },
  { label: 'Collection Efficiency', icon: 'chart', tone: 'purple' },
  { label: 'Pending Approvals', icon: 'file', tone: 'teal' },
  { label: 'Overdue Accounts', icon: 'alert', tone: 'red' },
];

function StatCard({ label, icon, tone }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`}>
        <Icon name={icon} />
      </div>
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">—</div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  return (
    <>
      <div className="page-head">
        <div>
          <h2>Welcome back, {user.name}</h2>
          <p>Here is an overview of your portfolio. Data will appear as modules are built.</p>
        </div>
      </div>

      <section className="stat-grid">
        {STATS.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </section>

      <section className="panel-grid">
        <div className="panel">
          <h3>Collection trend (last 30 days)</h3>
          <div className="empty">No collection data yet</div>
        </div>
        <div className="panel">
          <h3>Portfolio at risk (DPD)</h3>
          <div className="empty">No loan data yet</div>
        </div>
      </section>
    </>
  );
}
