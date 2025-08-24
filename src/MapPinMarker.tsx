import React, { useId } from "react";

interface MapPinMarkerProps {
  onPing?: () => void;
}

const MapPinMarker: React.FC<MapPinMarkerProps> = ({ onPing }) => {
  const rawId = useId();
  const gradientId = `markerGradient-${rawId.replace(/:/g, "")}`;

  return (
    <svg
      width={80}
      height={112}
      viewBox="0 0 80 112"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF3366" />
          <stop offset="100%" stopColor="#FF6F91" />
        </linearGradient>
      </defs>
      <path
        d="M40 0C62 0 80 18 80 40C80 73 40 112 40 112C40 112 0 73 0 40C0 18 18 0 40 0Z"
        fill={`url(#${gradientId})`}
      />
      <g
        onClick={() => onPing && onPing()}
        role="button"
        tabIndex={0}
        style={{ cursor: "pointer" }}
      >
        <polygon points="20,80 60,80 40,112" fill="#FF69B4" />
        <text
          x="40"
          y="92"
          textAnchor="middle"
          fontSize="12"
          fontFamily="sans-serif"
          fill="#FFF"
        >
          Ping
        </text>
      </g>
    </svg>
  );
};

export default MapPinMarker;

