import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import jsQR from 'jsqr';
import { apiFetch, ApiError, useSession, AppShell } from '../../../sdk';
import '../workflow.scss';

const ERRORS: Record<string, string> = {
  not_found: 'No transaction of yours matches that code.',
  not_ready_for_pickup: 'That transaction isn’t ready for pickup.',
  missing_code: 'Enter a code.',
};

// The QR on /track encodes the bare code; accept a /track?code= link too.
function codeFromQr(data: string): string {
  try {
    return new URL(data).searchParams.get('code') ?? data;
  } catch {
    return data;
  }
}

// Owner-only: scan the QR a customer shows from /track. A match that's
// 'ready_to_pickup' moves to 'end' (POST /pickup), then back to the Tracker.
export default function ScanPickupPage() {
  const { user, refresh } = useSession();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  // Set while a code is being submitted, so the scan loop ignores new frames.
  const busyRef = useRef(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');

  async function submit(code: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    try {
      await apiFetch('/plugins/workflow/pickup', { method: 'POST', body: JSON.stringify({ code: code.trim() }) });
      window.alert('Success');
      navigate('/plugins/workflow');
    } catch (err) {
      const key = err instanceof ApiError ? err.code : 'unknown_error';
      setError(`${code.trim().toUpperCase()}: ${ERRORS[key] ?? key}`);
      // Hold off a moment so the same QR still in frame doesn't re-submit instantly.
      setTimeout(() => {
        busyRef.current = false;
      }, 2000);
    }
  }
  // The scan loop starts once; it reaches the latest submit through this ref.
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let cancelled = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    function tick() {
      const video = videoRef.current;
      if (cancelled || !video) return;
      if (!busyRef.current && video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth) {
        // Downscale: jsQR is plenty accurate at ~640px and much cheaper.
        const scale = Math.min(1, 640 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qr = jsQR(data, width, height, { inversionAttempts: 'dontInvert' });
        if (qr?.data) void submitRef.current(codeFromQr(qr.data));
      }
      frame = requestAnimationFrame(tick);
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('This browser can’t open the camera.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        frame = requestAnimationFrame(tick);
      } catch (err) {
        console.error('Camera unavailable', err);
        setCameraError(
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Camera permission was denied.'
            : 'No camera available.',
        );
      }
    }
    void start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function handleManual(e: FormEvent) {
    e.preventDefault();
    void submit(manualCode);
  }

  return (
    <AppShell active="scan" user={user} refresh={refresh} contentClassName="m3-page">
      <p className="m3-supporting">Scan the QR code to End Transaction.</p>
      <section className="scan-pickup">
        {error && <p className="m3-banner m3-banner--error" role="alert">{error}</p>}
        <div className="scan-pickup__viewport">
          <video ref={videoRef} className="scan-pickup__video" playsInline muted />
          {cameraError ? (
            <p className="scan-pickup__camera-error" role="alert">{cameraError}</p>
          ) : (
            <span className="scan-pickup__frame" aria-hidden="true" />
          )}
        </div>
        <p>Point the camera at the customer’s QR code.</p>
        <form className="m3-form" onSubmit={handleManual}>
          <label>
            Or enter the code
            <input
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={6}
            />
          </label>
          <button type="submit" className="m3-button m3-button--tonal">Pick up</button>
        </form>
      </section>
    </AppShell>
  );
}
