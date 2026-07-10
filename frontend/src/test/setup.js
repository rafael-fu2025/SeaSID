import '@testing-library/jest-dom/vitest';

// jsdom (the Vitest default for `environment: 'jsdom'`) doesn't ship a
// ResizeObserver implementation, but react-resizable-panels and several
// Radix primitives rely on one. Provide a no-op stub so render-time
// effects (size observation, group mounting) succeed without throwing
// "n is not a constructor".
if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserverStub;
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }
  if (typeof window.IntersectionObserver === 'undefined') {
    class IntersectionObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    }
    window.IntersectionObserver = IntersectionObserverStub;
  }
}

// jsdom doesn't implement scrollIntoView on elements. shadcn Select
// uses it to auto-scroll the highlighted option into view when the
// menu opens. Provide a no-op stub.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}
