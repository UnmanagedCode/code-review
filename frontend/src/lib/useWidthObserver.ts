import { useCallback, useRef } from 'react';

/**
 * A callback ref: reports the element's border-box width once on attach and on every resize (ResizeObserver).
 * A callback ref rather than a RefObject, so it works on an element that mounts after early returns.
 */
export function useWidthObserver(onWidth: (width: number) => void): (el: Element | null) => void {
  const cb = useRef(onWidth);
  cb.current = onWidth;
  const observer = useRef<ResizeObserver | null>(null);
  return useCallback((el: Element | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    cb.current(el.getBoundingClientRect().width);
    observer.current = new ResizeObserver((entries) => {
      const e = entries[entries.length - 1];
      cb.current(e.borderBoxSize?.[0]?.inlineSize ?? e.contentRect.width);
    });
    observer.current.observe(el);
  }, []);
}
