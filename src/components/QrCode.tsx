import { useEffect, useState } from 'react';

// QR code for `value`, rendered client-side to an <img> (qrcode is loaded on demand).
export default function QrCode({ value, size = 160, label }: { value: string; size?: number; label: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import('qrcode').then(({ toDataURL }) =>
      toDataURL(value, { width: size * 2, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#202124', light: '#ffffff' } }),
    ).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return src ? (
    <img className="qr-code" src={src} width={size} height={size} alt={label} />
  ) : (
    <span className="qr-code qr-code--loading" style={{ width: size, height: size }} aria-hidden="true" />
  );
}
