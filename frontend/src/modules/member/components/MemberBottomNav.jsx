import React from 'react';
import { NavLink } from 'react-router-dom';
import { useMemberApp } from '../MemberAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

export default function MemberBottomNav() {
  const { memUser } = useMemberApp();

  if (!memUser) return null;

  return (
    <nav className="mem-bottom-nav">
      <NavLink
        to="/member"
        end
        className={({ isActive }) => `mem-nav-item ${isActive ? 'active' : ''}`}
      >
        <Icon name="home" size={20} />
        <span>Home</span>
      </NavLink>

      <NavLink
        to="/member/loans"
        className={({ isActive }) => `mem-nav-item ${isActive ? 'active' : ''}`}
      >
        <Icon name="creditcard" size={20} />
        <span>Loans</span>
      </NavLink>

      <NavLink
        to="/member/emi-pay"
        className={({ isActive }) => `mem-nav-item ${isActive ? 'active' : ''}`}
      >
        <Icon name="dollar" size={20} />
        <span>Pay EMI</span>
      </NavLink>

      <NavLink
        to="/member/security"
        className={({ isActive }) => `mem-nav-item ${isActive ? 'active' : ''}`}
      >
        <Icon name="shield" size={20} />
        <span>Security</span>
      </NavLink>

      <NavLink
        to="/member/profile"
        className={({ isActive }) => `mem-nav-item ${isActive ? 'active' : ''}`}
      >
        <Icon name="user" size={20} />
        <span>Profile</span>
      </NavLink>
    </nav>
  );
}
