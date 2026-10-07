'use client';

import { useEffect, useRef } from 'react';

export default function Home() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    import('@/game/main').then((m) => {
      if (cancelled || !ref.current) return;
      cleanup = m.mountGame(ref.current);
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return (
    <main
      ref={ref}
      aria-label="NEON STRIKE 3D - first person shooter"
      style={{ position: 'fixed', inset: 0, background: '#0a0a14', overflow: 'hidden' }}
    />
  );
}
