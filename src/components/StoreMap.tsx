import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../assets/sass/store.scss';

// Leaflet's default marker loads its PNGs by URL, which bundlers break — a
// CSS-drawn pin avoids that and follows the theme's accent color.
const PIN = L.divIcon({
  className: 'store-map__pin',
  html: '<span></span>',
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

const WORLD: L.LatLngTuple = [20, 0];

// OpenStreetMap with a single pin. With onMove, the pin is draggable and a click
// on the map moves it there too.
export default function StoreMap({
  lat,
  lng,
  onMove,
  className,
}: {
  lat: number | null;
  lng: number | null;
  onMove?: (lat: number, lng: number) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onMoveRef = useRef(onMove);

  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  useEffect(() => {
    const map = L.map(containerRef.current!, { scrollWheelZoom: false }).setView(WORLD, 2);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    if (onMoveRef.current) {
      map.on('click', (e) => onMoveRef.current?.(e.latlng.lat, e.latlng.lng));
    }
    mapRef.current = map;
    // The container can resize after mount (e.g. stretching to match a
    // neighbouring column once its image loads) — Leaflet must re-measure.
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(containerRef.current!);
    return () => {
      resize.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (lat == null || lng == null) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      const marker = L.marker([lat, lng], { icon: PIN, draggable: Boolean(onMoveRef.current), keyboard: false });
      marker.on('dragend', () => {
        const p = marker.getLatLng();
        onMoveRef.current?.(p.lat, p.lng);
      });
      markerRef.current = marker.addTo(map);
    } else {
      markerRef.current.setLatLng([lat, lng]);
    }
    map.setView([lat, lng], Math.max(map.getZoom(), 16));
  }, [lat, lng]);

  return <div ref={containerRef} className={`store-map${className ? ` ${className}` : ''}`} />;
}
