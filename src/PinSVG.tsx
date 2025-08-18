import React, { useState } from "react";

interface PinSVGProps {
  photoUrl: string;
  name: string;
  onPing?: () => void;
}

const PinSVG: React.FC<PinSVGProps> = ({ photoUrl, name, onPing }) => {
  const [mode, setMode] = useState<"ping" | "chat">("ping");
  const [rippleKey, setRippleKey] = useState(0);

  const handleClick = () => {
    if (mode === "ping" && onPing) onPing();
    setMode((m) => (m === "ping" ? "chat" : "ping"));
    setRippleKey((k) => k + 1);
  };

  const buttonGradient = mode === "ping" ? "pingButtonGradient" : "chatButtonGradient";
  const rippleColor = mode === "ping" ? "#FF6F91" : "#60A5FA";
  const aria = mode === "ping" ? "Ping user" : "Chat with user";

  return (
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
        <linearGradient id="pingButtonGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF3366" />
          <stop offset="100%" stopColor="#FF6F91" />
        </linearGradient>
        <linearGradient id="chatButtonGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#60A5FA" />
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
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
            e.preventDefault();
            handleClick();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={aria}
        style={{ cursor: "pointer" }}
      >
        <rect
          x="70"
          y="240"
          width="100"
          height="40"
          rx="10"
          ry="10"
          fill={`url(#${buttonGradient})`}
        />
        <circle
          key={rippleKey}
          cx="120"
          cy="260"
          r="30"
          fill={rippleColor}
          className="pin-ripple"
        />
        <text
          x="120"
          y="260"
          textAnchor="middle"
          dominantBaseline="middle"
          className={`pin-btn-text ${mode === "ping" ? "visible" : "hidden"}`}
        >
          🔔 Ping
        </text>
        <text
          x="120"
          y="260"
          textAnchor="middle"
          dominantBaseline="middle"
          className={`pin-btn-text ${mode === "chat" ? "visible" : "hidden"}`}
        >
          💬 Chat
        </text>
      </g>
    </svg>
  );
};

export default PinSVG;
