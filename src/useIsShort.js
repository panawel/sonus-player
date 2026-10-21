import { useState, useEffect } from 'react';

// Height twin of useIsNarrow: true while the viewport is at or below the
// breakpoint tall. Same only-setState-on-flip behavior, for the same reason.
export function useIsShort(breakpoint) {
  const [isShort, setIsShort] = useState(() => window.innerHeight <= breakpoint);

  useEffect(() => {
    const onResize = () => {
      const next = window.innerHeight <= breakpoint;
      setIsShort(prev => (prev === next ? prev : next));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);

  return isShort;
}
