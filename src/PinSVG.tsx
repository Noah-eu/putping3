import React from "react";

interface PinSVGProps {
  photoUrl: string;
  name: string;
  onPing?: () => void;
}

const PinSVG: React.FC<PinSVGProps> = ({ photoUrl, name, onPing }) => (
  <svg
    width={240}
    height={320}
    viewBox="0 0 240 320"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="pinGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#FF3366" />
        <stop offset="100%" stopColor="#FF6F91" />
      </linearGradient>
      <linearGradient id="buttonGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#FF3366" />
        <stop offset="100%" stopColor="#FF6F91" />
      </linearGradient>
      <clipPath id="photoClip">
        <circle cx="120" cy="120" r="90" />
      </clipPath>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="4" stdDeviation="4" floodOpacity="0.2" />
      </filter>
    </defs>
    <path
      d="M120 0C186 0 240 54 240 120C240 220 120 320 120 320C120 320 0 220 0 120C0 54 54 0 120 0Z"
      fill="url(#pinGradient)"
      filter="url(#shadow)"
    />
    <image
      href={photoUrl}
      x="30"
      y="30"
      width="180"
      height="180"
      clipPath="url(#photoClip)"
      preserveAspectRatio="xMidYMid slice"
    />
    <circle
      cx="120"
      cy="120"
      r="90"
      fill="none"
      stroke="#FFF"
      strokeWidth="6"
    />
    <text
      x="120"
      y="225"
      textAnchor="middle"
      fontSize="24"
      fontFamily="sans-serif"
      fill="#FFF"
    >
      {name}
    </text>
    <g
      onClick={onPing}
      onKeyDown={(e) => {
        if (onPing && (e.key === "Enter" || e.key === " " || e.key === "Spacebar")) {
          e.preventDefault();
          onPing();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label="Ping user"
      style={{ cursor: "pointer" }}
    >
      <path
        d="M70 250 Q70 230 120 230 Q170 230 170 250 Q170 270 120 290 Q70 270 70 250 Z"
        fill="url(#buttonGradient)"
      />
      <path
        d="M12 22a2 2 0 01-4 0h4zm6-6V9a6 6 0 10-12 0v7H4v2h16v-2h-2z"
        transform="translate(95 250) scale(0.7)"
        fill="#FFF"
      />
      <text
        x="135"
        y="267"
        textAnchor="middle"
        fontSize="16"
        fontFamily="sans-serif"
        fill="#FFF"
      >
        Ping
      </text>
    </g>
  </svg>
);

export default PinSVG;
