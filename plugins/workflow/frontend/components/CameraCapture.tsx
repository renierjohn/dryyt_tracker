import { useEffect, useRef, useState } from 'react';

// Full-screen camera dialog (getUserMedia): live preview of the back camera,
// one shutter button, returns the frame as a JPEG File. Needs a secure context
// (https or localhost) and the browser's camera permission.
export default function CameraCapture({ onCapture, onClose }: { onCapture: (file: File) => void; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
    let stream: MediaStream | null = null;
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser can’t open the camera.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        setReady(true);
      } catch (err) {
        console.error('Camera unavailable', err);
        setError(
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Camera permission was denied.'
            : 'No camera available.',
        );
      }
    }
    void start();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function handleCapture() {
    const video = videoRef.current!;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92,
    );
  }

  return (
    <dialog
      ref={dialogRef}
      className="camera-capture"
      aria-label="Capture with camera"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <video ref={videoRef} className="camera-capture__video" playsInline muted />
      {error && <p className="camera-capture__error" role="alert">{error}</p>}
      <div className="camera-capture__actions">
        <button type="button" className="m3-button m3-button--tonal" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="camera-capture__shutter"
          onClick={handleCapture}
          disabled={!ready}
          aria-label="Take photo"
        />
        <span className="camera-capture__spacer" />
      </div>
    </dialog>
  );
}
