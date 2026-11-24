/**
 * BE Locale Switcher - Background Script
 * Lightweight, privacy-friendly Manifest V3 extension for Chromium and Firefox.
 * 
 * 1. Primary mechanism: Modifies Accept-Language headers via declarativeNetRequest
 *    on all Belgian (.be) websites and user-selected custom domains.
 * 2. Fallback mechanism: If a hardcoded redirect still forces Dutch ('nl') into the
 *    URL (e.g. ikea.com/be/nl/, mediamarkt.be/nl/) despite header injection,
 *    it seamlessly rewrites the URL to the target language with loop protection.
 */

// Cross-browser compatibility shim
const api = globalThis.browser ?? globalThis.chrome ?? {};

// Core Constants
const RULE_ID_BE_DOMAINS = 1;
const RULE_ID_CUSTOM_DOMAINS = 2;
const MAX_DNR_DOMAINS = 100;

const FRENCH_ACCEPT_LANGUAGE = "fr-FR,fr;q=0.9,fr-BE;q=0.8,en;q=0.7";
const DUTCH_ACCEPT_LANGUAGE = "nl-BE,nl;q=0.9,nl-NL;q=0.8,en;q=0.7";

const VALID_DOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const GOOGLE_SEARCH_HOSTS = new Set(["google.be", "www.google.be", "google.com", "www.google.com"]);

const SESSION_BYPASS_KEY = "sessionBypassedHosts";
const TAB_HISTORY_KEY = "tabRedirectHistory";
const SESSION_HISTORY_TTL_MS = 10000;

// Fallback tracking & loop protection (persisted in storage.session across SW restarts)
const tabRedirectHistory = new Map(); // tabId -> { fromUrl, toUrl, timestamp, domain }
const sessionBypassedHosts = new Set(); // normalized hostnames bypassed after server bounce-back
let sessionLoaded = false;
let sessionLoadPromise = null;

// Sync storage cache and fallback store for test environments
let cachedSyncData = null;
let syncLoadPromise = null;
let memorySyncStore = {
  enabled: true,
  targetLanguage: "fr",
  customDomains: [],
  excludedBeDomains: []
};

// =============================================================================
// Language & String Utilities
// =============================================================================

function getLanguagePair(targetLang = "fr") {
  const target = targetLang === "nl" ? "nl" : "fr";
  const source = target === "fr" ? "nl" : "fr";
  return { source, target };
}

function applyCase(sample, target) {
  const upper = target.toUpperCase();
  const lower = target.toLowerCase();
  let out = "";
  for (let i = 0; i < target.length; i++) {
    out += sample[i] && sample[i] !== sample[i].toLowerCase() ? upper[i] : lower[i];
  }
  return out;
}

// =============================================================================
// Domain Utilities
// =============================================================================

function isBeDomain(hostname) {
  if (!hostname || typeof hostname !== "string") return false;
  const clean = hostname.toLowerCase().trim();
  return clean === "be" || clean.endsWith(".be");
}

/**
 * Normalizes a URL or domain string into a validated domain name, stripping
 * protocol, port, path, and leading "www.". Returns "" if invalid.
 */
function normalizeDomain(input) {
  if (!input || typeof input !== "string") return "";
  let clean = input.trim().toLowerCase();
  if (!clean) return "";
  try {
    const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(clean) ? clean : `http://${clean}`;
    clean = new URL(withProto).hostname.toLowerCase();
  } catch {
    return "";
  }
  clean = clean.replace(/^www\./i, "").replace(/\.+$/, "");
  return VALID_DOMAIN_REGEX.test(clean) ? clean : "";
}

function isDomainMatching(hostname, domainList = []) {
  if (!hostname || !Array.isArray(domainList)) return false;
  const cleanHost = normalizeDomain(hostname);
  return domainList.some((entry) => {
    const cleanEntry = normalizeDomain(entry);
    if (!cleanEntry) return false;
    return cleanHost === cleanEntry || cleanHost.endsWith("." + cleanEntry);
  });
}

// =============================================================================
// Fallback URL Rewriter
// =============================================================================

/**
 * Fallback URL Rewriter:
 * Triggered if a URL still has the source language in its path/subdomain
 * despite the Accept-Language header injection.
 */
