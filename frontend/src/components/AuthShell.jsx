import Icon from './Icon.jsx';
import '../styles/login.css';

const FEATURES = [
  'Customer, group & KYC management',
  'Loan lifecycle: application to closure',
  'Collections, recovery & overdue tracking',
  'Role-based access with full audit trail',
];

// Two-column layout shared by Login, Forgot password and Reset password.
export default function AuthShell({ children }) {
  return (
    <main className="auth">
      <section className="auth-brand">
        <div className="auth-ring ring-a" />
        <div className="auth-ring ring-b" />
        <div className="auth-brand-inner">
          <div className="auth-logo-tile">
            <img src="/logo.png" alt="Udgam Microfinance — You happy we happy" />
          </div>
          <h2>Empowering every household, one loan at a time.</h2>
          <p>One secure workspace to run branches, lending and collections.</p>
          <ul>
            {FEATURES.map((f) => (
              <li key={f}>
                <span className="tick">
                  <Icon name="check" size={14} />
                </span>
                {f}
              </li>
            ))}
          </ul>
        </div>
        <div className="auth-brand-foot">© {new Date().getFullYear()} Udgam Microfinance</div>
      </section>

      <section className="auth-form-side">
        <div className="auth-form-wrap">
          <img className="auth-logo-mobile" src="/logo.png" alt="Udgam Microfinance" />
          {children}
        </div>
      </section>
    </main>
  );
}
