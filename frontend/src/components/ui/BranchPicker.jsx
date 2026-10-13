// Multi-select of branches as a checkbox list with "select all".
export default function BranchPicker({ options, value, onChange, error }) {
  const allSelected = options.length > 0 && value.length === options.length;
  const toggle = (id) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  if (!options.length) return <div className="field-hint">No active branches found. Add a branch in Branch Master first.</div>;

  return (
    <div className={`picker${error ? ' has-error' : ''}`}>
      <label className="picker-all">
        <input type="checkbox" checked={allSelected} onChange={() => onChange(allSelected ? [] : options.map((o) => o.id))} />
        <span>Select all ({options.length})</span>
      </label>
      <div className="picker-list">
        {options.map((o) => (
          <label key={o.id} className="picker-item">
            <input type="checkbox" checked={value.includes(o.id)} onChange={() => toggle(o.id)} />
            <span>
              <strong>{o.code}</strong> · {o.name}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
