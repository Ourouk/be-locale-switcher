/**
 * BE Locale Switcher - Background Script
 * Lightweight, privacy-friendly Manifest V3 extension for Chromium and Firefox.
 * Bi-directional locale enforcement for Belgian (.be) websites and commercial (.com) sites.
 * Defaults sites to French (NL -> FR) or Dutch (FR -> NL) based on user preference,
 * while keeping the rest of the web in your preferred browser language.
 */

// Browser API namespace shim for cross-browser compatibility
const api = globalThis.browser ?? globalThis.chrome ?? {};

// Core Constants
const RULE_ID_ACCEPT_LANGUAGE = 1;
const FRENCH_ACCEPT_LANGUAGE = "fr-FR,fr;q=0.9,fr-BE;q=0.8,en;q=0.7";
const DUTCH_ACCEPT_LANGUAGE = "nl-BE,nl;q=0.9,nl-NL;q=0.8,en;q=0.7";
const REDIRECT_LOOP_WINDOW_MS = 5000;
const BE_TWO_LEVEL_TLDS = new Set(["ac.be", "mil.be", "gov.be"]);

// Helper: resolves source & target language pair
function getLanguagePair(targetLang = "fr") {
  const target = targetLang === "nl" ? "nl" : "fr";
  const source = target === "fr" ? "nl" : "fr";
  return { source, target };
}

// Copies the capitalisation of a 2-letter sample (e.g. nl/NL/Nl/nL or fr/FR/Fr/fR)
// onto a 2-letter target.
function applyCase(sample, target) {
  const upper = target.toUpperCase();
  const lower = target.toLowerCase();
  let out = "";
  for (let i = 0; i < target.length; i++) {
    out += sample[i] && sample[i] !== sample[i].toLowerCase() ? upper[i] : lower[i];
  }
  return out;
}

// In-memory fallback if storage.session is unsupported or sleeps
const memorySessionStore = {
  sessionBypassed: [],
  pendingRedirects: {}
};

/**
 * Extracts primary registrable domain from hostname.
 * e.g., "nl.vrt.be" -> "vrt.be", "nl.example.com" -> "example.com", "sub.ulb.ac.be" -> "ulb.ac.be"
 */
