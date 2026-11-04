import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useEmpApp } from '../EmployeeAppContext.jsx';

export default function EmployeeBottomNav() {
  const { t } = useEmpApp();
  const navigate = useNavigate();
  const [actionsOpen, setActionsOpen] = useState(false);

  return (
    <>
      <nav className="emp-bottom-nav">
        <NavLink to="/employee" end className={({ isActive }) => `emp-nav-item ${isActive ? 'active' : ''}`}>
          <span className="icon">🏠</span>
          <span>{t('home')}</span>
        </NavLink>

        <NavLink to="/employee/collections" className={({ isActive }) => `emp-nav-item ${isActive ? 'active' : ''}`}>
          <span className="icon">💳</span>
          <span>{t('collections')}</span>
        </NavLink>

        <button
          type="button"
          onClick={() => setActionsOpen(true)}
          className="emp-nav-item"
          style={{ background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <span className="icon" style={{ background: 'var(--emp-primary)', color: '#fff', borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '-4px auto 0' }}>
            ＋
          </span>
          <span style={{ marginTop: 2 }}>{t('quick_actions')}</span>
        </button>

        <NavLink to="/employee/calculator" className={({ isActive }) => `emp-nav-item ${isActive ? 'active' : ''}`}>
          <span className="icon">🧮</span>
          <span>{t('calculator')}</span>
        </NavLink>

        <NavLink to="/employee/profile" className={({ isActive }) => `emp-nav-item ${isActive ? 'active' : ''}`}>
          <span className="icon">👤</span>
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
            style={{ width: '100%', maxWidth: 480, background: 'var(--emp-card-bg)', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: '20px 16px 36px', boxSizing: 'border-box' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <strong style={{ fontSize: '1.05rem' }}>🚀 Quick Actions</strong>
              <button className="emp-icon-btn" onClick={() => setActionsOpen(false)}>✕</button>
            </div>
            <div className="emp-actions-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <div className="emp-action-tile" onClick={() => { setActionsOpen(false); navigate('/employee/new-member'); }}>
                <div className="tile-icon">👥</div>
                <div className="tile-title">{t('new_member')}</div>
              </div>
              <div className="emp-action-tile" onClick={() => { setActionsOpen(false); navigate('/employee/member-kyc'); }}>
                <div className="tile-icon">🆔</div>
                <div className="tile-title">{t('member_kyc')}</div>
              </div>
              <div className="emp-action-tile" onClick={() => { setActionsOpen(false); navigate('/employee/loan-requisition'); }}>
                <div className="tile-icon">📝</div>
                <div className="tile-title">{t('loan_requisition')}</div>
              </div>
              <div className="emp-action-tile" onClick={() => { setActionsOpen(false); navigate('/employee/guarantor-change'); }}>
                <div className="tile-icon">🔄</div>
                <div className="tile-title">{t('guarantor_change')}</div>
              </div>
              <div className="emp-action-tile" onClick={() => { setActionsOpen(false); navigate('/employee/synopsis'); }}>
                <div className="tile-icon">🔍</div>
                <div className="tile-title">{t('synopsis')}</div>
              </div>
              <div className="emp-action-tile" onClick={() => { setActionsOpen(false); navigate('/employee/due-list'); }}>
                <div className="tile-icon">📅</div>
                <div className="tile-title">{t('due_list')}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
