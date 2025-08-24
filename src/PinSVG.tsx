import React, { useState, useId } from "react";

interface PinSVGProps {
  photoUrl: string;
  name: string;
  onPing?: () => void;
}

const PinSVG: React.FC<PinSVGProps> = ({ photoUrl, name, onPing }) => {
  const [mode, setMode] = useState<"ping" | "chat">("ping");
  const id = useId();

  const pinGradientId = `pinGradient-${id}`;
  const pingButtonGradientId = `pingButtonGradient-${id}`;
  const chatButtonGradientId = `chatButtonGradient-${id}`;
  const photoClipId = `photoClip-${id}`;
  const shadowId = `shadow-${id}`;

  const handleClick = () => {
    if (mode === "ping" && onPing) onPing();
    setMode((m) => (m === "ping" ? "chat" : "ping"));
  };

  const buttonGradient = mode === "ping" ? pingButtonGradientId : chatButtonGradientId;
  const aria = mode === "ping" ? "Ping user" : "Chat with user";

  return (
    <svg
      width={240}
      height={320}
      viewBox="0 0 240 320"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={pinGradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF3366" />
          <stop offset="100%" stopColor="#FF6F91" />
        </linearGradient>
        <linearGradient id={pingButtonGradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF3366" />
          <stop offset="100%" stopColor="#FF6F91" />
        </linearGradient>
        <linearGradient id={chatButtonGradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#60A5FA" />
        </linearGradient>
        <clipPath id={photoClipId}>
          <circle cx="120" cy="120" r="90" />
        </clipPath>
        <filter id={shadowId} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="4" stdDeviation="4" floodOpacity="0.2" />
        </filter>
      </defs>
      <path
        d="M120 0C186 0 240 54 240 120C240 220 120 320 120 320C120 320 0 220 0 120C0 54 54 0 120 0Z"
        fill={`url(#${pinGradientId})`}
        filter={`url(#${shadowId})`}
      />
      <image
        href={photoUrl}
        x="30"
        y="30"
        width="180"
        height="180"
        clipPath={`url(#${photoClipId})`}
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
          x="60"
          y="255"
          width="120"
          height="40"
          rx="20"
          fill={`url(#${buttonGradient})`}
        />
        <g
          transform="translate(60,255)"
          className={`pin-btn-text ${mode === "ping" ? "visible" : "hidden"}`}
        >
          <svg x="20" y="10" width="20" height="20" viewBox="0 0 20 20">
            <path
              d="M10 2a6 6 0 0 0-6 6c0 1.887-.454 3.665-1.257 5.234a.75.75 0 0 0 .515 1.076 32.906 32.906 0 0 0 3.25.508 3.5 3.5 0 0 0 6.972 0 32.903 32.903 0 0 0 3.256-.508.75.75 0 0 0 .515-1.076A11.448 11.448 0 0 1 16 8a6 6 0 0 0-6-6ZM8.05 14.943a33.54 33.54 0 0 0 3.9 0 2 2 0 0 1-3.9 0Z"
              fill="#fff"
            />
          </svg>
          <text x="52" y="20" textAnchor="start" dominantBaseline="middle">
            Ping
          </text>
        </g>
        <g
          transform="translate(60,255)"
          className={`pin-btn-text ${mode === "chat" ? "visible" : "hidden"}`}
        >
          <svg x="20" y="10" width="20" height="20" viewBox="0 0 24 24">
            <path
              d="M5.25001 8.9998C5.25012 5.27197 8.27215 2.25 12 2.25C15.7279 2.25 18.75 5.27208 18.75 9L18.7498 9.04919V9.75C18.7498 11.8731 19.5508 13.8074 20.8684 15.2699C21.0349 15.4547 21.0989 15.71 21.0393 15.9516C20.9797 16.1931 20.8042 16.3893 20.5709 16.4755C19.0269 17.0455 17.4105 17.4659 15.7396 17.7192C15.7465 17.812 15.75 17.9056 15.75 18C15.75 20.0711 14.0711 21.75 12 21.75C9.92894 21.75 8.25001 20.0711 8.25001 18C8.25001 17.9056 8.25351 17.812 8.2604 17.7192C6.58934 17.4659 4.97287 17.0455 3.42875 16.4755C3.19539 16.3893 3.01992 16.1931 2.96033 15.9516C2.90073 15.71 2.96476 15.4547 3.13126 15.2699C4.44879 13.8074 5.24981 11.8731 5.24981 9.75L5.25001 8.9998ZM9.75221 17.8993C9.75075 17.9326 9.75001 17.9662 9.75001 18C9.75001 19.2426 10.7574 20.25 12 20.25C13.2427 20.25 14.25 19.2426 14.25 18C14.25 17.9662 14.2493 17.9326 14.2478 17.8992C13.5072 17.9659 12.7574 18 11.9998 18C11.2424 18 10.4927 17.966 9.75221 17.8993Z"
              fill="#fff"
            />
          </svg>
          <text x="52" y="20" textAnchor="start" dominantBaseline="middle">
            Chat
          </text>
        </g>
      </g>
    </svg>
  );
};

export default PinSVG;
