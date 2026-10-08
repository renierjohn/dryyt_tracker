import { useEffect, useRef, useState, type ReactNode } from 'react';

// A horizontally scrollable table wrapper (.m3-table-wrap by default) with a "Scroll right" hint above it,
// shown only while the content overflows and isn't scrolled to the end.
export default function ScrollHintWrap({
  className = 'm3-table-wrap',
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, []);

  return (
    <>
      {more && (
        <p className="m3-scroll-hint" aria-hidden="true">
          Scroll right to see more →
        </p>
      )}
      <div ref={ref} className={className}>
        {children}
      </div>
    </>
  );
}
