import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../../api/client.js';
import Icon from '../../../components/Icon.jsx';

export default function MemberNoc() {
  const { id: paramId } = useParams();
  const [loans, setLoans] = useState([]);
  const [selectedLoanId, setSelectedLoanId] = useState(paramId || '');
  const [nocData, setNocData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadInitial();
  }, [paramId]);

  async function loadInitial() {
    setLoading(true);
    setError('');
    try {
      const res = await api.memberApp.loans();
      const allLoans = res.loans || [];
      setLoans(allLoans);

      const targetId = paramId || (allLoans.find((l) => l.status === 'completed')?.id || allLoans[0]?.id);
      if (targetId) {
        setSelectedLoanId(targetId);
        await fetchNoc(targetId);
      } else {
        setLoading(false);
      }
    } catch (err) {
      setError(err.message || 'Failed to load loans for NOC');
      setLoading(false);
    }
  }

  async function fetchNoc(loanId) {
    setLoading(true);
    setError('');
    setNocData(null);
    try {
      const res = await api.memberApp.loanNoc(loanId);
      setNocData(res.certificate);
    } catch (err) {
      setError(err.message || 'Unable to generate NOC for this loan account');
    } finally {
      setLoading(false);
    }
  }

  function handleSelectLoan(e) {
    const loanId = e.target.value;
    setSelectedLoanId(loanId);
    if (loanId) {
      fetchNoc(loanId);
    }
  }

  function handlePrint() {
    window.print();
  }

  const cert = nocData;

  return (
    <div>
      <div className="mem-no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Link
          to="/member/loans"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: 'var(--mem-primary)',
            textDecoration: 'none',
            fontSize: '0.82rem',
            fontWeight: 700,
          }}
        >
          &larr; Back to Loans
        </Link>
        <span className="mem-badge active">NOC Certificate</span>
      </div>

      {/* Loan Selector dropdown for selecting completed loan */}
      <div className="mem-card mem-no-print" style={{ padding: 14 }}>
        <label className="mem-label">Select Loan for NOC Download:</label>
        <select
          className="mem-select"
          value={selectedLoanId}
          onChange={handleSelectLoan}
        >
          {loans.map((l) => (
            <option key={l.id} value={l.id}>
              {l.schemeName} ({l.loanId}) &bull; {l.status === 'completed' ? '✓ Closed (Eligible for NOC)' : 'Active (Running)'}
            </option>
          ))}
          {loans.length === 0 && <option value="">No loan accounts found</option>}
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--mem-text-muted)' }}>
          <Icon name="loader" size={26} className="spin" />
          <p style={{ marginTop: 8, fontSize: '0.85rem' }}>Generating official clearance certificate…</p>
        </div>
      ) : error ? (
        <div className="mem-alert danger mem-no-print">
          <Icon name="alert" size={16} />
          <div>
            <div style={{ fontWeight: 700 }}>NOC Not Available</div>
            <div style={{ fontSize: '0.8rem', marginTop: 2 }}>{error}</div>
            <div style={{ fontSize: '0.74rem', marginTop: 6, color: 'var(--mem-text)' }}>
              Note: An official NOC is generated only after all loan installments have been paid in full.
            </div>
          </div>
        </div>
      ) : cert ? (
        <div>
          {/* Action buttons */}
          <div className="mem-no-print" style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <button
              type="button"
              className="mem-btn"
              onClick={handlePrint}
              style={{ background: 'linear-gradient(135deg, #059669, #047857)' }}
            >
              <Icon name="file" size={18} />
              <span>Print / Download NOC PDF</span>
            </button>
          </div>

          {/* Official NOC Printable Certificate */}
          <div
            className="mem-card mem-noc-printable"
            style={{
              background: '#ffffff',
              color: '#0f172a',
              border: '2px solid #059669',
              borderRadius: 16,
              padding: '24px 20px',
              boxShadow: '0 8px 30px rgba(0,0,0,0.1)',
              position: 'relative',
            }}
          >
            {/* Certificate Header */}
            <div style={{ textAlign: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: 16, marginBottom: 18 }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#059669', letterSpacing: '0.5px' }}>
                UDGAM MICRO FINANCE LIMITED
              </div>
              <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: 2 }}>
                CIN: U65929DL2020PLC123456 &bull; RBI Microfinance Lending Guidelines Compliant
              </div>
              <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: 2 }}>
                Branch: {cert.member?.branch?.name || 'Head Office'} &bull; Contact: support@udgamfinance.com
              </div>

              <div
                style={{
                  display: 'inline-block',
                  marginTop: 14,
                  padding: '6px 18px',
                  background: '#ecfdf5',
                  border: '1.5px solid #059669',
                  borderRadius: 20,
                  fontWeight: 900,
                  fontSize: '0.92rem',
                  color: '#064e3b',
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                }}
              >
                NO OBJECTION & LOAN CLEARANCE CERTIFICATE
              </div>
            </div>

            {/* Certificate Meta */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#64748b', marginBottom: 16 }}>
              <div>Ref No: <strong>{cert.certificateNo}</strong></div>
              <div>Date of Issue: <strong>{new Date(cert.issueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</strong></div>
            </div>

            {/* Member and Loan Details Grid */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 12,
                padding: '12px 14px',
                marginBottom: 16,
                fontSize: '0.84rem',
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px 16px' }}>
                <div>
                  <span style={{ color: '#64748b', fontSize: '0.74rem' }}>Member Name:</span>
                  <div style={{ fontWeight: 800 }}>{cert.member?.name}</div>
                </div>
                <div>
                  <span style={{ color: '#64748b', fontSize: '0.74rem' }}>Member Code:</span>
                  <div style={{ fontWeight: 800 }}>{cert.member?.code}</div>
                </div>
                <div>
                  <span style={{ color: '#64748b', fontSize: '0.74rem' }}>Loan Account No:</span>
                  <div style={{ fontWeight: 800, color: '#059669' }}>{cert.loan?.loanId}</div>
                </div>
                <div>
                  <span style={{ color: '#64748b', fontSize: '0.74rem' }}>Loan Scheme:</span>
                  <div style={{ fontWeight: 800 }}>{cert.loan?.schemeName}</div>
                </div>
                <div>
                  <span style={{ color: '#64748b', fontSize: '0.74rem' }}>Sanctioned Amount:</span>
                  <div style={{ fontWeight: 800 }}>₹{((cert.loan?.sanctionedAmountPaise || 0) / 100).toLocaleString('en-IN')}</div>
                </div>
                <div>
                  <span style={{ color: '#64748b', fontSize: '0.74rem' }}>Disbursement Date:</span>
                  <div style={{ fontWeight: 700 }}>{cert.loan?.disbursedOn ? new Date(cert.loan.disbursedOn).toLocaleDateString('en-IN') : '—'}</div>
                </div>
                <div>
                  <span style={{ color: '#64748b', fontSize: '0.74rem' }}>Total Repaid:</span>
                  <div style={{ fontWeight: 800, color: '#059669' }}>₹{((cert.loan?.totalRepaidPaise || 0) / 100).toLocaleString('en-IN')}</div>
                </div>
                <div>
                  <span style={{ color: '#64748b', fontSize: '0.74rem' }}>Outstanding Due:</span>
                  <div style={{ fontWeight: 800, color: '#16a34a' }}>₹0.00 (NIL)</div>
                </div>
              </div>
            </div>

            {/* Declaration Text */}
            <div style={{ fontSize: '0.82rem', lineHeight: '1.6', color: '#334155', marginBottom: 24, textAlign: 'justify' }}>
              <p>
                <strong>TO WHOMSOEVER IT MAY CONCERN:</strong>
              </p>
              <p style={{ marginTop: 6 }}>
                This is to officially certify that <strong>{cert.member?.name}</strong> (Member ID: <strong>{cert.member?.code}</strong>)
                has fully and satisfactorily repaid all installments and dues towards Loan Account <strong>{cert.loan?.loanId}</strong>.
              </p>
              <p style={{ marginTop: 6 }}>
                As on date, there are <strong>NIL outstanding dues</strong> or overdue obligations remaining against this loan account.
                Udgam Micro Finance Limited has <strong>No Objection (NOC)</strong> towards the closure of this account, release of any associated
                hypothecations, and the member is in excellent standing with our institution.
              </p>
            </div>

            {/* Signatures & Seal */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingTop: 16, borderTop: '1px dashed #cbd5e1' }}>
              <div style={{ textAlign: 'center' }}>
                <div
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: '50%',
                    border: '2px solid #059669',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 6px',
                    color: '#059669',
                    fontSize: '0.62rem',
                    fontWeight: 900,
                    textTransform: 'uppercase',
                    lineHeight: '1.1',
                    padding: 4,
                  }}
                >
                  UDGAM VERIFIED SEAL
                </div>
                <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Branch Verification Stamp</div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'cursive', fontSize: '1.1rem', color: '#059669', marginBottom: 4 }}>
                  Authorized Signatory
                </div>
                <div style={{ fontWeight: 800, fontSize: '0.78rem' }}>For Udgam Micro Finance Ltd</div>
                <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Head Office / Branch Manager</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
