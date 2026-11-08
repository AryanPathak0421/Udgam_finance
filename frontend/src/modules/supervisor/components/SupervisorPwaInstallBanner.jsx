import { useEffect, useState } from 'react';
import Icon from '../../../components/Icon.jsx';

export default function SupervisorPwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(() => window.__pwaInstallPrompt || null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    return sessionStorage.getItem('udgam_sup_pwa_dismissed') === 'true';
  });

  useEffect(() => {
    // Check if running as installed standalone PWA
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    setIsStandalone(standalone);

    const onPromptAvailable = (e) => {
      setDeferredPrompt(e.detail || window.__pwaInstallPrompt);
    };

    const onBeforeInstall = (e) => {
      e.preventDefault();
      window.__pwaInstallPrompt = e;
      setDeferredPrompt(e);
    };

    const onInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };

    window.addEventListener('pwa-prompt-available', onPromptAvailable);
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('pwa-installed', onInstalled);
    window.addEventListener('appinstalled', onInstalled);

    if (window.__pwaInstallPrompt) {
      setDeferredPrompt(window.__pwaInstallPrompt);
    }

    return () => {
      window.removeEventListener('pwa-prompt-available', onPromptAvailable);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('pwa-installed', onInstalled);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    const promptEvent = deferredPrompt || window.__pwaInstallPrompt;
    if (promptEvent) {
      try {
        promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        if (outcome === 'accepted') {
          setDeferredPrompt(null);
          window.__pwaInstallPrompt = null;
        }
      } catch (err) {
        console.warn('Install prompt error:', err);
        setShowGuide(true);
      }
    } else {
      setShowGuide(true);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('udgam_sup_pwa_dismissed', 'true');
  };

  // Do not show if already running in standalone mode or dismissed
  if (isStandalone || dismissed) {
    return null;
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  return (
    <>
      <div
        style={{
          background: 'linear-gradient(135deg, #0f766e, #042f2e)',
          color: '#ffffff',
          borderRadius: 14,
          padding: '12px 14px',
          margin: '0 0 16px 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          boxShadow: '0 8px 24px rgba(15, 118, 110, 0.3)',
          border: '1px solid rgba(245, 158, 11, 0.4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: 'rgba(255, 255, 255, 0.15)',
              color: '#fef08a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              border: '1px solid rgba(254, 240, 138, 0.3)',
            }}
          >
            <Icon name="shield" size={22} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: '0.92rem', lineHeight: 1.2, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>Supervisor App</span>
              <span style={{ fontSize: '0.62rem', background: '#f59e0b', color: '#000', padding: '1px 6px', borderRadius: 6, fontWeight: 800 }}>PWA</span>
            </div>
            <div style={{ fontSize: '0.72rem', opacity: 0.9, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Phone me App install karein (Fast access)
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            onClick={handleInstallClick}
            style={{
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              color: '#ffffff',
              border: 'none',
              borderRadius: 8,
              padding: '7px 13px',
              fontSize: '0.78rem',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            }}
          >
            <Icon name="download" size={14} />
            <span>Install</span>
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            style={{
              background: 'rgba(255, 255, 255, 0.15)',
              border: 'none',
              color: '#ffffff',
              borderRadius: '50%',
              width: 26,
              height: 26,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
            title="Dismiss"
            aria-label="Dismiss install banner"
          >
            <Icon name="cross" size={12} />
          </button>
        </div>
      </div>

      {/* Installation Guide Modal for devices where prompt is not auto-triggered */}
      {showGuide && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            backdropFilter: 'blur(3px)',
          }}
          onClick={() => setShowGuide(false)}
        >
          <div
            style={{
              background: '#0b131f',
              color: '#f8fafc',
              borderRadius: 16,
              padding: 20,
              maxWidth: 420,
              width: '100%',
              border: '1px solid rgba(15, 118, 110, 0.5)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: '#0f766e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="shield" size={18} />
                </div>
                <div style={{ fontWeight: 800, fontSize: '1rem' }}>Install Supervisor App</div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}
              >
                <Icon name="cross" size={18} />
              </button>
            </div>

            <div style={{ fontSize: '0.82rem', color: '#94a3b8', marginBottom: 16, lineHeight: 1.4 }}>
              Yeh ek <strong>Progressive Web App (PWA)</strong> hai. Isme kisi alag <code style={{ color: '#f59e0b' }}>.apk</code> file ko download karne ki zaroorat nahi hai. Yeh seedhe aapke phone ki screen par app ban kar jud jati hai:
            </div>

            {isIOS ? (
              <div style={{ background: '#131e2e', padding: 14, borderRadius: 12, border: '1px solid #1e293b' }}>
                <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#38bdf8', marginBottom: 8 }}>
                  iPhone / Safari me install kaise karein:
                </div>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: '0.82rem', lineHeight: 1.6, color: '#e2e8f0' }}>
                  <li>Neeche Safari ke <strong>Share icon</strong> (⬆️) par tap karein.</li>
                  <li>Menu me scroll karke <strong>"Add to Home Screen"</strong> (➕) chunein.</li>
                  <li>Upar right me <strong>"Add"</strong> tap karein. App screen par install ho jayegi!</li>
                </ol>
              </div>
            ) : (
              <div style={{ background: '#131e2e', padding: 14, borderRadius: 12, border: '1px solid #1e293b' }}>
                <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#10b981', marginBottom: 8 }}>
                  Android / Chrome me install kaise karein:
                </div>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: '0.82rem', lineHeight: 1.6, color: '#e2e8f0' }}>
                  <li>Chrome browser me upar right me <strong>3 dots (⋮)</strong> par tap karein.</li>
                  <li>Menu me se <strong>"Install app"</strong> ya <strong>"Add to Home screen"</strong> par tap karein.</li>
                  <li><strong>"Install"</strong> par click karein. 5 second me app aapke phone ke app drawer me jud jayegi!</li>
                </ol>
              </div>
            )}

            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                style={{
                  background: '#0f766e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 18px',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Theek Hai, Samajh Gaya
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
