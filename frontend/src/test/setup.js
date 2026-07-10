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

/**
 * Default viewport behaviour for jsdom tests.
 *
 * jsdom doesn't render a layout viewport, so `matchMedia('(min-width: 1024px)')`
 * returns false by default — which would make `useIsDesktop()` always pick
 * the mobile branch in tests and hide every persistent UI element
 * (rails, brand chip, chevrons, Reset link) that the existing test
 * suite expects to find.
 *
 * To keep existing tests honest, we mock `matchMedia` so that the
 * `@media (min-width: 1024px)` queries return `matches: true` by
 * default. Tests that want to exercise the mobile branch can swap
 * the mock with `vi.spyOn(window.matchMedia, ...)` and assert on
 * the resulting UI.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  // Don't clobber a real matchMedia if some other test setup installed
  // one — wrap the existing one when possible.
  const realMatchMedia = window.matchMedia.bind(window);
  window.matchMedia = function (query) {
    const isMinWidth1024 = /min-width:\s*1024px/.test(query);
    if (isMinWidth1024) {
      const mql = {
        matches: true,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      };
      return mql;
    }
    return realMatchMedia(query);
  };
}
