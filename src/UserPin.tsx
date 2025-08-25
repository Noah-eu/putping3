import React from "react";

interface UserPinProps {
  photoUrl: string;
  name: string;
}

const UserPin: React.FC<UserPinProps> = ({ photoUrl, name }) => (
  <div className="pin-wrapper">
    <svg width={80} height={112} viewBox="0 0 80 112" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="pinkGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF3366" />
          <stop offset="100%" stopColor="#FF6F91" />
        </linearGradient>
        <clipPath id="clipCircle">
          <circle cx="40" cy="32" r="24" />
        </clipPath>
      </defs>
      <path
        d="M40 0C62 0 80 18 80 40C80 73 40 112 40 112C40 112 0 73 0 40C0 18 18 0 40 0Z"
        fill="url(#pinkGradient)"
      />
      <image
        href={photoUrl}
        x="16"
        y="8"
        width="48"
        height="48"
        clipPath="url(#clipCircle)"
        preserveAspectRatio="xMidYMid slice"
      />
      <circle cx="40" cy="32" r="24" fill="none" stroke="#FFF" strokeWidth="3" />
      <text
        x="40"
        y="84"
        textAnchor="middle"
        fontSize="12"
        fontFamily="sans-serif"
        fill="#FFF"
      >
        {name}
      </text>
    </svg>
    <button className="chat-btn">Chat</button>
  </div>
);

export default UserPin;

