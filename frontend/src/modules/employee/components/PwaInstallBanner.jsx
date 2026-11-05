import { useEffect, useState } from 'react';
import Icon from '../../../components/Icon.jsx';

export default function PwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    return sessionStorage.getItem('udgam_pwa_dismissed') === 'true';
  });

  useEffect(() => {
    // Check if running as installed standalone PWA
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    setIsStandalone(standalone);

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('udgam_pwa_dismissed', 'true');
  };

  // Do not show if already installed in standalone mode, or dismissed, or no prompt event
  if (isStandalone || dismissed || !deferredPrompt) {
    return null;
  }

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #107870, #0b5d57)',
        color: '#ffffff',
        borderRadius: 14,
        padding: '14px 16px',
        margin: '0 0 16px 0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        boxShadow: '0 8px 20px rgba(16, 120, 112, 0.25)',
        border: '1px solid rgba(254, 186, 16, 0.3)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
        <img
          src="/logo.png"
          alt="Udgam"
          style={{ width: 40, height: 40, borderRadius: 10, background: '#fff', padding: 3, flexShrink: 0 }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: '0.92rem', lineHeight: 1.2 }}>Install Udgam Staff App</div>
          <div style={{ fontSize: '0.75rem', opacity: 0.9, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Fast access &amp; fullscreen app experience
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button
          type="button"
          onClick={handleInstallClick}
          style={{
            background: '#feba10',
            color: '#1a202c',
            border: 'none',
            borderRadius: 8,
            padding: '7px 14px',
            fontSize: '0.8rem',
            fontWeight: 800,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
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
  );
}
