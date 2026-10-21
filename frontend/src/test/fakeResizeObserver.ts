import { act } from '@testing-library/react';
import { vi } from 'vitest';

/** Stubs the `ResizeObserver` global; `resize` delivers a width to one observed element (or all of them). */
export function installResizeObserver() {
  const live = new Set<{ cb: ResizeObserverCallback; self: ResizeObserver; els: Set<Element> }>();
  class FakeResizeObserver {
    private entry;
    constructor(cb: ResizeObserverCallback) {
      this.entry = { cb, self: this as unknown as ResizeObserver, els: new Set<Element>() };
      live.add(this.entry);
    }
    observe(el: Element) { this.entry.els.add(el); }
    unobserve(el: Element) { this.entry.els.delete(el); }
    disconnect() { this.entry.els.clear(); live.delete(this.entry); }
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  return {
    resize(target: Element | 'all', width: number) {
      act(() => {
        for (const o of [...live]) {
          const hit = [...o.els].filter((el) => target === 'all' || el === target);
          if (!hit.length) continue;
          o.cb(hit.map((el) => ({ target: el, borderBoxSize: [{ inlineSize: width, blockSize: 0 }], contentRect: { width } }) as unknown as ResizeObserverEntry), o.self);
        }
      });
    },
    observed: () => [...live].flatMap((o) => [...o.els]),
  };
}
