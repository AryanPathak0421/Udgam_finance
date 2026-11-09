import React, { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function MemberPassbook() {
  const [passbook, setPassbook] = useState({ balancePaise: 0, entries: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadPassbook();
  }, []);

  async function loadPassbook() {
    setLoading(true);
    setError('');
    try {
      const res = await api.memberApp.passbook();
      setPassbook(res);
    } catch (err) {
      setError(err.message || 'Failed to load passbook entries');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: 'var(--mem-text)' }}>
          Digital Passbook
        </h2>
        <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--mem-text-muted)' }}>
          Security deposit &amp; compulsory savings statement
        </p>
      </div>

      {/* Balance Card */}
      <div
        className="mem-card"
        style={{
          background: 'linear-gradient(135deg, #059669, #047857)',
          color: '#ffffff',
          borderRadius: 16,
          padding: '18px 20px',
        }}
      >
        <div style={{ fontSize: '0.78rem', opacity: 0.9, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
          Available Security Deposit
        </div>
        <div style={{ fontSize: '1.8rem', fontWeight: 900, marginTop: 4 }}>
          ₹{((passbook.balancePaise || 0) / 100).toLocaleString('en-IN')}
        </div>
        <div style={{ fontSize: '0.76rem', opacity: 0.85, marginTop: 4 }}>
          Earns interest as per microfinance policy; refundable at loan closure.
        </div>
      </div>

      {/* Passbook Transactions */}
      <div className="mem-card">
        <div className="mem-card-title">
          <span>Statement Entries</span>
          <button
            type="button"
            className="mem-btn sm secondary"
            style={{ width: 'auto', padding: '4px 10px', fontSize: '0.75rem' }}
            onClick={loadPassbook}
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--mem-text-muted)' }}>
            <Icon name="loader" size={24} className="spin" />
            <p style={{ marginTop: 8, fontSize: '0.85rem' }}>Loading statement…</p>
          </div>
        ) : error ? (
          <div className="mem-alert danger">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </div>
        ) : passbook.entries.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--mem-text-muted)' }}>
            <Icon name="bookopen" size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
            <div style={{ fontWeight: 700 }}>No passbook entries yet</div>
            <p style={{ fontSize: '0.8rem', margin: '4px 0 0' }}>
              Security deductions made during loan payments will show here.
            </p>
          </div>
        ) : (
          <div>
            {passbook.entries.map((item, idx) => {
              const isCredit = item.type === 'credit';
              return (
                <div key={idx} className="mem-stat-row" style={{ padding: '12px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 16,
                        background: isCredit ? 'var(--mem-success-light)' : 'var(--mem-danger-light)',
                        color: isCredit ? 'var(--mem-success)' : 'var(--mem-danger)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 900,
                        fontSize: '1rem',
                        flexShrink: 0,
                      }}
                    >
                      {isCredit ? '+' : '−'}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.86rem', color: 'var(--mem-text)' }}>
                        {item.remark}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--mem-text-muted)', marginTop: 2 }}>
                        {new Date(item.date).toLocaleDateString('en-IN')} &bull; Ref: {item.reference || '—'}
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div
                      style={{
                        fontWeight: 900,
                        fontSize: '0.96rem',
                        color: isCredit ? 'var(--mem-success)' : 'var(--mem-danger)',
                      }}
                    >
                      {isCredit ? '+' : '−'}₹{((item.amountPaise || 0) / 100).toLocaleString('en-IN')}
                    </div>
                    <span
                      style={{
                        fontSize: '0.66rem',
                        color: isCredit ? 'var(--mem-success)' : 'var(--mem-danger)',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                      }}
                    >
                      {item.type}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

