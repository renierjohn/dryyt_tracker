import { useEffect, useRef, type ReactNode } from 'react';
import '../assets/sass/dialog.scss';

// Native modal <dialog>: focus trapping, Esc and the backdrop come for free.
export default function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    // Guarded: StrictMode runs this twice, and showModal() throws when already
    // open. No close() in cleanup — that fires the close event (→ onClose),
    // which would unmount the dialog right after opening; removing the element
    // takes it out of the top layer anyway.
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="admin__dialog"
      aria-label={title}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <header className="admin__dialog-head">
        <h2>{title}</h2>
        <button type="button" className="admin__dialog-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="admin__dialog-body">{children}</div>
    </dialog>
  );
}
