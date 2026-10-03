import { useEffect, useRef } from 'react';
import { RichText, useColorbox } from '../../../sdk';

export interface DialogTransaction {
  id: number;
  code: string | null;
  customer_name: string | null;
  description: string | null;
  image_ids?: number[];
}

// Full description (and photos, for the owner) of one transaction. A plain
// fixed overlay rather than <dialog showModal>: the top layer would sit above
// Colorbox's lightbox, hiding the zoomed photo.
export default function TransactionDialog({ transaction, onClose }: { transaction: DialogTransaction; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const photos = transaction.image_ids ?? [];
  useColorbox(panelRef, photos.join(','));

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      // Let Colorbox handle Esc while it's open.
      if (e.key === 'Escape' && !document.getElementById('colorbox')?.offsetParent) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const gallery = `txn-${transaction.id}`;

  return (
    <div className="txn-dialog" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panelRef} className="txn-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="txn-dialog-title">
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

          {photos.length > 0 && (
            <>
              <h3 className="m3-section-title txn-dialog__photos-title">Photos</h3>
              <ul className="txn-dialog__photos">
                {photos.map((imageId, i) => {
                  const src = `/api/plugins/workflow/transactions/${transaction.id}/images/${imageId}`;
                  return (
                    <li key={imageId}>
                      <a href={src} data-colorbox={gallery} title={`Photo ${i + 1}`}>
                        <img src={src} alt={`Photo ${i + 1}`} loading="lazy" />
                      </a>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
