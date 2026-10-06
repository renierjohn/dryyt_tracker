import { useEffect, useRef } from 'react';
import { RichText } from '../../../sdk';

export interface DialogTransaction {
  id: number;
  code: string | null;
  customer_name: string | null;
  description: string | null;
}

// Full description of one transaction, as a plain fixed overlay.
export default function TransactionDialog({ transaction, onClose }: { transaction: DialogTransaction; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

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
      <div className="txn-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="txn-dialog-title">
        <header className="txn-dialog__head">
          <div>
            <h2 id="txn-dialog-title" className="txn-dialog__title">{transaction.customer_name}</h2>
            {transaction.code && <code className="txn-dialog__code">{transaction.code}</code>}
          </div>
          <button ref={closeRef} type="button" className="txn-dialog__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="txn-dialog__body">
          {transaction.description ? (
            <RichText html={transaction.description} />
          ) : (
            <p className="m3-supporting">No description.</p>
          )}
        </div>
      </div>
    </div>
  );
}