function getPrimaryDomain(hostname) {
  if (!hostname || typeof hostname !== "string") return "";
  hostname = hostname.toLowerCase();
  const parts = hostname.split(".");
  if (parts.length <= 2) return hostname;

  const lastTwo = parts.slice(-2).join(".");
  if (BE_TWO_LEVEL_TLDS.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

/**
 * Checks whether a hostname matches any domain in an excluded list.
 * Supports exact match, subdomain match, and primary domain match.
 */
function isDomainExcluded(hostname, excludedList = []) {
  if (!hostname || !excludedList || !excludedList.length) return false;
  hostname = hostname.toLowerCase();
  const primary = getPrimaryDomain(hostname);

  return excludedList.some((domain) => {
    if (!domain) return false;
    const d = domain.trim().toLowerCase();
    return hostname === d || hostname.endsWith("." + d) || primary === d;
  });
}

/**
 * Rewrites a locale string bi-directionally, preserving casing and separators.
 * e.g. when targetLang is "fr": nl -> fr, nl-be -> fr-be, be-nl -> be-fr
 * e.g. when targetLang is "nl": fr -> nl, fr-be -> nl-be, be-fr -> be-nl
 */
function rewriteLocaleString(str, isBelgianDomain, targetLang = "fr") {
  if (!str || typeof str !== "string") return str;
  const { source, target } = getLanguagePair(targetLang);

  // Exact 2-letter language code replacement (only on .be domains)
  if (isBelgianDomain && str.toLowerCase() === source) {
    return applyCase(str, target);
  }

  // Regional Belgian code replacement: {source}-be, be-{source}, {source}_BE, be_{source}
  const sourceBeRegex = new RegExp(`^${source}[-_]be$`, "i");
  if (sourceBeRegex.test(str)) {
    const sep = str.includes("-") ? "-" : "_";
    const bePart = str.slice(3); // Preserves casing of "be" / "BE"
    const targetPart = applyCase(str.slice(0, 2), target);
    return `${targetPart}${sep}${bePart}`;
  }

  const beSourceRegex = new RegExp(`^be[-_]${source}$`, "i");
  if (beSourceRegex.test(str)) {
    const sep = str.includes("-") ? "-" : "_";
    const bePart = str.slice(0, 2);
    const targetPart = applyCase(str.slice(3, 5), target);
    return `${bePart}${sep}${targetPart}`;
  }

  return str;
}

/**
 * Checks if a given URL matches source language patterns for the selected direction.
 */
function isSourceLangUrl(inputUrl, targetLang = "fr") {
  let urlObj;
  try {
    urlObj = new URL(inputUrl);
  } catch {
    return false;
  }

  const { source } = getLanguagePair(targetLang);
  const hostname = urlObj.hostname.toLowerCase();
  const hostParts = hostname.split(".");
  const tld = hostParts[hostParts.length - 1];
  const isBeDomain = tld === "be" || hostname === "be";
  const isCommercialCom = tld === "com";

  // Prevent matching domestic sites of the source language (e.g. nos.nl or lemonde.fr)
  if (tld === source) {
    return false;
  }

  // Subdomains: only .be and commercial .com
  if (hostParts.length > 2 && (isBeDomain || isCommercialCom)) {
    const sub = hostParts[0].toLowerCase();
    if (sub === source || sub === `${source}-be` || sub === `${source}_be`) return true;
  }

  // Check path segments
  const segments = urlObj.pathname.split("/");
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i].toLowerCase();

    // Two-segment combinations: /be/{source}/ or /{source}/be/
    if (i + 1 < segments.length) {
      const nextSeg = segments[i + 1].toLowerCase();
      if ((seg === "be" && nextSeg === source) || (seg === source && nextSeg === "be")) {
        return true;
      }
    }

    if (new RegExp(`^(${source}[-_]be|be[-_]${source})$`, "i").test(seg)) return true;
    if (isBeDomain && seg === source) return true;
  }

  // Check query parameters
  const langKeyRegex = /^(.*_)?(lang|locale|language|lng|hl)$/i;
  const searchParams = new URLSearchParams(urlObj.search);
  for (const [key, val] of searchParams.entries()) {
    if (langKeyRegex.test(key)) {
      const v = val.toLowerCase();
      if (v === `${source}-be` || v === `${source}_be` || v === `be-${source}` || v === `be_${source}`) return true;
      if (isBeDomain && v === source) return true;
    }
  }

  return false;
}

// Alias for backwards compatibility & tests
const isDutchUrl = (url) => isSourceLangUrl(url, "fr");

/**
 * Bi-directional Smart URL Rewriter
 * Works both ways:
 *  - When targetLang is "fr": rewrites Dutch (nl) to French (fr)
 *  - When targetLang is "nl": rewrites French (fr) to Dutch (nl)
 * Supports Belgian .be domains and commercial .com sites.
 * Returns rewritten URL string if changes were made, or null if untouched.
 */
