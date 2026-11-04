import { useEffect, useState } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';

export default function EmployeeHolidays() {
  const { t } = useEmployeeApp();
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    api.employeeApp.holidays({ year: currentYear })
      .then((res) => setHolidays(res.items || []))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, [currentYear]);

  return (
    <div className="emp-page-container">
      <div className="emp-card">
        <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 6px 0', color: 'var(--emp-text)' }}>
          🎉 Company Holiday Calendar ({currentYear})
        </h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', margin: 0 }}>
          Official paid company holidays and festival leaves across all branches.
        </p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '30px', color: 'var(--emp-text-muted)' }}>Loading holidays...</div>
      ) : holidays.length === 0 ? (
        <div className="emp-card" style={{ textAlign: 'center', padding: '36px', color: 'var(--emp-text-muted)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🏖️</div>
          <div style={{ fontWeight: 600 }}>No holidays recorded for {currentYear}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {holidays.map((h) => {
            const dateObj = new Date(h.date);
            const isUpcoming = dateObj >= new Date();

            return (
              <div
                key={h.id || h.date}
                className="emp-card"
                style={{
                  margin: 0,
                  padding: 12,
                  borderLeft: isUpcoming ? '4px solid var(--emp-primary)' : '4px solid var(--emp-border)',
                  background: isUpcoming ? 'rgba(37, 99, 235, 0.04)' : 'var(--emp-card-bg)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--emp-text)' }}>
                      {h.name}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                      {dateObj.toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                    </div>
                  </div>

                  <div>
                    <span className={`emp-badge ${isUpcoming ? 'emp-badge-info' : 'emp-badge-warning'}`}>
                      {isUpcoming ? 'Upcoming' : 'Past'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