function fallbackRewriteUrl(inputUrl, targetLang = "fr", customDomains = [], excludedBeDomains = []) {
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

  // Protect domestic sites of the source language (.nl in French mode, .fr in Dutch mode)
  if (tld === source) {
    return null;
  }

  const isBe = isBeDomain(hostname);
  const isExcludedBe = isBe && isDomainMatching(hostname, excludedBeDomains);
  const isCustom = isDomainMatching(hostname, customDomains);
  const isTargetSite = (isBe && !isExcludedBe) || isCustom;

  let changed = false;

  // 1. Subdomain: nl.example.be -> fr.example.be (on targeted sites)
  if (isTargetSite && hostParts.length > 2) {
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

  // 2. Path segments:
  // - On ANY domain: two-segment Belgian paths like /be/nl/ -> /be/fr/ or /nl-be/ -> /fr-be/ (e.g. ikea.com/be/nl/)
  // - On targeted sites (.be or custom domains): /nl/ -> /fr/
  const segments = urlObj.pathname.split("/");
  let pathChanged = false;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segLower = seg.toLowerCase();

    // Two-segment Belgian paths: /be/nl/ <-> /be/fr/
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

    // Compound Belgian codes: /nl-be/ <-> /fr-be/, /be-nl/ <-> /be-fr/
    if (new RegExp(`^${source}[-_]be$`, "i").test(seg)) {
      const sep = seg.includes("-") ? "-" : "_";
      const bePart = seg.slice(3);
      const targetPart = applyCase(seg.slice(0, 2), target);
      segments[i] = `${targetPart}${sep}${bePart}`;
      pathChanged = true;
    }

    if (new RegExp(`^be[-_]${source}$`, "i").test(seg)) {
      const sep = seg.includes("-") ? "-" : "_";
      const bePart = seg.slice(0, 2);
      const targetPart = applyCase(seg.slice(3, 5), target);
      segments[i] = `${bePart}${sep}${targetPart}`;
      pathChanged = true;
    }

    // Single language code: /nl/ <-> /fr/ (only on targeted sites)
    if (isTargetSite && segLower === source) {
      segments[i] = applyCase(seg, target);
      pathChanged = true;
    }
  }

  if (pathChanged) {
    urlObj.pathname = segments.join("/");
    changed = true;
  }

  // 3. Query parameters (e.g. ?lang=nl -> ?lang=fr on targeted sites)
  if (isTargetSite && urlObj.search.length > 1) {
    const langKeyRegex = /^(.*_)?(lang|locale|language|lng|hl|lr)$/i;
    const updates = [];

    for (const [key, val] of urlObj.searchParams.entries()) {
      if (!langKeyRegex.test(key)) continue;

      if (val.toLowerCase() === source) {
        updates.push([key, applyCase(val, target)]);
      } else if (new RegExp(`^${source}[-_]be$`, "i").test(val)) {
        const sep = val.includes("-") ? "-" : "_";
        const bePart = val.slice(3);
        const targetPart = applyCase(val.slice(0, 2), target);
        updates.push([key, `${targetPart}${sep}${bePart}`]);
      } else if (new RegExp(`^lang_${source}$`, "i").test(val)) {
        updates.push([key, `lang_${target}`]);
      }
    }

    for (const [key, newVal] of updates) {
      urlObj.searchParams.set(key, newVal);
      changed = true;
    }
  }

  // 4. Google Search interface language enforcement (on targeted sites: google.be or custom google.com)
  if (isTargetSite && GOOGLE_SEARCH_HOSTS.has(hostname)) {
    const p = urlObj.pathname.toLowerCase();
    if (p === "/" || p === "/search" || p === "/webhp") {
      const currentHl = urlObj.searchParams.get("hl");
      const lowerHl = currentHl ? currentHl.toLowerCase() : "";
      if (!currentHl || lowerHl === source || lowerHl.startsWith(source + "-") || lowerHl.startsWith(source + "_")) {
        urlObj.searchParams.set("hl", target);
        changed = true;
      }
    }
  }

  return changed ? urlObj.toString() : null;
}

// =============================================================================
// Session Persistence & Navigation Fallback
// =============================================================================

