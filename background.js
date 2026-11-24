/**
 * No Dutch Please - Background Script
 * Lightweight, privacy-friendly Manifest V3 extension for Chromium and Firefox.
 * Forces French locale on Belgian (.be) websites and international sites (e.g. nl.aliexpress.com)
 * while keeping the rest of the web in your preferred browser language.
 */

// Browser API namespace shim for cross-browser compatibility
const api = globalThis.browser ?? globalThis.chrome ?? {};

// Core Constants
const RULE_ID_ACCEPT_LANGUAGE = 1;
const FRENCH_ACCEPT_LANGUAGE = "fr-FR,fr;q=0.9,fr-BE;q=0.8,en;q=0.7";
const REDIRECT_LOOP_WINDOW_MS = 5000;
const BE_TWO_LEVEL_TLDS = new Set(["ac.be", "mil.be", "gov.be"]);

// In-memory fallback if storage.session is unsupported or sleeps
const memorySessionStore = {
  sessionBypassed: [],
  pendingRedirects: {}
};

/**
 * Extracts primary registrable domain from hostname.
 * e.g., "nl.vrt.be" -> "vrt.be", "nl.aliexpress.com" -> "aliexpress.com", "sub.ulb.ac.be" -> "ulb.ac.be"
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
 * Rewrites a locale string from Dutch to French, preserving casing and separators.
 */
function rewriteLocaleString(str, isBelgianDomain) {
  if (!str || typeof str !== "string") return str;

  // Exact 2-letter language code replacement (only on .be domains)
  if (isBelgianDomain) {
    if (str === "nl") return "fr";
    if (str === "NL") return "FR";
    if (str === "Nl") return "Fr";
  }

  // Regional Belgian code replacement: nl-be, be-nl, nl_BE, be_NL (valid on any domain)
  if (/^nl[-_]be$/i.test(str)) {
    const sep = str.includes("-") ? "-" : "_";
    const bePart = str.slice(3); // Preserves casing of "be" / "BE"
    const frPart = str.startsWith("NL") ? "FR" : (str.startsWith("Nl") ? "Fr" : "fr");
    return `${frPart}${sep}${bePart}`;
  }

  if (/^be[-_]nl$/i.test(str)) {
    const sep = str.includes("-") ? "-" : "_";
    const bePart = str.slice(0, 2);
    const frPart = str.slice(3) === "NL" ? "FR" : "fr";
    return `${bePart}${sep}${frPart}`;
  }

  return str;
}

/**
 * Checks if a given URL matches Dutch patterns.
 */
function isDutchUrl(inputUrl) {
  let urlObj;
  try {
    urlObj = new URL(inputUrl);
  } catch {
    return false;
  }

  const hostname = urlObj.hostname.toLowerCase();
  const hostParts = hostname.split(".");
  const tld = hostParts[hostParts.length - 1];
  const isBeDomain = tld === "be" || hostname === "be";

  // Check subdomains (excluding genuine .nl Netherlands domains)
  if (hostParts.length > 2 && tld !== "nl") {
    const sub = hostParts[0].toLowerCase();
    if (sub === "nl" || sub === "nl-be" || sub === "nl_be") return true;
  }

  // Check path segments
  const segments = urlObj.pathname.split("/");
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i].toLowerCase();

    // Two-segment Belgian combinations: /be/nl/ or /nl/be/
    if (i + 1 < segments.length) {
      const nextSeg = segments[i + 1].toLowerCase();
      if ((seg === "be" && nextSeg === "nl") || (seg === "nl" && nextSeg === "be")) {
        return true;
      }
    }

    if (/^(nl[-_]be|be[-_]nl)$/i.test(seg)) return true;
    if (isBeDomain && seg === "nl") return true;
  }

  // Check query parameters
  const langKeyRegex = /^(.*_)?(lang|locale|language|lng|hl)$/i;
  const searchParams = new URLSearchParams(urlObj.search);
  for (const [key, val] of searchParams.entries()) {
    if (langKeyRegex.test(key)) {
      const v = val.toLowerCase();
      if (v === "nl-be" || v === "nl_be" || v === "be-nl" || v === "be_nl") return true;
      if (isBeDomain && v === "nl") return true;
    }
  }

  return false;
}

