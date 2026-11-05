import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useEmpApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

export default function EmployeeBottomNav() {
  const { t } = useEmpApp();
  const navigate = useNavigate();
  const [actionsOpen, setActionsOpen] = useState(false);

  return (
    <>
      <nav className="emp-bottom-nav">
        <NavLink to="/employee" end className={({ isActive }) => `emp-nav-item ${isActive ? 'active' : ''}`}>
          <Icon name="home" size={20} />
          <span>{t('home')}</span>
        </NavLink>

        <NavLink to="/employee/emi-payment" className={({ isActive }) => `emp-nav-item ${isActive ? 'active' : ''}`}>
          <Icon name="creditcard" size={20} />
          <span>EMI Pay</span>
        </NavLink>

        <button
          type="button"
          onClick={() => setActionsOpen(true)}
          className="emp-nav-item"
          style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          aria-label="Quick Actions"
        >
          <span
            style={{
              background: 'linear-gradient(135deg, var(--emp-primary), #0b5d57)',
              color: '#fff',
              borderRadius: '50%',
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '-6px auto 0',
              boxShadow: '0 4px 10px rgba(16, 120, 112, 0.35)',
              fontSize: '1.2rem',
              fontWeight: 400
            }}
          >
            +
          </span>
          <span style={{ marginTop: 2 }}>{t('quick_actions')}</span>
        </button>

        <NavLink to="/employee/calculator" className={({ isActive }) => `emp-nav-item ${isActive ? 'active' : ''}`}>
          <Icon name="calculator" size={20} />
          <span>{t('calculator')}</span>
        </NavLink>

        <NavLink to="/employee/profile" className={({ isActive }) => `emp-nav-item ${isActive ? 'active' : ''}`}>
          <Icon name="user" size={20} />
          <span>{t('profile')}</span>
        </NavLink>
      </nav>

      {/* Action sheet popup */}
      {actionsOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setActionsOpen(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 480,
              background: 'var(--emp-card-bg)',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: '20px 16px 36px',
              boxSizing: 'border-box',
              borderTop: '3px solid var(--emp-primary)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="layers" size={18} style={{ color: 'var(--emp-primary)' }} />
                <strong style={{ fontSize: '1.05rem', color: 'var(--emp-text)' }}>Quick Actions</strong>
              </div>
              <button className="emp-icon-btn" onClick={() => setActionsOpen(false)} aria-label="Close">
                <Icon name="cross" size={16} />
              </button>
            </div>
            <div className="emp-actions-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <div className="emp-action-tile" onClick={() => { setActionsOpen(false); navigate('/employee/emi-payment'); }}>
                <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
                  <Icon name="rupee" size={22} />
                </div>
                <div className="tile-title">EMI Pay</div>
              </div>
              <div className="emp-action-tile" onClick={() => { setActionsOpen(false); navigate('/employee/advance-payment'); }}>
                <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
                  <Icon name="creditcard" size={22} />
                </div>
                <div className="tile-title">Advance Pay</div>
              </div>
              <div className="emp-action-tile" onClick={() => { setActionsOpen(false); navigate('/employee/npa-recovery'); }}>
                <div className="tile-icon" style={{ color: 'var(--emp-danger)' }}>
                  <Icon name="alert" size={22} />
                </div>
                <div className="tile-title">NPA Recovery</div>
              </div>
              <div className="emp-action-tile" onClick={() => { setActionsOpen(false); navigate('/employee/track-loan'); }}>
                <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
                  <Icon name="search" size={22} />
                </div>
                <div className="tile-title">Track Loan</div>
              </div>
              <div className="emp-action-tile" onClick={() => { setActionsOpen(false); navigate('/employee/new-member'); }}>
                <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
                  <Icon name="userplus" size={22} />
                </div>
                <div className="tile-title">{t('new_member')}</div>
              </div>
              <div className="emp-action-tile" onClick={() => { setActionsOpen(false); navigate('/employee/kyc'); }}>
                <div className="tile-icon" style={{ color: 'var(--emp-primary)' }}>
                  <Icon name="kyc" size={22} />
                </div>
                <div className="tile-title">{t('member_kyc')}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
