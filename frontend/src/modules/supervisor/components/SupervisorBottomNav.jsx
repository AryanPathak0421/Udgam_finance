import React from 'react';
import { NavLink } from 'react-router-dom';
import { useSupApp } from '../SupervisorAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorBottomNav() {
  const { t } = useSupApp();

  return (
    <nav className="sup-bottom-nav">
      <NavLink
        to="/supervisor"
        end
        className={({ isActive }) => `sup-nav-item ${isActive ? 'active' : ''}`}
      >
        <Icon name="home" size={20} />
        <span>{t('home')}</span>
      </NavLink>

      <NavLink
        to="/supervisor/today-due"
        className={({ isActive }) => `sup-nav-item ${isActive ? 'active' : ''}`}
      >
        <Icon name="calendar" size={20} />
        <span>{t('today_due')}</span>
      </NavLink>

      <NavLink
        to="/supervisor/new-member"
        className={({ isActive }) => `sup-nav-item ${isActive ? 'active' : ''}`}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'var(--sup-primary)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 10px rgba(15, 118, 110, 0.4)',
            marginTop: -14,
          }}
        >
          <Icon name="userplus" size={20} />
        </div>
        <span style={{ marginTop: 2 }}>{t('new_member')}</span>
      </NavLink>

      <NavLink
        to="/supervisor/npa-recovery"
        className={({ isActive }) => `sup-nav-item ${isActive ? 'active' : ''}`}
      >
        <Icon name="alerttriangle" size={20} />
        <span>{t('npa_recovery')}</span>
      </NavLink>

      <NavLink
        to="/supervisor/profile"
        className={({ isActive }) => `sup-nav-item ${isActive ? 'active' : ''}`}
      >
        <Icon name="user" size={20} />
        <span>{t('profile')}</span>
      </NavLink>
    </nav>
  );
}