/**
 * Smart URL Rewriter (nl -> fr)
 * Supports Belgian .be domains and international sites (e.g. nl.aliexpress.com, apple.com/be-nl/)
 * Returns rewritten URL string if changes were made, or null if untouched.
 */
function rewriteUrl(inputUrl) {
  let urlObj;
  try {
    urlObj = new URL(inputUrl);
  } catch {
    return null;
  }

  if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
    return null;
  }

  const hostname = urlObj.hostname.toLowerCase();
  const hostParts = hostname.split(".");
  const tld = hostParts[hostParts.length - 1];
  const isBeDomain = tld === "be" || hostname === "be";

  let changed = false;

  // 1. Subdomain rewriting:
  // Rewrites "nl." to "fr." on .be domains and international sites (e.g. nl.aliexpress.com -> fr.aliexpress.com)
  // Never touches genuine Netherlands websites ending in .nl (e.g. nos.nl, nl.example.nl)
  if (hostParts.length > 2 && tld !== "nl") {
    const sub = hostParts[0];
    const subLower = sub.toLowerCase();

    if (subLower === "nl") {
      hostParts[0] = sub === "NL" ? "FR" : "fr";
      urlObj.hostname = hostParts.join(".");
      changed = true;
    } else if (subLower === "nl-be" || subLower === "nl_be") {
      const sep = sub.includes("-") ? "-" : "_";
      hostParts[0] = (sub.startsWith("NL") ? "FR" : "fr") + sep + sub.slice(3);
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

    // Two-segment Belgian combinations: /be/nl/ -> /be/fr/, /nl/be/ -> /fr/be/
    if (i + 1 < segments.length) {
      const nextSeg = segments[i + 1];
      const nextLower = nextSeg.toLowerCase();

      if (segLower === "be" && nextLower === "nl") {
        segments[i + 1] = nextSeg === "NL" ? "FR" : "fr";
        pathChanged = true;
        break;
      }
      if (segLower === "nl" && nextLower === "be") {
        segments[i] = seg === "NL" ? "FR" : "fr";
        pathChanged = true;
        break;
      }
    }

    // Single-segment replacement: /nl/ on .be, or /nl-be/, /be-nl/ on any domain
    const rewritten = rewriteLocaleString(seg, isBeDomain);
    if (rewritten !== seg) {
      segments[i] = rewritten;
      pathChanged = true;
      break;
    }
  }

  if (pathChanged) {
    urlObj.pathname = segments.join("/");
    changed = true;
  }

  // 3. Query parameters rewriting
  const langKeyRegex = /^(.*_)?(lang|locale|language|lng|hl)$/i;
  const searchParams = new URLSearchParams(urlObj.search);
  let queryChanged = false;

  for (const [key, val] of Array.from(searchParams.entries())) {
    if (langKeyRegex.test(key)) {
      const rewritten = rewriteLocaleString(val, isBeDomain);
      if (rewritten !== val) {
        searchParams.set(key, rewritten);
        queryChanged = true;
      }
    }
  }

  if (queryChanged) {
    urlObj.search = searchParams.toString();
    changed = true;
  }

  return changed ? urlObj.toString() : null;
}

// =============================================================================
// Storage & Session Management
// =============================================================================

