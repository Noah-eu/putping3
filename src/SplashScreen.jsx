import React from "react";

export default function SplashScreen({ onFinish }) {
  return (
    <div className="splash-screen" onAnimationEnd={onFinish}>
      <div className="splash-logo">
        <span className="splash-heart">❤</span>
        <span>PutPing</span>
      </div>
    </div>
  );
}
