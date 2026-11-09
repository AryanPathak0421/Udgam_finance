import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useMemberApp } from '../MemberAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

export default function MemberBottomNav() {
  const { memUser } = useMemberApp();
  const location = useLocation();

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
        to="/member/passbook"
        className={({ isActive }) => `mem-nav-item ${isActive ? 'active' : ''}`}
      >
        <Icon name="bookopen" size={20} />
        <span>Passbook</span>
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