async function getSyncData() {
  try {
    const data = await api.storage.sync.get(["enabled", "whitelist"]);
    return {
      enabled: data.enabled ?? true,
      whitelist: Array.isArray(data.whitelist) ? data.whitelist : []
    };
  } catch (err) {
    console.error("[No Dutch Please] storage.sync.get error:", err);
    return { enabled: true, whitelist: [] };
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
      console.warn("[No Dutch Please] storage.session.get error:", err);
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
  if (data.pendingRedirects !== undefined) {
    memorySessionStore.pendingRedirects = data.pendingRedirects;
  }

  if (api.storage?.session) {
    try {
      await api.storage.session.set(data);
      return;
    } catch (err) {
      console.warn("[No Dutch Please] storage.session.set error:", err);
    }
  }
}

/**
 * Temporarily marks a domain as bypassed in storage.session
 * so the user is not trapped by redirect loops or 404s.
 */
async function markDomainSessionBypassed(domain) {
  if (!domain) return;
  const primary = getPrimaryDomain(domain);
  const session = await getSessionData();
  const set = new Set(session.sessionBypassed || []);
  if (primary) set.add(primary.toLowerCase());
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
 * Intercepts *://*.be/* and *://*.aliexpress.com/* requests and sets Accept-Language to French,
 * excluding domains in whitelist (storage.sync) and sessionBypassed (storage.session).
 */
async function syncDnrRules() {
  if (!api.declarativeNetRequest?.updateDynamicRules) return;

  const { enabled, whitelist } = await getSyncData();
  const { sessionBypassed } = await getSessionData();

  // If disabled, remove dynamic rule
  if (!enabled) {
    try {
      await api.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [RULE_ID_ACCEPT_LANGUAGE],
        addRules: []
      });
    } catch (err) {
      console.error("[No Dutch Please] Failed to disable DNR rules:", err);
    }
    return;
  }

  // Combine and deduplicate excluded domains
  const excludedDomains = Array.from(new Set([...whitelist, ...sessionBypassed]))
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  const condition = {
    regexFilter: "^https?://([^/:]+\\.)?([^/:]+\\.be|aliexpress\\.com)(:[0-9]+)?/",
    resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest"]
  };

  if (excludedDomains.length > 0) {
    condition.excludedRequestDomains = excludedDomains;
  }

  const rule = {
    id: RULE_ID_ACCEPT_LANGUAGE,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        {
          header: "Accept-Language",
          operation: "set",
          value: FRENCH_ACCEPT_LANGUAGE
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
    console.error("[No Dutch Please] Failed to update DNR rules:", err);
  }
}

// =============================================================================
// UI Badge Status
// =============================================================================

async function updateBadge(tabId, state) {
  if (!api.action?.setBadgeText) return;
  try {
    switch (state) {
      case "active":
        await api.action.setBadgeText({ tabId, text: "FR" });
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
  const isAliexpress = hostname.includes("aliexpress.com");
  const isFrenchSub = hostParts.length > 2 && hostParts[0] === "fr";

  const { enabled, whitelist } = await getSyncData();

  if (!enabled) {
    await updateBadge(tabId, "disabled");
    return;
  }

  if (isDomainExcluded(hostname, whitelist)) {
    await updateBadge(tabId, "whitelisted");
    return;
  }

  const { sessionBypassed } = await getSessionData();
  if (isDomainExcluded(hostname, sessionBypassed)) {
    await updateBadge(tabId, "bypassed");
    return;
  }

  if (isBe || isAliexpress || isFrenchSub || isDutchUrl(url)) {
    await updateBadge(tabId, "active");
  } else {
    await updateBadge(tabId, "idle");
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

  // Check global enable state
  const { enabled, whitelist } = await getSyncData();
  if (!enabled) {
    await updateBadge(tabId, "disabled");
    return;
  }

  // Check persistent whitelist
  if (isDomainExcluded(hostname, whitelist)) {
    await updateBadge(tabId, "whitelisted");
    return;
  }

  // Check temporary session bypass
  const session = await getSessionData();
  const sessionBypassed = session.sessionBypassed || [];
  if (isDomainExcluded(hostname, sessionBypassed)) {
    await updateBadge(tabId, "bypassed");
    return;
  }

  const pendingRedirects = session.pendingRedirects || {};
  const pending = pendingRedirects[tabId];
  const now = Date.now();

  // Loop Guard check:
  // If this tab was redirected from nl -> fr within 5 seconds
  if (pending && (now - pending.timestamp < REDIRECT_LOOP_WINDOW_MS)) {
    const isSameDomain = hostname === pending.domain || hostname.endsWith("." + pending.domain);
    if (isSameDomain) {
      // If server bounced us back to nl or the original URL:
      if (isDutchUrl(url) || url === pending.fromUrl) {
        console.warn(`[No Dutch Please] Redirect loop detected for ${hostname}! Bypassing for this session.`);
        delete pendingRedirects[tabId];
        await markDomainSessionBypassed(pending.domain);
        await setSessionData({ pendingRedirects });
        await updateBadge(tabId, "bypassed");
        return;
      }
    }
  }

  // Calculate potential French URL
  const rewrittenUrl = rewriteUrl(url);
  if (rewrittenUrl && rewrittenUrl !== url) {
    // Record pending redirect before executing
    pendingRedirects[tabId] = {
      domain: getPrimaryDomain(hostname),
      fromUrl: url,
      toUrl: rewrittenUrl,
      timestamp: now
    };
    await setSessionData({ pendingRedirects });

    try {
      await api.tabs.update(tabId, { url: rewrittenUrl });
      await updateBadge(tabId, "active");
    } catch (err) {
      console.error("[No Dutch Please] tabs.update error:", err);
    }
  } else {
    // URL does not need rewrite
    const isAliexpress = hostname.includes("aliexpress.com");
    const isFrenchSub = hostParts.length > 2 && hostParts[0] === "fr";

    if (isBeDomain || isAliexpress || isFrenchSub) {
      await updateBadge(tabId, "active");
    } else {
      await updateBadge(tabId, "idle");
    }
  }
}

/**
 * Handles 404 reported after a redirect
 */
async function handle404Report(tabId, reportedUrl) {
  const session = await getSessionData();
  const pendingRedirects = session.pendingRedirects || {};
  const pending = pendingRedirects[tabId];
  if (!pending) return;

  const now = Date.now();
  if (now - pending.timestamp < REDIRECT_LOOP_WINDOW_MS) {
    console.warn(`[No Dutch Please] 404 detected after redirecting to ${reportedUrl}. Reverting to Dutch version and bypassing.`);
    const domain = pending.domain;
    const fallbackUrl = pending.fromUrl;

    delete pendingRedirects[tabId];
    await markDomainSessionBypassed(domain);
    await setSessionData({ pendingRedirects });

    try {
      await api.tabs.update(tabId, { url: fallbackUrl });
      await updateBadge(tabId, "bypassed");
    } catch (err) {
      console.error("[No Dutch Please] 404 fallback tabs.update error:", err);
    }
  }
}

/**
 * Returns comprehensive status for a given URL (used by popup)
 */
async function getStatusForUrl(url) {
  const { enabled, whitelist } = await getSyncData();
  const { sessionBypassed } = await getSessionData();

  let hostname = "";
  let primaryDomain = "";
  let isBe = false;
  let isAliexpress = false;
  let isFrenchSub = false;

  if (url && typeof url === "string") {
    try {
      const u = new URL(url);
      hostname = u.hostname.toLowerCase();
      primaryDomain = getPrimaryDomain(hostname);
      const hostParts = hostname.split(".");
      const tld = hostParts[hostParts.length - 1];
      isBe = tld === "be" || hostname === "be";
      isAliexpress = hostname.includes("aliexpress.com");
      isFrenchSub = hostParts.length > 2 && hostParts[0] === "fr";
    } catch {}
  }

  const isWhitelisted = isDomainExcluded(hostname, whitelist);
  const isSessionBypassed = isDomainExcluded(hostname, sessionBypassed);

  let state = "idle";
  let statusText = "Non-Belgian domain (Inactive)";

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
    statusText = "Active — Forcing French (fr-FR)";
  } else if (isAliexpress) {
    state = "active";
    statusText = "Active (AliExpress) — Forcing French (fr.aliexpress.com)";
  } else if (isFrenchSub) {
    state = "active";
    statusText = "Active — French subdomain (fr.*)";
  }

  return {
    enabled,
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
    const session = await getSessionData();
    if (session.pendingRedirects && session.pendingRedirects[tabId]) {
      delete session.pendingRedirects[tabId];
      await setSessionData({ pendingRedirects: session.pendingRedirects });
    }
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

    if (message.type === "RESET_SESSION_BYPASS") {
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
    const { enabled } = await getSyncData();
    if (enabled === undefined) {
      await api.storage.sync.set({ enabled: true, whitelist: [] });
    }
    await setSessionData({ sessionBypassed: [], pendingRedirects: {} });
    await syncDnrRules();
  });
}

if (api.runtime?.onStartup) {
  api.runtime.onStartup.addListener(async () => {
    await setSessionData({ sessionBypassed: [], pendingRedirects: {} });
    await syncDnrRules();
  });
}

// Export for Node.js unit tests
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getPrimaryDomain,
    isDomainExcluded,
    rewriteLocaleString,
    isDutchUrl,
    rewriteUrl,
    RULE_ID_ACCEPT_LANGUAGE,
    FRENCH_ACCEPT_LANGUAGE,
    REDIRECT_LOOP_WINDOW_MS
  };
}