function rewriteUrl(inputUrl, targetLang = "fr") {
  let urlObj;
  try {
    urlObj = new URL(inputUrl);
  } catch {
    return null;
  }

  if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
    return null;
  }

  const { source, target } = getLanguagePair(targetLang);
  const hostname = urlObj.hostname.toLowerCase();
  const hostParts = hostname.split(".");
  const tld = hostParts[hostParts.length - 1];
  const isBeDomain = tld === "be" || hostname === "be";
  const isCommercialCom = tld === "com";

  // Prevent rewriting domestic sites of the source language
  // (e.g. don't rewrite genuine .nl sites when source is nl, or genuine .fr sites when source is fr)
  if (tld === source) {
    return null;
  }

  let changed = false;

  // 1. Subdomain rewriting:
  // Rewrites bare source subdomain (nl. -> fr. or fr. -> nl.) on .be domains and commercial .com domains
  if (hostParts.length > 2 && (isBeDomain || isCommercialCom)) {
    const sub = hostParts[0];
    const subLower = sub.toLowerCase();

    if (subLower === source) {
      hostParts[0] = applyCase(sub, target);
      urlObj.hostname = hostParts.join(".");
      changed = true;
    } else if (subLower === `${source}-be` || subLower === `${source}_be`) {
      const sep = sub.includes("-") ? "-" : "_";
      hostParts[0] = applyCase(sub.slice(0, 2), target) + sep + sub.slice(3);
      urlObj.hostname = hostParts.join(".");
      changed = true;
    }
  }

  // 2. Path segments rewriting
  const segments = urlObj.pathname.split("/");
  let pathChanged = false;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segLower = seg.toLowerCase();

    // Two-segment combinations: /be/{source}/ -> /be/{target}/, /{source}/be/ -> /{target}/be/
    if (i + 1 < segments.length) {
      const nextSeg = segments[i + 1];
      const nextLower = nextSeg.toLowerCase();

      if (segLower === "be" && nextLower === source) {
        segments[i + 1] = applyCase(nextSeg, target);
        pathChanged = true;
      }
      if (segLower === source && nextLower === "be") {
        segments[i] = applyCase(seg, target);
        pathChanged = true;
      }
    }

    // Single-segment replacement: /{source}/ on .be, or /{source}-be/, /be-{source}/ on any domain
    const rewritten = rewriteLocaleString(seg, isBeDomain, targetLang);
    if (rewritten !== seg) {
      segments[i] = rewritten;
      pathChanged = true;
    }
  }

  if (pathChanged) {
    urlObj.pathname = segments.join("/");
    changed = true;
  }

  // 3. Query parameters: edit the raw query string so untouched
  // parameters keep their exact bytes (order, encoding, duplicates).
  const langKeyRegex = /^(.*_)?(lang|locale|language|lng|hl)$/i;
  let queryChanged = false;
  if (urlObj.search.length > 1) {
    const out = urlObj.search.slice(1).split("&").map((pair) => {
      const eq = pair.indexOf("=");
      const rawKey = eq < 0 ? pair : pair.slice(0, eq);
      const rawVal = eq < 0 ? "" : pair.slice(eq + 1);
      let key;
      try {
        key = decodeURIComponent(rawKey.replace(/\+/g, " "));
      } catch {
        return pair;
      }
      if (!langKeyRegex.test(key)) return pair;
      let val;
      try {
        val = decodeURIComponent(rawVal.replace(/\+/g, " "));
      } catch {
        return pair;
      }
      const rewritten = rewriteLocaleString(val, isBeDomain, targetLang);
      if (rewritten === val) return pair;
      queryChanged = true;
      return `${rawKey}=${encodeURIComponent(rewritten)}`;
    });
    if (queryChanged) urlObj.search = "?" + out.join("&");
  }

  if (queryChanged) {
    changed = true;
  }

  return changed ? urlObj.toString() : null;
}

// =============================================================================
// Storage & Session Management
// =============================================================================

async function getSyncData() {
  try {
    const data = await api.storage.sync.get(["enabled", "whitelist", "targetLanguage"]);
    return {
      enabled: data.enabled ?? true,
      targetLanguage: data.targetLanguage === "nl" ? "nl" : "fr",
      whitelist: Array.isArray(data.whitelist) ? data.whitelist : []
    };
  } catch (err) {
    console.error("[BE Locale Switcher] storage.sync.get error:", err);
    return { enabled: true, targetLanguage: "fr", whitelist: [] };
  }
}

async function getSessionData() {
  if (api.storage?.session) {
    try {
      const data = await api.storage.session.get(["sessionBypassed", "pendingRedirects"]);
      return {
        sessionBypassed: Array.isArray(data.sessionBypassed) ? data.sessionBypassed : [],
        pendingRedirects: data.pendingRedirects && typeof data.pendingRedirects === "object" ? data.pendingRedirects : {}
      };
    } catch (err) {
      console.warn("[BE Locale Switcher] storage.session.get error:", err);
    }
  }
  return {
    sessionBypassed: memorySessionStore.sessionBypassed || [],
    pendingRedirects: memorySessionStore.pendingRedirects || {}
  };
}

async function setSessionData(data) {
  if (data.sessionBypassed !== undefined) {
    memorySessionStore.sessionBypassed = data.sessionBypassed;
  }

  if (api.storage?.session) {
    try {
      const { pendingRedirects, ...rest } = data;
      void pendingRedirects;
      await api.storage.session.set(rest);
      return;
    } catch (err) {
      console.warn("[BE Locale Switcher] storage.session.set error:", err);
    }
  }
}

// Per-tab pending redirects: one storage key per tab, so two tabs
// redirecting at once never overwrite each other.
function pendingKey(tabId) {
  return `pendingRedirect_${tabId}`;
}