async function ensureSessionLoaded() {
  if (sessionLoaded || !api.storage?.session) {
    sessionLoaded = true;
    return;
  }
  if (!sessionLoadPromise) {
    sessionLoadPromise = api.storage.session
      .get([SESSION_BYPASS_KEY, TAB_HISTORY_KEY])
      .then((data) => {
        if (Array.isArray(data[SESSION_BYPASS_KEY])) {
          for (const host of data[SESSION_BYPASS_KEY]) {
            sessionBypassedHosts.add(host);
          }
        }
        if (data[TAB_HISTORY_KEY] && typeof data[TAB_HISTORY_KEY] === "object") {
          const cutoff = Date.now() - SESSION_HISTORY_TTL_MS;
          for (const [tabKey, entry] of Object.entries(data[TAB_HISTORY_KEY])) {
            if (entry && entry.timestamp > cutoff) {
              tabRedirectHistory.set(Number(tabKey), entry);
            }
          }
        }
        sessionLoaded = true;
      })
      .catch((err) => {
        console.warn("[BE Locale Switcher] storage.session.get error:", err);
      })
      .finally(() => {
        sessionLoadPromise = null;
      });
  }
  await sessionLoadPromise;
}

async function persistSessionState() {
  if (!api.storage?.session) return;
  const cutoff = Date.now() - SESSION_HISTORY_TTL_MS;
  const historyObj = {};
  for (const [tabId, entry] of tabRedirectHistory.entries()) {
    if (entry && entry.timestamp > cutoff) {
      historyObj[String(tabId)] = entry;
    } else {
      tabRedirectHistory.delete(tabId);
    }
  }
  try {
    await api.storage.session.set({
      [SESSION_BYPASS_KEY]: Array.from(sessionBypassedHosts),
      [TAB_HISTORY_KEY]: historyObj
    });
  } catch (err) {
    console.warn("[BE Locale Switcher] storage.session.set error:", err);
  }
}

/**
 * Handles fallback navigation checks in real time when URL changes in tabs.
 */
async function handleUrlNavigationFallback(tabId, url) {
  if (!tabId || !url) return;

  let urlObj;
  try {
    urlObj = new URL(url);
  } catch {
    return;
  }
  if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") return;

  await ensureSessionLoaded();

  const hostname = urlObj.hostname.toLowerCase();
  const bypassKey = normalizeDomain(hostname) || hostname;
  const syncData = await getSyncData();
  const { enabled, targetLanguage, customDomains, excludedBeDomains } = syncData;

  if (!enabled) return;

  // If this host was bypassed due to server bounce-back, skip fallback redirect
  if (sessionBypassedHosts.has(bypassKey)) return;

  const now = Date.now();
  const last = tabRedirectHistory.get(tabId);

  // 1. Ignore in-flight browser events for the original URL (within 800ms)
  if (last && (now - last.timestamp < 800)) {
    if (url.replace(/\/$/, "") === last.fromUrl.replace(/\/$/, "")) {
      return;
    }
  }

  // 2. Loop Guard: If we redirected within 5s and server bounced back to fromUrl after >800ms
  if (last && (now - last.timestamp < 5000)) {
    const isSameHost =
      hostname === last.domain ||
      hostname.endsWith("." + last.domain) ||
      last.domain.endsWith("." + hostname);
    if (isSameHost && url.replace(/\/$/, "") === last.fromUrl.replace(/\/$/, "")) {
      console.warn(`[BE Locale Switcher] Server bounce detected on ${hostname}. Bypassing fallback for this session.`);
      sessionBypassedHosts.add(bypassKey);
      tabRedirectHistory.delete(tabId);
      await persistSessionState();
      return;
    }
  }

  // 3. Check if URL contains source language despite header injection
  const rewrittenUrl = fallbackRewriteUrl(url, targetLanguage, customDomains, excludedBeDomains);
  if (rewrittenUrl && rewrittenUrl !== url) {
    tabRedirectHistory.set(tabId, {
      fromUrl: url,
      toUrl: rewrittenUrl,
      domain: hostname,
      timestamp: now
    });
    await persistSessionState();

    try {
      await api.tabs.update(tabId, { url: rewrittenUrl });
    } catch (err) {
      console.error("[BE Locale Switcher] Fallback tabs.update error:", err);
    }
  }
}

// =============================================================================
// Storage Access (with In-Memory Cache)
// =============================================================================

function normalizeSyncData(data = {}) {
  return {
    enabled: data.enabled !== undefined ? !!data.enabled : true,
    targetLanguage: data.targetLanguage === "nl" ? "nl" : "fr",
    customDomains: Array.isArray(data.customDomains) ? data.customDomains : [],
    excludedBeDomains: Array.isArray(data.excludedBeDomains) ? data.excludedBeDomains : []
  };
}

