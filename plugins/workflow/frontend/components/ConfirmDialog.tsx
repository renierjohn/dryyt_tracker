import { useEffect, useRef, type ReactNode } from 'react';

// Small confirm modal on the TransactionDialog overlay styles. Esc or a click
// outside the panel cancels.
export default function ConfirmDialog({
  title,
  actions,
  onCancel,
  children,
}: {
  title: string;
  actions: ReactNode;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Latest onCancel without re-running the effect (which moves focus) each render.
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancelRef.current();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div className="txn-dialog" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="txn-dialog__panel txn-dialog__panel--confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <header className="txn-dialog__head">
          <h2 id="confirm-dialog-title" className="txn-dialog__title">{title}</h2>
        </header>
        <div className="txn-dialog__body">{children}</div>
        <div className="txn-dialog__actions">
          <button ref={cancelRef} type="button" className="m3-button m3-button--tonal" onClick={onCancel}>
            Cancel
          </button>
          {actions}
        </div>
      </div>
    </div>
  );
}
