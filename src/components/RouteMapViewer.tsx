import React from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import type { MetricStreamPoint } from '../types';

interface RouteMapViewerProps {
  streamPoints?: MetricStreamPoint[];
  title?: string;
}

// Custom SVG map icons
const startIcon = L.divIcon({
  className: 'custom-map-icon',
  html: `<div style="background-color:#10B981; width:12px; height:12px; border-radius:50%; border:2px solid white; box-shadow:0 0 10px #10B981;"></div>`,
  iconSize: [12, 12],
  iconAnchor: [6, 6]
});

const endIcon = L.divIcon({
  className: 'custom-map-icon',
  html: `<div style="background-color:#F43F5E; width:12px; height:12px; border-radius:50%; border:2px solid white; box-shadow:0 0 10px #F43F5E;"></div>`,
  iconSize: [12, 12],
  iconAnchor: [6, 6]
});

export const RouteMapViewer: React.FC<RouteMapViewerProps> = ({ streamPoints, title }) => {
  if (!streamPoints || streamPoints.length === 0) {
    return (
      <div className="w-full h-64 rounded-xl bg-slate-900/60 border border-white/10 flex flex-col items-center justify-center p-6 text-center text-slate-400">
        <p className="text-sm font-medium">Indoor Activity / GPS Stream Unavailable</p>
        <p className="text-xs text-slate-500 mt-1">Zwift or Stationary Indoor Session</p>
      </div>
    );
  }

  // Extract lat/lng pairs
  const positions: [number, number][] = streamPoints
    .filter((p) => p.lat !== undefined && p.lng !== undefined)
    .map((p) => [p.lat!, p.lng!]);

  if (positions.length === 0) {
    return (
      <div className="w-full h-64 rounded-xl bg-slate-900/60 border border-white/10 flex items-center justify-center text-slate-400 text-sm">
        No valid GPS coordinates in activity stream
      </div>
    );
  }

  const center = positions[Math.floor(positions.length / 2)];
  const startPos = positions[0];
  const endPos = positions[positions.length - 1];

  return (
    <div className="w-full h-72 rounded-xl overflow-hidden border border-white/10 relative shadow-lg">
      <MapContainer 
        center={center} 
        zoom={11} 
        scrollWheelZoom={false}
        className="w-full h-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Polyline 
          positions={positions} 
          pathOptions={{ color: '#00F0FF', weight: 4, opacity: 0.9 }} 
        />
        <Marker position={startPos} icon={startIcon}>
          <Popup>Start: {title}</Popup>
        </Marker>
        <Marker position={endPos} icon={endIcon}>
          <Popup>Finish: {title}</Popup>
        </Marker>
      </MapContainer>
      <div className="absolute bottom-2 left-2 z-[1000] glass-panel px-3 py-1 rounded-md text-[11px] font-mono text-cyan-300 border border-white/10">
        GPS Polyline ({positions.length} coordinates)
      </div>
    </div>
  );
};
