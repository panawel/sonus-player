import { useState, useEffect } from 'react';

// The window's width, live. (useIsNarrow answers one yes/no question; the player card's size and
// the list's columns need the number itself — see playerCard.js.)
export function useWindowWidth() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}
