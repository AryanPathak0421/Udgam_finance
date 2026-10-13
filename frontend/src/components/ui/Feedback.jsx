export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="state-box" role="status">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, description, action }) {
  return (
    <div className="state-box">
      <strong>{title}</strong>
      {description && <span>{description}</span>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="state-box error" role="alert">
      <strong>Something went wrong</strong>
      <span>{message}</span>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function StatusBadge({ active, activeLabel = 'Active', inactiveLabel = 'Inactive' }) {
  return <span className={`badge ${active ? 'green' : 'grey'}`}>{active ? activeLabel : inactiveLabel}</span>;
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="page-head row">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function DetailList({ items }) {
  return (
    <dl className="detail-list">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