async function getPendingRedirect(tabId) {
  if (memorySessionStore.pendingRedirects?.[tabId]) {
    return memorySessionStore.pendingRedirects[tabId];
  }
  if (api.storage?.session) {
    try {
      const data = await api.storage.session.get(pendingKey(tabId));
      return data[pendingKey(tabId)] || null;
    } catch {}
  }
  return null;
}

async function setPendingRedirect(tabId, value) {
  if (!memorySessionStore.pendingRedirects) memorySessionStore.pendingRedirects = {};
  memorySessionStore.pendingRedirects[tabId] = value;
  if (api.storage?.session) {
    try {
      await api.storage.session.set({ [pendingKey(tabId)]: value });
    } catch {}
  }
}

async function clearPendingRedirect(tabId) {
  if (memorySessionStore.pendingRedirects) delete memorySessionStore.pendingRedirects[tabId];
  if (api.storage?.session) {
    try {
      await api.storage.session.remove(pendingKey(tabId));
    } catch {}
  }
}

/**
 * Temporarily marks a domain as bypassed in storage.session
 * so the user is not trapped by redirect loops or 404s.
 */
async function markDomainSessionBypassed(domain) {
  if (!domain) return;
  // Exact host only: bypassing vrt.be must not silence sub.vrt.be.
  const session = await getSessionData();
  const set = new Set(session.sessionBypassed || []);
  set.add(domain.toLowerCase());

  await setSessionData({ sessionBypassed: Array.from(set) });
  await syncDnrRules();
}

/**
 * Resets the session bypass for a specific domain.
 */
async function resetSessionBypass(domain) {
  if (!domain) return;
  const primary = getPrimaryDomain(domain).toLowerCase();
  const target = domain.toLowerCase();
  const session = await getSessionData();

  const filtered = (session.sessionBypassed || []).filter((d) => {
    const dl = d.toLowerCase();
    return dl !== target && dl !== primary;
  });

  await setSessionData({ sessionBypassed: filtered });
  await syncDnrRules();
}

// =============================================================================
// declarativeNetRequest (modifyHeaders) Management
// =============================================================================

/**
 * Synchronizes declarativeNetRequest dynamic rules.
 * Intercepts *://*.be/* requests and sets Accept-Language to French or Dutch,
 * excluding domains in whitelist (storage.sync) and sessionBypassed (storage.session).
 */
async function syncDnrRules() {
  if (!api.declarativeNetRequest?.updateDynamicRules) return;

  const { enabled, targetLanguage, whitelist } = await getSyncData();
  const { sessionBypassed } = await getSessionData();

  // If disabled, remove dynamic rule
  if (!enabled) {
    try {
      await api.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [RULE_ID_ACCEPT_LANGUAGE],
        addRules: []
      });
    } catch (err) {
      console.error("[BE Locale Switcher] Failed to disable DNR rules:", err);
    }
    return;
  }

  // Combine and deduplicate excluded domains. Browsers cap excluded
  // domains per rule: keep the first 100 and warn, instead of
  // failing the whole update and leaving a stale rule behind.
  const excludedDomains = Array.from(new Set([...whitelist, ...sessionBypassed]))
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 100);
  const totalExcluded = new Set([...whitelist, ...sessionBypassed].map((d) => (d || "").trim().toLowerCase())).size;
  if (totalExcluded > excludedDomains.length) {
    console.warn(`[BE Locale Switcher] ${totalExcluded - excludedDomains.length} excluded domains dropped (100-domain rule limit).`);
  }

  const condition = {
    regexFilter: "^https?://[^/:]+\\.be(:[0-9]+)?/",
    resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest"]
  };

  if (excludedDomains.length > 0) {
    condition.excludedRequestDomains = excludedDomains;
  }

  const headerValue = targetLanguage === "nl" ? DUTCH_ACCEPT_LANGUAGE : FRENCH_ACCEPT_LANGUAGE;

  const rule = {
    id: RULE_ID_ACCEPT_LANGUAGE,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        {
          header: "Accept-Language",
          operation: "set",
          value: headerValue
        }
      ]
    },
    condition
  };

  try {
    await api.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [RULE_ID_ACCEPT_LANGUAGE],
      addRules: [rule]
    });
  } catch (err) {
    console.error("[BE Locale Switcher] Failed to update DNR rules:", err);
  }
}

