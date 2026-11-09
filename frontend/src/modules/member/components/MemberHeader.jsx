import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMemberApp } from '../MemberAppContext.jsx';
import Icon from '../../../components/Icon.jsx';

export default function MemberHeader() {
  const { memUser } = useMemberApp();
  const location = useLocation();

  if (!memUser) return null;

  return (
    <header className="mem-header">
      <div className="mem-header-brand">
        <img src="/logo.png" alt="Udgam" className="mem-header-logo" />
        <div>
          <div className="mem-header-title">Udgam Member</div>
          <div className="mem-header-subtitle">
            {memUser.branch?.name ? `${memUser.branch.name} Branch` : 'Customer Portal'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Link
          to="/member/profile"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'var(--mem-primary-light)',
            padding: '4px 10px',
            borderRadius: 20,
            textDecoration: 'none',
            color: 'var(--mem-primary)',
            fontSize: '0.78rem',
            fontWeight: 700,
            border: '1px solid rgba(5, 150, 105, 0.2)',
          }}
        >
          <Icon name="user" size={14} />
          <span>{memUser.code || 'Profile'}</span>
        </Link>
      </div>
    </header>
  );
}
