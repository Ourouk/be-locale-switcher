/**
 * BE Locale Switcher - Content Script
 * Runs at document_idle on Belgian (.be) websites.
 * Detects 404 Not Found pages to allow immediate rollback and loop prevention.
 */

(() => {
  const api = globalThis.browser ?? globalThis.chrome;

  function isPage404() {
    try {
      // Only trust the real HTTP status code. Title/heading text
      // ("not found", "introuvable", ...) matches too many real pages.
      const [navEntry] = performance.getEntriesByType("navigation");
      if (navEntry && navEntry.responseStatus === 404) {
        return true;
      }
    } catch {}
    return false;
  }

  if (isPage404()) {
    try {
      api.runtime.sendMessage({
        type: "404_DETECTED",
        url: window.location.href
      });
    } catch {}
  }
})();