// =============================================================================
// UI Badge Status
// =============================================================================

async function updateBadge(tabId, state, targetLang = "fr") {
  if (!api.action?.setBadgeText) return;
  const badgeText = targetLang === "nl" ? "NL" : "FR";
  try {
    switch (state) {
      case "active":
        await api.action.setBadgeText({ tabId, text: badgeText });
        await api.action.setBadgeBackgroundColor({ tabId, color: "#2563eb" }); // Blue
        break;
      case "whitelisted":
      case "bypassed":
        await api.action.setBadgeText({ tabId, text: "OFF" });
        await api.action.setBadgeBackgroundColor({ tabId, color: "#d97706" }); // Amber
        break;
      case "disabled":
      case "idle":
      default:
        await api.action.setBadgeText({ tabId, text: "" });
        break;
    }
  } catch {}
}

async function refreshTabBadge(tabId, url) {
  if (!url || typeof url !== "string") {
    await updateBadge(tabId, "idle");
    return;
  }

  let urlObj;
  try {
    urlObj = new URL(url);
  } catch {
    await updateBadge(tabId, "idle");
    return;
  }

  const hostname = urlObj.hostname.toLowerCase();
  const hostParts = hostname.split(".");
  const tld = hostParts[hostParts.length - 1];
  const isBe = tld === "be" || hostname === "be";
  const isCommercialCom = tld === "com";

  const { enabled, targetLanguage, whitelist } = await getSyncData();
  const isTargetSub = hostParts.length > 2 && hostParts[0] === targetLanguage;

  if (!enabled) {
    await updateBadge(tabId, "disabled", targetLanguage);
    return;
  }

  if (isDomainExcluded(hostname, whitelist)) {
    await updateBadge(tabId, "whitelisted", targetLanguage);
    return;
  }

  const { sessionBypassed } = await getSessionData();
  if (isDomainExcluded(hostname, sessionBypassed)) {
    await updateBadge(tabId, "bypassed", targetLanguage);
    return;
  }

  if (isBe || (isCommercialCom && isTargetSub) || isTargetSub || isSourceLangUrl(url, targetLanguage)) {
    await updateBadge(tabId, "active", targetLanguage);
  } else {
    await updateBadge(tabId, "idle", targetLanguage);
  }
}

// =============================================================================
// Navigation & Loop Guard Handler
// =============================================================================

