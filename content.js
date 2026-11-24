/**
 * No Dutch Please - Content Script
 * Runs at document_idle on Belgian (.be) websites.
 * Detects 404 Not Found pages to allow immediate rollback to Dutch and loop prevention.
 */

(() => {
  const api = globalThis.browser ?? globalThis.chrome;

  function isPage404() {
    try {
      // 1. Check HTTP response status code via PerformanceNavigationTiming
      const [navEntry] = performance.getEntriesByType("navigation");
      if (navEntry && navEntry.responseStatus === 404) {
        return true;
      }

      // 2. Check document title for common 404 patterns in French, Dutch, and English
      const title = (document.title || "").trim();
      const pattern404 = /(?:^|\D)404(?:\D|$)|not found|page non trouvée|page introuvable|pagina niet gevonden|niet gevonden|introuvable/i;
      if (pattern404.test(title)) {
        return true;
      }

      // 3. Check main heading if title is generic
      const h1 = document.querySelector("h1");
      if (h1) {
        const h1Text = (h1.textContent || "").trim();
        if (pattern404.test(h1Text)) {
          return true;
        }
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