async function getSyncData() {
  if (cachedSyncData) {
    return {
      ...cachedSyncData,
      customDomains: [...cachedSyncData.customDomains],
      excludedBeDomains: [...cachedSyncData.excludedBeDomains]
    };
  }

  if (api.storage?.sync) {
    if (!syncLoadPromise) {
      syncLoadPromise = api.storage.sync
        .get(["enabled", "targetLanguage", "customDomains", "excludedBeDomains"])
        .then((data) => {
          cachedSyncData = normalizeSyncData(data);
          return cachedSyncData;
        })
        .catch((err) => {
          console.warn("[BE Locale Switcher] storage.sync.get error:", err);
          return normalizeSyncData(memorySyncStore);
        })
        .finally(() => {
          syncLoadPromise = null;
        });
    }
    const loaded = await syncLoadPromise;
    return {
      ...loaded,
      customDomains: [...loaded.customDomains],
      excludedBeDomains: [...loaded.excludedBeDomains]
    };
  }

  return normalizeSyncData({
    ...memorySyncStore,
    customDomains: [...memorySyncStore.customDomains],
    excludedBeDomains: [...memorySyncStore.excludedBeDomains]
  });
}

async function setSyncData(updates) {
  memorySyncStore = normalizeSyncData({ ...memorySyncStore, ...updates });
  if (cachedSyncData) {
    cachedSyncData = normalizeSyncData({ ...cachedSyncData, ...updates });
  }
  if (api.storage?.sync) {
    try {
      await api.storage.sync.set(updates);
    } catch (err) {
      console.warn("[BE Locale Switcher] storage.sync.set error:", err);
    }
  }
}

// =============================================================================
// DeclarativeNetRequest Rule Synchronization
// =============================================================================

function sanitizeDomainList(domains = []) {
  const unique = new Set();
  for (const entry of domains) {
    const normalized = normalizeDomain(entry);
    if (normalized) {
      unique.add(normalized);
    }
  }
  return Array.from(unique).slice(0, MAX_DNR_DOMAINS);
}

function createModifyHeadersAction(targetHeader) {
  return {
    type: "modifyHeaders",
    requestHeaders: [
      {
        header: "accept-language",
        operation: "set",
        value: targetHeader
      }
    ]
  };
}

function buildDnrRules(syncData) {
  const { enabled, targetLanguage, customDomains, excludedBeDomains } = syncData;
  if (!enabled) return [];

  const targetHeader = targetLanguage === "nl" ? DUTCH_ACCEPT_LANGUAGE : FRENCH_ACCEPT_LANGUAGE;
  const rules = [];

  // Rule 1: All Belgian (.be) domains (except any explicitly excluded)
  const beRule = {
    id: RULE_ID_BE_DOMAINS,
    priority: 1,
    action: createModifyHeadersAction(targetHeader),
    condition: {
      regexFilter: "^https?://[^/:]+\\.be(:[0-9]+)?/",
      resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest"]
    }
  };

  const cleanExcluded = sanitizeDomainList(excludedBeDomains);
  if (cleanExcluded.length > 0) {
    beRule.condition.excludedRequestDomains = cleanExcluded;
  }
  rules.push(beRule);

  // Rule 2: Custom domains whitelist where locale should be injected
  const cleanCustom = sanitizeDomainList(customDomains);
  if (cleanCustom.length > 0) {
    rules.push({
      id: RULE_ID_CUSTOM_DOMAINS,
      priority: 1,
      action: createModifyHeadersAction(targetHeader),
      condition: {
        requestDomains: cleanCustom,
        resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest"]
      }
    });
  }

  return rules;
}

let dnrSyncPromise = null;
let dnrSyncPending = false;
let lastAppliedRulesJson = null;

async function syncDnrRules() {
  if (!api.declarativeNetRequest?.updateDynamicRules) {
    return;
  }

  if (dnrSyncPromise) {
    dnrSyncPending = true;
    return dnrSyncPromise;
  }

  dnrSyncPromise = (async () => {
    do {
      dnrSyncPending = false;
      try {
        const syncData = await getSyncData();
        const rulesToAdd = buildDnrRules(syncData);
        const rulesJson = JSON.stringify(rulesToAdd);
        if (rulesJson === lastAppliedRulesJson) {
          continue;
        }

        await api.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: [RULE_ID_BE_DOMAINS, RULE_ID_CUSTOM_DOMAINS],
          addRules: rulesToAdd
        });
        lastAppliedRulesJson = rulesJson;
      } catch (err) {
        console.error("[BE Locale Switcher] Failed to update DNR rules:", err);
      }
    } while (dnrSyncPending);
  })().finally(() => {
    dnrSyncPromise = null;
  });

  return dnrSyncPromise;
}