async function handleUrlNavigation(tabId, url) {
  if (!url || typeof url !== "string") return;

  let urlObj;
  try {
    urlObj = new URL(url);
  } catch {
    return;
  }

  if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
    return;
  }

  const hostname = urlObj.hostname.toLowerCase();
  const hostParts = hostname.split(".");
  const tld = hostParts[hostParts.length - 1];
  const isBeDomain = tld === "be" || hostname === "be";

  // Check global enable state & target language preference
  const { enabled, targetLanguage, whitelist } = await getSyncData();
  if (!enabled) {
    await updateBadge(tabId, "disabled", targetLanguage);
    return;
  }

  // Check persistent whitelist
  if (isDomainExcluded(hostname, whitelist)) {
    await updateBadge(tabId, "whitelisted", targetLanguage);
    return;
  }

  // Check temporary session bypass
  const session = await getSessionData();
  const sessionBypassed = session.sessionBypassed || [];
  if (isDomainExcluded(hostname, sessionBypassed)) {
    await updateBadge(tabId, "bypassed", targetLanguage);
    return;
  }

  const pending = await getPendingRedirect(tabId);
  const now = Date.now();

  // 1. Ignore in-flight browser events for the original source URL
  // while the redirect is being dispatched (e.g. trailing slash normalization within 500ms).
  if (pending && !pending.targetReached && (now - pending.timestamp < 500)) {
    const isSameOrNormalizedFrom =
      url === pending.fromUrl ||
      url.replace(/\/$/, "") === pending.fromUrl.replace(/\/$/, "");
    if (isSameOrNormalizedFrom) {
      return;
    }
  }

  // 2. Loop Guard check:
  // If this tab was redirected within 5 seconds
  if (pending && (now - pending.timestamp < REDIRECT_LOOP_WINDOW_MS)) {
    const isSameDomain = hostname === pending.domain || hostname.endsWith("." + pending.domain);
    if (isSameDomain) {
      // Only detect loop if:
      // (a) Target was already reached and server/client bounced back, OR
      // (b) At least 500ms have elapsed (ruling out immediate in-flight browser noise)
      //     and the URL is a source language URL or the original fromUrl.
      const isBounce = pending.targetReached || (now - pending.timestamp >= 500);
      if (isBounce && (isSourceLangUrl(url, targetLanguage) || url === pending.fromUrl)) {
        console.warn(`[BE Locale Switcher] Redirect loop detected for ${hostname}! Bypassing for this session.`);
        await clearPendingRedirect(tabId);
        await markDomainSessionBypassed(pending.domain);
        await updateBadge(tabId, "bypassed", targetLanguage);
        return;
      }
    }
  }

  // 3. Calculate potential rewritten URL for targetLanguage
  const rewrittenUrl = rewriteUrl(url, targetLanguage);
  if (rewrittenUrl && rewrittenUrl !== url) {
    // Record pending redirect before executing
    await setPendingRedirect(tabId, {
      domain: hostname,
      fromUrl: url,
      toUrl: rewrittenUrl,
      timestamp: now,
      targetReached: false
    });

    try {
      await api.tabs.update(tabId, { url: rewrittenUrl });
      await updateBadge(tabId, "active", targetLanguage);
    } catch (err) {
      console.error("[BE Locale Switcher] tabs.update error:", err);
    }
  } else {
    // URL does not need rewrite (target reached or already in target language)
    if (pending && !pending.targetReached) {
      const isTargetSub = hostParts.length > 2 && hostParts[0] === targetLanguage;
      if (url === pending.toUrl || isTargetSub) {
        pending.targetReached = true;
        await setPendingRedirect(tabId, pending);
      }
    }

    const isCommercialCom = tld === "com";
    const isTargetSub = hostParts.length > 2 && hostParts[0] === targetLanguage;

    if (isBeDomain || (isCommercialCom && isTargetSub) || isTargetSub) {
      await updateBadge(tabId, "active", targetLanguage);
    } else {
      await updateBadge(tabId, "idle", targetLanguage);
    }
  }
}

/**
 * Handles 404 reported after a redirect
 */
async function handle404Report(tabId, reportedUrl) {
  const pending = await getPendingRedirect(tabId);
  if (!pending) return;
  // Only revert when the 404 is on the page we redirected to.
  if (reportedUrl && reportedUrl !== pending.toUrl) return;

  const { targetLanguage } = await getSyncData();
  const now = Date.now();
  if (now - pending.timestamp < REDIRECT_LOOP_WINDOW_MS) {
    console.warn(`[BE Locale Switcher] 404 detected after redirecting to ${reportedUrl}. Reverting to fallback version and bypassing.`);
    const domain = pending.domain;
    const fallbackUrl = pending.fromUrl;

    await clearPendingRedirect(tabId);
    await markDomainSessionBypassed(domain);

    try {
      await api.tabs.update(tabId, { url: fallbackUrl });
      await updateBadge(tabId, "bypassed", targetLanguage);
    } catch (err) {
      console.error("[BE Locale Switcher] 404 fallback tabs.update error:", err);
    }
  }
}

/**
 * Returns comprehensive status for a given URL (used by popup)
 */
