import { useEffect, useRef, useState, type MouseEvent } from 'react';
import '../assets/sass/lightbox.scss';

const ZOOM = 2.5;

// Full-screen image viewer: tap/click toggles a zoom centred on that point,
// and the zoomed image scrolls (or pans by touch). Esc, the × button or a
// click on the backdrop closes it.
export default function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Zoomed width in px (ZOOM × the fitted width), or null when fitted.
  const [zoomWidth, setZoomWidth] = useState<number | null>(null);
  const zoomed = zoomWidth !== null;
  // Where to scroll after zooming in: the clicked point, as fractions of the image.
  const focus = useRef({ x: 0.5, y: 0.5 });

  useEffect(() => {
    // Guarded: StrictMode runs this twice, and showModal() throws when already open.
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!zoomed || !stage) return;
    stage.scrollLeft = focus.current.x * stage.scrollWidth - stage.clientWidth / 2;
    stage.scrollTop = focus.current.y * stage.scrollHeight - stage.clientHeight / 2;
  }, [zoomed]);

  function toggleZoom(e: MouseEvent<HTMLImageElement>) {
    e.stopPropagation();
    const box = e.currentTarget.getBoundingClientRect();
    focus.current = { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height };
    setZoomWidth(zoomed ? null : box.width * ZOOM);
  }

  return (
    <dialog
      ref={ref}
      className="lightbox"
      aria-label={alt}
      // Esc: close via React state rather than waiting on the native close event.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <div
        ref={stageRef}
        className={`lightbox__stage${zoomed ? ' lightbox__stage--zoomed' : ''}`}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <img
          className="lightbox__img"
          src={src}
          alt={alt}
          style={zoomed ? { width: zoomWidth, maxWidth: 'none', maxHeight: 'none' } : undefined}
          onClick={toggleZoom}
        />
      </div>
      <button type="button" className="lightbox__close" aria-label="Close" onClick={onClose}>
        ×
      </button>
    </dialog>
  );
}