// =============================================================================
// Toolbar Badge & Status
// =============================================================================

async function updateBadge(tabId, state, targetLanguage = "fr") {
  if (!api.action?.setBadgeText || !tabId) return;

  try {
    if (state === "disabled") {
      await api.action.setBadgeText({ tabId, text: "OFF" });
      await api.action.setBadgeBackgroundColor({ tabId, color: "#64748b" });
    } else if (state === "active_be") {
      await api.action.setBadgeText({ tabId, text: targetLanguage.toUpperCase() });
      await api.action.setBadgeBackgroundColor({ tabId, color: "#2563eb" });
    } else if (state === "active_custom") {
      await api.action.setBadgeText({ tabId, text: targetLanguage.toUpperCase() });
      await api.action.setBadgeBackgroundColor({ tabId, color: "#059669" });
    } else {
      await api.action.setBadgeText({ tabId, text: "" });
    }
  } catch {}
}

async function refreshTabBadge(tabId, url) {
  if (!tabId || !url) return;
  try {
    const urlObj = new URL(url);
    if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
      await updateBadge(tabId, "idle");
      return;
    }

    const hostname = urlObj.hostname.toLowerCase();
    const { enabled, targetLanguage, customDomains, excludedBeDomains } = await getSyncData();

    if (!enabled) {
      await updateBadge(tabId, "disabled", targetLanguage);
      return;
    }

    if (isBeDomain(hostname)) {
      if (isDomainMatching(hostname, excludedBeDomains)) {
        await updateBadge(tabId, "idle", targetLanguage);
      } else {
        await updateBadge(tabId, "active_be", targetLanguage);
      }
    } else if (isDomainMatching(hostname, customDomains)) {
      await updateBadge(tabId, "active_custom", targetLanguage);
    } else {
      await updateBadge(tabId, "idle", targetLanguage);
    }
  } catch {
    await updateBadge(tabId, "idle");
  }
}

async function getStatusForUrl(url) {
  const syncData = await getSyncData();
  const { enabled, targetLanguage, customDomains, excludedBeDomains } = syncData;

  let hostname = "";
  let isBe = false;
  let isCustom = false;
  let isExcludedBe = false;

  if (url) {
    try {
      const urlObj = new URL(url);
      hostname = urlObj.hostname.toLowerCase();
      isBe = isBeDomain(hostname);
      isCustom = isDomainMatching(hostname, customDomains);
      isExcludedBe = isBe && isDomainMatching(hostname, excludedBeDomains);
    } catch {}
  }

  const isInjecting = enabled && ((isBe && !isExcludedBe) || isCustom);

  return {
    enabled,
    targetLanguage,
    customDomains,
    excludedBeDomains,
    hostname,
    isBe,
    isCustom,
    isExcludedBe,
    isInjecting
  };
}

// =============================================================================
// Event Listeners
// =============================================================================

// Listen to URL updates in tabs for badge and fallback redirect
if (api.tabs?.onUpdated) {
  api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const tabUrl = changeInfo.url || tab?.url;
    if (!tabUrl) return;

    if (changeInfo.url || changeInfo.status === "loading" || changeInfo.status === "complete") {
      refreshTabBadge(tabId, tabUrl);
    }
    if (changeInfo.url) {
      handleUrlNavigationFallback(tabId, changeInfo.url);
    }
  });
}

