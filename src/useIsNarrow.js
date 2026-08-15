import { useState, useEffect } from 'react';

// Boolean viewport-width breakpoint. Only calls setState when the boolean
// actually flips, so a drag-resize doesn't re-render on every pixel.
export function useIsNarrow(breakpoint) {
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth <= breakpoint);

  useEffect(() => {
    const onResize = () => {
      const next = window.innerWidth <= breakpoint;
      setIsNarrow(prev => (prev === next ? prev : next));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);

  return isNarrow;
}
