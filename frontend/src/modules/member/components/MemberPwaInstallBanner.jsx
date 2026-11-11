import { useEffect, useState } from 'react';
import Icon from '../../../components/Icon.jsx';

export default function MemberPwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(() => window.__pwaInstallPrompt || null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    return sessionStorage.getItem('udgam_mem_pwa_dismissed') === 'true';
  });

  useEffect(() => {
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
        setShowGuide(true);
      }
    } else {
      setShowGuide(true);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('udgam_mem_pwa_dismissed', 'true');
  };

  if (isStandalone || dismissed) {
    return null;
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  return (
    <>
      <div
        style={{
          background: 'linear-gradient(135deg, #059669, #044e3b)',
          color: '#ffffff',
          borderRadius: 14,
          padding: '12px 14px',
          margin: '0 0 16px 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          boxShadow: '0 8px 24px rgba(5, 150, 105, 0.3)',
          border: '1px solid rgba(245, 158, 11, 0.4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <img
            src="/icon-member-192.png"
            alt="Udgam Member"
            style={{
              width: 42,
              height: 42,
              borderRadius: 10,
              flexShrink: 0,
              border: '1px solid rgba(245, 158, 11, 0.5)',
              boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: '0.92rem', lineHeight: 1.2, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>Member App</span>
              <span style={{ fontSize: '0.62rem', background: '#f59e0b', color: '#000', padding: '1px 6px', borderRadius: 6, fontWeight: 800 }}>PWA</span>
            </div>
            <div style={{ fontSize: '0.72rem', opacity: 0.9, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Phone me alag Member App install karein
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
          >
            <Icon name="cross" size={12} />
          </button>
        </div>
      </div>

      {showGuide && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
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
              background: '#041f1a',
              color: '#f8fafc',
              borderRadius: 16,
              padding: 20,
              maxWidth: 420,
              width: '100%',
              border: '1px solid rgba(5, 150, 105, 0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <strong>Install Udgam Member App</strong>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <Icon name="cross" size={18} />
              </button>
            </div>

            <div style={{ fontSize: '0.84rem', color: '#cbd5e1', lineHeight: 1.5 }}>
              {isIOS ? (
                <div>
                  1. Safari me neeche <strong>Share icon (⬆️)</strong> par tap karein.<br />
                  2. Menu me <strong>"Add to Home Screen" (➕)</strong> chunein.<br />
                  3. <strong>"Add"</strong> tap karein. App install ho jayegi!
                </div>
              ) : (
                <div>
                  1. Chrome browser me upar <strong>3 dots (⋮)</strong> par tap karein.<br />
                  2. <strong>"Install app"</strong> ya <strong>"Add to Home screen"</strong> chunein.<br />
                  3. <strong>"Install"</strong> par tap karein.
                </div>
              )}
            </div>

            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button
                type="button"
                className="mem-btn sm"
                onClick={() => setShowGuide(false)}
                style={{ width: 'auto' }}
              >
                Theek Hai
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

