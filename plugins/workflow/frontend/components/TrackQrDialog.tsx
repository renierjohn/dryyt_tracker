import { useEffect, useRef } from 'react';
import { QrCode } from '../../../sdk';

// QR code of a transaction's public /track link, on the TransactionDialog
// overlay styles — for the customer to scan from the owner's screen.
export default function TrackQrDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const trackUrl = `${window.location.origin}/track?code=${encodeURIComponent(code)}`;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className="txn-dialog" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="txn-dialog__panel txn-dialog__panel--qr" role="dialog" aria-modal="true" aria-labelledby="txn-qr-title">
        <header className="txn-dialog__head">
          <div>
            <h2 id="txn-qr-title" className="txn-dialog__title">Track</h2>
            <code className="txn-dialog__code">{code}</code>
          </div>
          <button ref={closeRef} type="button" className="txn-dialog__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="txn-dialog__body txn-qr">
          <QrCode value={trackUrl} size={240} label={`QR code for ${trackUrl}`} />
          <a href={trackUrl} target="_blank" rel="noreferrer" className="txn-qr__url">{trackUrl}</a>
        </div>
      </div>
    </div>
  );
}
