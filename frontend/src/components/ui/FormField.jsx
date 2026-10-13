// Label + control + hint/error wrapper. `children` must be the control using the same `id`.
export default function FormField({ id, label, required, error, hint, children, className = '' }) {
  return (
    <div className={`field${error ? ' has-error' : ''} ${className}`}>
      <label htmlFor={id}>
        {label}
        {required && <span className="req"> *</span>}
      </label>
      {children}
      {error ? (
        <div className="field-error" id={`${id}-error`} role="alert">
          {error}
        </div>
      ) : (
        hint && <div className="field-hint">{hint}</div>
      )}
    </div>
  );
}