async function getStatusForUrl(url) {
  const { enabled, targetLanguage, whitelist } = await getSyncData();
  const { sessionBypassed } = await getSessionData();

  let hostname = "";
  let primaryDomain = "";
  let isBe = false;
  let isCommercialCom = false;
  let isTargetSub = false;

  if (url && typeof url === "string") {
    try {
      const u = new URL(url);
      hostname = u.hostname.toLowerCase();
      primaryDomain = getPrimaryDomain(hostname);
      const hostParts = hostname.split(".");
      const tld = hostParts[hostParts.length - 1];
      isBe = tld === "be" || hostname === "be";
      isCommercialCom = tld === "com";
      isTargetSub = hostParts.length > 2 && hostParts[0] === targetLanguage;
    } catch {}
  }

  const isWhitelisted = isDomainExcluded(hostname, whitelist);
  const isSessionBypassed = isDomainExcluded(hostname, sessionBypassed);

  let state = "idle";
  let statusText = "Non-Belgian domain (Inactive)";

  const langLabel = targetLanguage === "nl" ? "Dutch (nl-BE)" : "French (fr-FR)";

  if (!enabled) {
    state = "disabled";
    statusText = "Extension Disabled";
  } else if (isWhitelisted) {
    state = "whitelisted";
    statusText = "Ignored by user (Whitelisted)";
  } else if (isSessionBypassed) {
    state = "bypassed";
    statusText = "Temporarily Bypassed (Loop / 404)";
  } else if (isBe) {
    state = "active";
    statusText = `Active — Forcing ${langLabel}`;
  } else if (isCommercialCom && isTargetSub) {
    state = "active";
    statusText = `Active — Commercial site (${targetLanguage}.*)`;
  } else if (isTargetSub) {
    state = "active";
    statusText = `Active — Target subdomain (${targetLanguage}.*)`;
  }

  return {
    enabled,
    targetLanguage,
    hostname,
    primaryDomain,
    isBe,
    isWhitelisted,
    isSessionBypassed,
    state,
    statusText,
    whitelist,
    sessionBypassed
  };
}

// =============================================================================
// Extension Event Listeners
// =============================================================================

// Listen to URL updates in tabs
if (api.tabs?.onUpdated) {
  api.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) {
      handleUrlNavigation(tabId, changeInfo.url);
    }
  });
}

// Listen to tab activation to refresh toolbar badge
if (api.tabs?.onActivated) {
  api.tabs.onActivated.addListener(async (activeInfo) => {
    try {
      const tab = await api.tabs.get(activeInfo.tabId);
      if (tab?.url) {
        await refreshTabBadge(activeInfo.tabId, tab.url);
      }
    } catch {}
  });
}

// Clean up pending redirects when tab is closed
if (api.tabs?.onRemoved) {
  api.tabs.onRemoved.addListener(async (tabId) => {
    await clearPendingRedirect(tabId);
  });
}

// Runtime messages (from popup or content script)
if (api.runtime?.onMessage) {
  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return;

    if (message.type === "404_DETECTED" && sender?.tab?.id) {
      handle404Report(sender.tab.id, message.url);
      sendResponse?.({ status: "handled" });
      return true;
    }

    if (message.type === "GET_STATUS") {
      getStatusForUrl(message.url).then(sendResponse);
      return true;
    }

    if (message.type === "SET_TARGET_LANGUAGE") {
      const targetLang = message.language === "nl" ? "nl" : "fr";
      api.storage.sync.set({ targetLanguage: targetLang }).then(async () => {
        await syncDnrRules();
        sendResponse?.({ status: "ok", targetLanguage: targetLang });
      });
      return true;
    }

    if (message.type === "RESET_SESSION_BYPASS") {
      if (message.tabId) {
        clearPendingRedirect(message.tabId);
      }
      resetSessionBypass(message.domain).then(() => {
        sendResponse?.({ status: "ok" });
      });
      return true;
    }

    if (message.type === "SYNC_RULES") {
      syncDnrRules().then(() => {
        sendResponse?.({ status: "ok" });
      });
      return true;
    }
  });
}

// Storage change listener to keep DNR rules in sync
if (api.storage?.onChanged) {
  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" || areaName === "session") {
      syncDnrRules();
    }
  });
}

// On install or startup
if (api.runtime?.onInstalled) {
  api.runtime.onInstalled.addListener(async () => {
    const { enabled, targetLanguage } = await getSyncData();
    if (enabled === undefined) {
      await api.storage.sync.set({ enabled: true, targetLanguage: "fr", whitelist: [] });
    }
    await setSessionData({ sessionBypassed: [] });
    await syncDnrRules();
  });
}

if (api.runtime?.onStartup) {
  api.runtime.onStartup.addListener(async () => {
    await setSessionData({ sessionBypassed: [] });
    await syncDnrRules();
  });
}

// Export for Node.js unit tests
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getPrimaryDomain,
    isDomainExcluded,
    applyCase,
    getLanguagePair,
    rewriteLocaleString,
    isSourceLangUrl,
    isDutchUrl,
    rewriteUrl,
    RULE_ID_ACCEPT_LANGUAGE,
    FRENCH_ACCEPT_LANGUAGE,
    DUTCH_ACCEPT_LANGUAGE,
    REDIRECT_LOOP_WINDOW_MS
  };
}
