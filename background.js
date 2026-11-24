/**
 * BE Locale Switcher - Background Script
 * Lightweight, privacy-friendly Manifest V3 extension for Chromium and Firefox.
 * Focuses purely on Accept-Language locale modifications via declarativeNetRequest:
 *  - Automatically applies to all Belgian (.be) websites.
 *  - Allows manually adding any custom domain to an injection whitelist.
 */

// Cross-browser compatibility shim
const api = globalThis.browser ?? globalThis.chrome ?? {};

// Core Constants
const RULE_ID_BE_DOMAINS = 1;
const RULE_ID_CUSTOM_DOMAINS = 2;

const FRENCH_ACCEPT_LANGUAGE = "fr-FR,fr;q=0.9,fr-BE;q=0.8,en;q=0.7";
const DUTCH_ACCEPT_LANGUAGE = "nl-BE,nl;q=0.9,nl-NL;q=0.8,en;q=0.7";

// In-memory sync fallback for test environments
let memorySyncStore = {
  enabled: true,
  targetLanguage: "fr",
  customDomains: [],
  excludedBeDomains: []
};

// =============================================================================
// Domain Utilities
// =============================================================================

/**
 * Checks if a hostname belongs to the Belgian country-code TLD (.be).
 */
function isBeDomain(hostname) {
  if (!hostname || typeof hostname !== "string") return false;
  const clean = hostname.toLowerCase().trim();
  return clean === "be" || clean.endsWith(".be");
}

/**
 * Normalizes a raw string, URL, or domain input into a clean hostname.
 */
function normalizeDomain(input) {
  if (!input || typeof input !== "string") return "";
  let clean = input.trim().toLowerCase();
  // Strip protocol if present
  clean = clean.replace(/^[a-z]+:\/\//i, "");
  // Strip port, path, query, and trailing slash
  clean = clean.split("/")[0].split("?")[0].split("#")[0].split(":")[0];
  return clean;
}

/**
 * Checks if a hostname matches any domain in a list (exact match or subdomain match).
 */
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
// Storage Access
// =============================================================================

async function getSyncData() {
  if (api.storage?.sync) {
    try {
      const data = await api.storage.sync.get(["enabled", "targetLanguage", "customDomains", "excludedBeDomains"]);
      return {
        enabled: data.enabled !== undefined ? data.enabled : true,
        targetLanguage: data.targetLanguage === "nl" ? "nl" : "fr",
        customDomains: Array.isArray(data.customDomains) ? data.customDomains : [],
        excludedBeDomains: Array.isArray(data.excludedBeDomains) ? data.excludedBeDomains : []
      };
    } catch (err) {
      console.warn("[BE Locale Switcher] storage.sync.get error:", err);
    }
  }
  return { ...memorySyncStore };
}

async function setSyncData(updates) {
  memorySyncStore = { ...memorySyncStore, ...updates };
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

/**
 * Builds declarativeNetRequest rules for .be and custom domains.
 */
function buildDnrRules(syncData) {
  const { enabled, targetLanguage, customDomains, excludedBeDomains } = syncData;
  if (!enabled) return [];

  const targetHeader = targetLanguage === "nl" ? DUTCH_ACCEPT_LANGUAGE : FRENCH_ACCEPT_LANGUAGE;
  const rules = [];

  // Rule 1: All Belgian (.be) domains (except any explicitly excluded)
  const beRule = {
    id: RULE_ID_BE_DOMAINS,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        {
          header: "accept-language",
          operation: "set",
          value: targetHeader
        }
      ]
    },
    condition: {
      regexFilter: "^https?://[^/:]+\\.be(:[0-9]+)?/",
      resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest"]
    }
  };

  if (excludedBeDomains && excludedBeDomains.length > 0) {
    beRule.condition.excludedDomains = excludedBeDomains.slice(0, 100);
  }
  rules.push(beRule);

  // Rule 2: Custom domains whitelist where locale should be injected
  if (customDomains && customDomains.length > 0) {
    rules.push({
      id: RULE_ID_CUSTOM_DOMAINS,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          {
            header: "accept-language",
            operation: "set",
            value: targetHeader
          }
        ]
      },
      condition: {
        domains: customDomains.slice(0, 100),
        resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest"]
      }
    });
  }

  return rules;
}

/**
 * Synchronizes browser declarativeNetRequest rules with extension settings.
 */
async function syncDnrRules() {
  if (!api.declarativeNetRequest?.updateDynamicRules) {
    return;
  }

  try {
    const syncData = await getSyncData();
    const rulesToAdd = buildDnrRules(syncData);

    await api.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [RULE_ID_BE_DOMAINS, RULE_ID_CUSTOM_DOMAINS],
      addRules: rulesToAdd
    });
  } catch (err) {
    console.error("[BE Locale Switcher] Failed to update DNR rules:", err);
  }
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
      await api.action.setBadgeBackgroundColor({ tabId, color: "#2563eb" }); // Blue
    } else if (state === "active_custom") {
      await api.action.setBadgeText({ tabId, text: targetLanguage.toUpperCase() });
      await api.action.setBadgeBackgroundColor({ tabId, color: "#059669" }); // Emerald
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

/**
 * Returns comprehensive status for a given URL (used by the popup).
 */
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

// Listen to URL updates in tabs to refresh toolbar badge
if (api.tabs?.onUpdated) {
  api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const tabUrl = changeInfo.url || tab?.url;
    if (tabUrl) {
      refreshTabBadge(tabId, tabUrl);
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
        if (!domain) return;

        if (isBeDomain(domain)) {
          // Toggle .be exclusion
          let list = [...data.excludedBeDomains];
          if (list.includes(domain)) {
            list = list.filter((d) => d !== domain);
          } else {
            list.push(domain);
          }
          await setSyncData({ excludedBeDomains: list });
        } else {
          // Toggle custom domain inclusion
          let list = [...data.customDomains];
          if (list.includes(domain)) {
            list = list.filter((d) => d !== domain);
          } else {
            list.push(domain);
          }
          await setSyncData({ customDomains: list });
        }

        await syncDnrRules();
        sendResponse?.({ status: "ok" });
      });
      return true;
    }

    if (message.type === "ADD_CUSTOM_DOMAIN") {
      getSyncData().then(async (data) => {
        const domain = normalizeDomain(message.domain);
        if (!domain) {
          sendResponse?.({ status: "error", message: "Invalid domain" });
          return;
        }
        const list = Array.from(new Set([...data.customDomains, domain]));
        await setSyncData({ customDomains: list });
        await syncDnrRules();
        sendResponse?.({ status: "ok" });
      });
      return true;
    }

    if (message.type === "REMOVE_CUSTOM_DOMAIN") {
      getSyncData().then(async (data) => {
        const domain = normalizeDomain(message.domain);
        const list = data.customDomains.filter((d) => d !== domain);
        await setSyncData({ customDomains: list });
        await syncDnrRules();
        sendResponse?.({ status: "ok" });
      });
      return true;
    }
  });
}

// Storage change listener to keep DNR rules in sync
if (api.storage?.onChanged) {
  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync") {
      syncDnrRules();
    }
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
    buildDnrRules,
    syncDnrRules,
    getSyncData,
    setSyncData,
    getStatusForUrl,
    FRENCH_ACCEPT_LANGUAGE,
    DUTCH_ACCEPT_LANGUAGE,
    RULE_ID_BE_DOMAINS,
    RULE_ID_CUSTOM_DOMAINS
  };
}
