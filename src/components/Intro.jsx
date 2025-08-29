import { useEffect } from 'react';

export default function Intro({ onDone }) {
  useEffect(() => {
    const t = setTimeout(() => onDone?.(), 2000);
    return () => clearTimeout(t);
  }, [onDone]);

  return <div className="pp-intro" />;
}