// Clean up tab history when tab is closed
if (api.tabs?.onRemoved) {
  api.tabs.onRemoved.addListener(async (tabId) => {
    await ensureSessionLoaded();
    if (tabRedirectHistory.delete(tabId)) {
      await persistSessionState();
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

function toggleDomainInList(existingList, domain, maxLimit) {
  const isPresent = existingList.some((d) => d === domain || normalizeDomain(d) === domain);
  if (isPresent) {
    return {
      list: existingList.filter((d) => d !== domain && normalizeDomain(d) !== domain)
    };
  }
  if (existingList.length >= maxLimit) {
    return { error: `Maximum of ${maxLimit} domains reached` };
  }
  return { list: [...existingList, domain] };
}

// Message listener for popup interactions
if (api.runtime?.onMessage) {
  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "GET_STATUS") {
      getStatusForUrl(message.url).then(sendResponse);
      return true;
    }

    if (message.type === "SET_ENABLED") {
      setSyncData({ enabled: !!message.enabled }).then(async () => {
        await syncDnrRules();
        sendResponse?.({ status: "ok" });
      });
      return true;
    }

    if (message.type === "SET_TARGET_LANGUAGE") {
      const targetLang = message.language === "nl" ? "nl" : "fr";
      setSyncData({ targetLanguage: targetLang }).then(async () => {
        await syncDnrRules();
        sendResponse?.({ status: "ok", targetLanguage: targetLang });
      });
      return true;
    }

    if (message.type === "TOGGLE_CURRENT_SITE") {
      getSyncData().then(async (data) => {
        const domain = normalizeDomain(message.domain);
        if (!domain) {
          sendResponse?.({ status: "error", message: "Invalid domain" });
          return;
        }

        const field = isBeDomain(domain) ? "excludedBeDomains" : "customDomains";
        const result = toggleDomainInList(data[field], domain, MAX_DNR_DOMAINS);
        if (result.error) {
          sendResponse?.({ status: "error", message: result.error });
          return;
        }

        await setSyncData({ [field]: result.list });
        await syncDnrRules();
        sendResponse?.({ status: "ok", domain });
      });
      return true;
    }

    if (message.type === "ADD_CUSTOM_DOMAIN") {
      getSyncData().then(async (data) => {
        const domain = normalizeDomain(message.domain);
        if (!domain) {
          sendResponse?.({ status: "error", message: "Enter a valid domain (e.g. aliexpress.com)" });
          return;
        }
        if (isBeDomain(domain)) {
          sendResponse?.({ status: "error", message: ".be domains are already injected by default" });
          return;
        }
        if (data.customDomains.some((d) => d === domain || normalizeDomain(d) === domain)) {
          sendResponse?.({ status: "ok", domain });
          return;
        }
        if (data.customDomains.length >= MAX_DNR_DOMAINS) {
          sendResponse?.({ status: "error", message: `Maximum of ${MAX_DNR_DOMAINS} custom domains reached` });
          return;
        }
        const list = [...data.customDomains, domain];
        await setSyncData({ customDomains: list });
        await syncDnrRules();
        sendResponse?.({ status: "ok", domain });
      });
      return true;
    }

    if (message.type === "REMOVE_CUSTOM_DOMAIN") {
      getSyncData().then(async (data) => {
        const raw = typeof message.domain === "string" ? message.domain.trim().toLowerCase() : "";
        const domain = normalizeDomain(message.domain);
        const list = data.customDomains.filter((d) => d !== raw && (!domain || normalizeDomain(d) !== domain));
        await setSyncData({ customDomains: list });
        await syncDnrRules();
        sendResponse?.({ status: "ok" });
      });
      return true;
    }
  });
}

// Storage change listener to keep cache and DNR rules in sync
if (api.storage?.onChanged) {
  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;
    if (cachedSyncData) {
      const updated = { ...cachedSyncData };
      for (const [key, change] of Object.entries(changes)) {
        if (change) {
          updated[key] = change.newValue;
        }
      }
      cachedSyncData = normalizeSyncData(updated);
    }
    syncDnrRules();
  });
}

// Lifecycle Handlers
if (api.runtime?.onInstalled) {
  api.runtime.onInstalled.addListener(async () => {
    await syncDnrRules();
  });
}

if (api.runtime?.onStartup) {
  api.runtime.onStartup.addListener(async () => {
    await syncDnrRules();
  });
}

// =============================================================================
// Exports for Node test environments
// =============================================================================
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    isBeDomain,
    normalizeDomain,
    isDomainMatching,
    getLanguagePair,
    applyCase,
    fallbackRewriteUrl,
    handleUrlNavigationFallback,
    buildDnrRules,
    syncDnrRules,
    getSyncData,
    setSyncData,
    getStatusForUrl,
    ensureSessionLoaded,
    FRENCH_ACCEPT_LANGUAGE,
    DUTCH_ACCEPT_LANGUAGE,
    RULE_ID_BE_DOMAINS,
    RULE_ID_CUSTOM_DOMAINS,
    MAX_DNR_DOMAINS,
    tabRedirectHistory,
    sessionBypassedHosts
  };
}
