/// <reference types="jquery.colorbox" />
import { useEffect, type RefObject } from 'react';

const OPTIONS = {
  photo: true,
  scalePhotos: true,
  maxWidth: '95%',
  maxHeight: '95%',
  current: '{current} / {total}',
};

// Binds Colorbox (jQuery lightbox) to every `a[data-colorbox]` inside the
// container — links sharing a data-colorbox value form one gallery. Re-binds
// when `key` changes (e.g. the photos rendered changed). jQuery + Colorbox are
// loaded on first use only.
export function useColorbox(containerRef: RefObject<HTMLElement | null>, key: unknown) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let bound: JQuery | null = null;

    void import('./colorbox/load').then(({ default: $ }) => {
      if (cancelled) return;
      bound = $(container).find('a[data-colorbox]');
      bound.each(function () {
        $(this).colorbox({ ...OPTIONS, rel: $(this).attr('data-colorbox') });
      });
    });

    return () => {
      cancelled = true;
      // Colorbox handles clicks through a delegated listener on `.cboxElement`.
      bound?.removeClass('cboxElement').removeData('colorbox');
    };
  }, [containerRef, key]);
}
