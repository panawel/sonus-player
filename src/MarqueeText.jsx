import { useEffect, useRef, useState } from 'react';

// Renders static, centered text when it fits; if it overflows its box, scrolls it
// back and forth on a loop (re-measured on resize, since the available width and
// font-size driving overflow can both change as the window resizes).
export function MarqueeText({ text, children, style }) {
  const wrapperRef = useRef(null);
  const textRef = useRef(null);
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    const measure = () => {
      if (!wrapperRef.current || !textRef.current) return;
      const overflow = textRef.current.scrollWidth - wrapperRef.current.clientWidth;
      setDistance(overflow > 0 ? overflow : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, [text]);

  return (
    <div ref={wrapperRef} style={{ lineHeight: 1.2, ...style, overflow: 'hidden', whiteSpace: 'nowrap', flexShrink: 0 }}>
      <span
        ref={textRef}
        className={distance > 0 ? 'marquee-scroll' : undefined}
        style={{ display: 'inline-block', '--marquee-distance': `${distance}px` }}
      >
        {children ?? text}
      </span>
    </div>
  );
}
