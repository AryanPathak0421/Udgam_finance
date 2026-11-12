import { useEffect, useState, useRef } from 'react';
import { api } from '../../../api/client.js';
import { useEmployeeApp } from '../EmployeeAppContext.jsx';
import Icon from '../../../components/Icon.jsx';
import { compressImage } from '../../../utils/image.js';

export default function EmployeeAttendance() {
  const { t } = useEmployeeApp();
  const [activeTab, setActiveTab] = useState('mark'); // 'mark' | 'history'

  // Mark First Meeting state
  const [photo, setPhoto] = useState('');
  const [location, setLocation] = useState(null);
  const [locLoading, setLocLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [markSuccess, setMarkSuccess] = useState('');
  const [markError, setMarkError] = useState('');
  const [timingInfo, setTimingInfo] = useState(null);

  // In-app Live Camera state (prevents Android WebView / mobile crash - Point 20)
  const [showCamera, setShowCamera] = useState(false);
  const [facingMode, setFacingMode] = useState('user');
  const [stream, setStream] = useState(null);
  const [cameraBusy, setCameraBusy] = useState(false);
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);

  const startLiveCamera = async (mode = facingMode) => {
    setCameraBusy(true);
    try {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      setStream(s);
      setShowCamera(true);
    } catch {
      // Fallback: If camera stream fails or permission denied, open safe file picker
      fileInputRef.current?.click();
    } finally {
      setCameraBusy(false);
    }
  };

  const stopLiveCamera = () => {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
    setShowCamera(false);
  };

  const captureLivePhoto = () => {
    if (!videoRef.current) return;
    try {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const b64 = canvas.toDataURL('image/jpeg', 0.8);
      stopLiveCamera();
      setPhoto(b64);
    } catch {
      alert('Capture failed. Please use file selection.');
      stopLiveCamera();
      fileInputRef.current?.click();
    }
  };

  const switchCamera = () => {
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextMode);
    startLiveCamera(nextMode);
  };

  useEffect(() => {
    if (showCamera && stream && videoRef.current) {
      videoRef.current.srcObject = stream;
    }
    return () => {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [showCamera, stream]);

  // Fetch attendance timing lock info
  useEffect(() => {
    api.employeeApp.attendanceTiming().then((res) => {
      setTimingInfo(res);
    }).catch(() => {});
  }, []);

  // History state
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const [month, setMonth] = useState(currentMonth);
  const [historyData, setHistoryData] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Auto-detect GPS location
  useEffect(() => {
    if (navigator.geolocation) {
      setLocLoading(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            address: `GPS (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)})`,
          });
          setLocLoading(false);
        },
        () => {
          setLocLoading(false);
        }
      );
    }
  }, []);

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const b64 = await compressImage(file, { maxWidth: 1000, maxHeight: 1000, quality: 0.8 });
      setPhoto(b64);
    } catch {
      alert('Photo compression failed');
    }
  };

  const handleMarkAttendance = async (e) => {
    e.preventDefault();
    if (!photo) return setMarkError('First meeting photo is required');
    setSubmitting(true);
    setMarkError('');
    setMarkSuccess('');
    try {
      const res = await api.employeeApp.markFirstMeeting({
        photo,
        location,
      });
      setMarkSuccess(res.message);
      setPhoto('');
    } catch (err) {
      setMarkError(err.message || 'Failed to mark first meeting attendance');
    } finally {
      setSubmitting(false);
    }
  };

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await api.employeeApp.attendanceHistory({ month });
      setHistoryData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistory();
    }
  }, [activeTab, month]);

  return (
    <div className="emp-page-container">
      {/* Tab Switcher */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button
          type="button"
          className={activeTab === 'mark' ? 'emp-btn-primary' : 'emp-btn-secondary'}
          style={{ flex: 1, padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 700 }}
          onClick={() => setActiveTab('mark')}
        >
          <Icon name="camera" size={16} />
          <span>First Meeting</span>
        </button>
        <button
          type="button"
          className={activeTab === 'history' ? 'emp-btn-primary' : 'emp-btn-secondary'}
          style={{ flex: 1, padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 700 }}
          onClick={() => setActiveTab('history')}
        >
          <Icon name="calendar" size={16} />
          <span>Attendance History</span>
        </button>
      </div>

      {activeTab === 'mark' && (
        <div className="emp-card">
          <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: '0 0 6px 0', color: 'var(--emp-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="mappin" size={20} style={{ color: 'var(--emp-primary)' }} />
            <span>First Meeting Check-In</span>
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--emp-text-muted)', margin: '0 0 16px 0' }}>
            Mark your morning presence by capturing a photo of the first meeting with GPS location and timestamp.
          </p>

          {/* Allowed Timing Banner */}
          {timingInfo?.timing && (
            <div
              style={{
                background: timingInfo.isLocked ? '#fee2e2' : '#f0fdf4',
                border: `1px solid ${timingInfo.isLocked ? '#f87171' : '#86efac'}`,
                color: timingInfo.isLocked ? '#991b1b' : '#166534',
                padding: '10px 14px',
                borderRadius: 8,
                fontSize: '0.82rem',
                marginBottom: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Icon name={timingInfo.isLocked ? 'lock' : 'check'} size={18} />
              <div>
                <strong>{timingInfo.isLocked ? 'Attendance Window Locked' : 'Attendance Window Open'}:</strong>{' '}
                Allowed punch timings are <strong>{timingInfo.timing.from}</strong> to <strong>{timingInfo.timing.to}</strong>.
                {timingInfo.isLocked && (
                  <div style={{ fontSize: '0.75rem', marginTop: 2 }}>
                    Current Time: {timingInfo.currentTime}. You cannot submit attendance outside permitted hours.
                  </div>
                )}
              </div>
            </div>
          )}

          {markSuccess && (
            <div style={{ background: '#dcfce7', color: '#166534', padding: '12px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 14 }}>
              {markSuccess}
            </div>
          )}

          {markError && (
            <div style={{ background: '#fee2e2', color: '#991b1b', padding: '12px 14px', borderRadius: 8, fontSize: '0.85rem', marginBottom: 14 }}>
              {markError}
            </div>
          )}

          <form onSubmit={handleMarkAttendance} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* GPS Location Display */}
            <div style={{ background: 'var(--emp-card-bg)', border: '1px solid var(--emp-border)', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--emp-text-muted)' }}>GPS Geolocation:</div>
              <div style={{ fontWeight: 700, fontSize: '0.88rem', marginTop: 2, color: 'var(--emp-primary)' }}>
                {locLoading ? 'Detecting GPS coordinates...' : location?.address || 'GPS detected'}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)', marginTop: 2 }}>
                Time: {new Date().toLocaleTimeString()} • {new Date().toLocaleDateString()}
              </div>
            </div>

            {/* Photo Capture - In-app Live Camera with Safe File Picker (Point 20 Fix) */}
            <div>
              <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--emp-text)', display: 'block', marginBottom: 6 }}>
                First Meeting Photo *
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handlePhotoUpload}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button
                  type="button"
                  className="emp-btn-primary"
                  style={{ padding: '12px 8px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  onClick={() => startLiveCamera('user')}
                  disabled={cameraBusy}
                >
                  <Icon name="camera" size={16} />
                  <span>{photo ? 'Retake via Camera' : 'Live Camera'}</span>
                </button>
                <button
                  type="button"
                  className="emp-btn-secondary"
                  style={{ padding: '12px 8px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Icon name="upload" size={16} />
                  <span>Choose Photo</span>
                </button>
              </div>

              {photo && (
                <div style={{ marginTop: 10, textAlign: 'center' }}>
                  <img src={photo} alt="Meeting preview" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 8, border: '2px solid #059669' }} />
                  <div style={{ fontSize: '0.72rem', color: '#059669', fontWeight: 700, marginTop: 4 }}>
                    ✓ Meeting Photo Ready
                  </div>
                </div>
              )}
            </div>

            {/* In-App Live Camera Modal (Point 20: Prevents Android Webview kill/crash) */}
            {showCamera && (
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  zIndex: 9999,
                  background: 'rgba(0,0,0,0.92)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  padding: 16,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff' }}>
                  <strong style={{ fontSize: '1rem' }}>First Meeting Live Camera</strong>
                  <button
                    type="button"
                    onClick={stopLiveCamera}
                    style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '1.4rem', cursor: 'pointer' }}
                  >
                    ✕
                  </button>
                </div>

                <div style={{ position: 'relative', width: '100%', maxHeight: '65vh', borderRadius: 12, overflow: 'hidden', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{ width: '100%', maxHeight: '65vh', objectFit: 'cover' }}
                  />
                  <div style={{ position: 'absolute', bottom: 10, left: 10, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '4px 8px', borderRadius: 4, fontSize: '0.72rem' }}>
                    {location?.address || 'GPS active'} · {new Date().toLocaleTimeString()}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', paddingBottom: 20 }}>
                  <button
                    type="button"
                    onClick={switchCamera}
                    style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', borderRadius: '50%', width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    title="Flip camera"
                  >
                    <Icon name="refresh" size={20} />
                  </button>
                  <button
                    type="button"
                    onClick={captureLivePhoto}
                    style={{
                      width: 68,
                      height: 68,
                      borderRadius: '50%',
                      background: '#fff',
                      border: '4px solid #10b981',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <div style={{ width: 50, height: 50, borderRadius: '50%', background: '#10b981' }} />
                  </button>
                  <button
                    type="button"
                    onClick={stopLiveCamera}
                    style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 12px', fontSize: '0.8rem' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <button
              type="submit"
              className="emp-btn-primary"
              style={{
                padding: '14px',
                fontSize: '1rem',
                fontWeight: 800,
                marginTop: 6,
                opacity: timingInfo?.isLocked ? 0.6 : 1,
                cursor: timingInfo?.isLocked ? 'not-allowed' : 'pointer',
              }}
              disabled={submitting || !photo || Boolean(timingInfo?.isLocked)}
            >
              {timingInfo?.isLocked
                ? '🔒 Attendance Locked (Outside Allowed Hours)'
                : submitting
                ? 'Marking Presence...'
                : '✓ Mark First Meeting Present'}
            </button>
          </form>
        </div>
      )}

      {activeTab === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Month Filter */}
          <div className="emp-card" style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 700 }}>Select Month:</label>
              <input
                type="month"
                className="emp-input"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                style={{ width: 160, padding: '4px 8px' }}
              />
            </div>
          </div>

          {/* Month Stats */}
          {historyData && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div className="emp-card" style={{ margin: 0, padding: 10, textAlign: 'center', background: '#ecfdf5', border: '1px solid #10b981' }}>
                <div style={{ fontSize: '0.72rem', color: '#047857' }}>Present</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#047857' }}>{historyData.summary?.present || 0}</div>
              </div>
              <div className="emp-card" style={{ margin: 0, padding: 10, textAlign: 'center', background: '#fef2f2', border: '1px solid #ef4444' }}>
                <div style={{ fontSize: '0.72rem', color: '#991b1b' }}>Absent</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#991b1b' }}>{historyData.summary?.absent || 0}</div>
              </div>
              <div className="emp-card" style={{ margin: 0, padding: 10, textAlign: 'center', background: '#fefce8', border: '1px solid #eab308' }}>
                <div style={{ fontSize: '0.72rem', color: '#854d0e' }}>Leaves</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#854d0e' }}>{historyData.summary?.leave || 0}</div>
              </div>
            </div>
          )}

          {/* Attendance Days List */}
          {historyLoading ? (
            <div style={{ textAlign: 'center', padding: '30px', color: 'var(--emp-text-muted)' }}>Loading history...</div>
          ) : !historyData?.days?.length ? (
            <div className="emp-card" style={{ textAlign: 'center', padding: '30px', color: 'var(--emp-text-muted)' }}>
              No attendance records found for {month}.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {historyData.days.map((d) => (
                <div key={d.date} className="emp-card" style={{ margin: 0, padding: '10px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{d.date}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--emp-text-muted)' }}>
                        {d.remark || (d.firstActivity ? `First Check-in: ${new Date(d.firstActivity).toLocaleTimeString()}` : 'Marked')}
                      </div>
                    </div>
                    <div>
                      <span className={`emp-badge ${d.status === 'present' ? 'emp-badge-success' : d.status === 'absent' ? 'emp-badge-danger' : 'emp-badge-warning'}`}>
                        {d.status?.toUpperCase()}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

