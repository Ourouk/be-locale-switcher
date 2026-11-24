/**
 * BE Locale Switcher - Popup Controller
 * Lightweight, privacy-friendly Manifest V3 popup script.
 * Supports bi-directional locale switching (French first vs Dutch first).
 */

const api = globalThis.browser ?? globalThis.chrome;

// DOM Elements
const globalToggle = document.getElementById("global-toggle");
const brandSubtitle = document.getElementById("brand-subtitle");
const langBtnFr = document.getElementById("lang-btn-fr");
const langBtnNl = document.getElementById("lang-btn-nl");
const footerBadge = document.getElementById("footer-badge");
const siteDomainEl = document.getElementById("site-domain");
const statusDot = document.getElementById("status-dot");
const statusTitle = document.getElementById("status-title");
const statusDesc = document.getElementById("status-desc");
const whitelistToggleBtn = document.getElementById("whitelist-toggle-btn");
const whitelistBtnText = document.getElementById("whitelist-btn-text");
const whitelistBtnIcon = document.getElementById("whitelist-btn-icon");
const resetBypassBtn = document.getElementById("reset-bypass-btn");
const permissionBanner = document.getElementById("permission-banner");
const grantPermissionBtn = document.getElementById("grant-permission-btn");
const whitelistAccordionBtn = document.getElementById("whitelist-accordion-btn");
const whitelistAccordionContent = document.getElementById("whitelist-accordion-content");
const whitelistCountLabel = document.getElementById("whitelist-count-label");
const whitelistItemsList = document.getElementById("whitelist-items");

// Local State
let currentTab = null;
let currentStatus = null;

/**
 * Initializes the popup on load.
 */
async function init() {
  await checkFirefoxPermissions();
  await loadCurrentTab();
  await refreshUI();
  setupEventListeners();
}

/**
 * Checks if Firefox requires explicit host permission grant for .be sites.
 */
async function checkFirefoxPermissions() {
  if (!api.permissions?.contains) return;
  try {
    const hasPermission = await api.permissions.contains({
      origins: ["*://*.be/*"]
    });
    if (!hasPermission) {
      permissionBanner.classList.remove("hidden");
    } else {
      permissionBanner.classList.add("hidden");
    }
  } catch (err) {
    console.debug("Permissions check failed or unsupported:", err);
  }
}

/**
 * Queries the active tab in current window.
 */
async function loadCurrentTab() {
  try {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    currentTab = tabs[0] || null;
  } catch (err) {
    console.error("Failed to query active tab:", err);
  }
}

/**
 * Refreshes UI by querying background script for status.
 */
async function refreshUI() {
  const url = currentTab?.url || "";

  try {
    const res = await api.runtime.sendMessage({
      type: "GET_STATUS",
      url
    });

    if (res) {
      currentStatus = res;
      renderStatus(res);
      renderWhitelist(res.whitelist || []);
    }
  } catch (err) {
    console.error("Error communicating with background:", err);
  }
}

/**
 * Renders the active site status and language direction.
 */
function renderStatus(status) {
  // Global Toggle
  globalToggle.checked = status.enabled;

  // Language Direction Selector
  const targetLang = status.targetLanguage === "nl" ? "nl" : "fr";
  if (targetLang === "nl") {
    langBtnNl.classList.add("active");
    langBtnFr.classList.remove("active");
    brandSubtitle.textContent = "Belgian Dutch Enforcer (FR → NL)";
    footerBadge.textContent = "nl-BE • .BE";
  } else {
    langBtnFr.classList.add("active");
    langBtnNl.classList.remove("active");
    brandSubtitle.textContent = "Belgian French Enforcer (NL → FR)";
    footerBadge.textContent = "fr-FR • .BE";
  }

  // Domain text
  if (status.hostname) {
    siteDomainEl.textContent = status.hostname;
    whitelistToggleBtn.disabled = false;
  } else {
    siteDomainEl.textContent = "No active webpage";
    whitelistToggleBtn.disabled = true;
  }

  // Clear previous dot classes
  statusDot.className = "status-dot";

  // State-specific presentation
  if (!status.enabled) {
    statusDot.classList.add("dot-idle");
    statusTitle.textContent = "Extension Disabled";
    statusDesc.textContent = "Websites will use default browser locale";
    resetBypassBtn.classList.add("hidden");
    updateWhitelistButton(status.isWhitelisted, targetLang);
    return;
  }

  if (status.isWhitelisted) {
    statusDot.classList.add("dot-warning");
    statusTitle.textContent = "Whitelisted by User";
    statusDesc.textContent = "Locale enforcement is paused on this site";
    resetBypassBtn.classList.add("hidden");
    updateWhitelistButton(true, targetLang);
    return;
  }

  if (status.isSessionBypassed) {
    statusDot.classList.add("dot-warning");
    statusTitle.textContent = "Temporarily Bypassed";
    statusDesc.textContent = "Redirect loop or 404 detected; bypassed for this session";
    resetBypassBtn.classList.remove("hidden");
    updateWhitelistButton(false, targetLang);
    return;
  }

  resetBypassBtn.classList.add("hidden");

  const langLabel = targetLang === "nl" ? "Dutch (nl-BE)" : "French (fr-FR)";

  if (status.isBe) {
    statusDot.classList.add("dot-active");
    statusTitle.textContent = `Forcing ${langLabel}`;
    statusDesc.textContent = `Headers set to ${targetLang}; Dutch/French URLs rewrite to ${targetLang}`;
    updateWhitelistButton(false, targetLang);
  } else {
    statusDot.classList.add("dot-idle");
    statusTitle.textContent = status.statusText || "Non-Belgian domain (Inactive)";
    statusDesc.textContent = "Extension is active on .be and commercial .com domains";
    updateWhitelistButton(false, targetLang);
  }
}

/**
 * Updates the Whitelist Toggle button label and icon.
 */
function updateWhitelistButton(isWhitelisted, targetLang = "fr") {
  const langName = targetLang === "nl" ? "Dutch" : "French";
  if (isWhitelisted) {
    whitelistBtnIcon.textContent = "✓";
    whitelistBtnText.textContent = `Resume ${langName} for this site`;
    whitelistToggleBtn.classList.remove("btn-secondary");
    whitelistToggleBtn.classList.add("btn-accent");
  } else {
    whitelistBtnIcon.textContent = "🚫";
    whitelistBtnText.textContent = "Ignore this site";
    whitelistToggleBtn.classList.remove("btn-accent");
    whitelistToggleBtn.classList.add("btn-secondary");
  }
}

/**
 * Renders the ignored sites list.
 */
function renderWhitelist(whitelist) {
  whitelistCountLabel.textContent = `Ignored Sites (${whitelist.length})`;
  whitelistItemsList.innerHTML = "";

  if (whitelist.length === 0) {
    const emptyLi = document.createElement("li");
    emptyLi.className = "whitelist-empty";
    emptyLi.textContent = "No sites currently ignored.";
    whitelistItemsList.appendChild(emptyLi);
    return;
  }

  whitelist.forEach((domain) => {
    const li = document.createElement("li");
    li.className = "whitelist-item";

    const span = document.createElement("span");
    span.className = "whitelist-item-domain";
    span.textContent = domain;

    const removeBtn = document.createElement("button");
    removeBtn.className = "whitelist-remove-btn";
    removeBtn.textContent = "✕";
    removeBtn.title = `Remove ${domain} from whitelist`;
    removeBtn.addEventListener("click", () => removeFromWhitelist(domain));

    li.appendChild(span);
    li.appendChild(removeBtn);
    whitelistItemsList.appendChild(li);
  });
}

/**
 * Removes a domain from the whitelist.
 */
async function removeFromWhitelist(domain) {
  try {
    const data = await api.storage.sync.get(["whitelist"]);
    const currentList = Array.isArray(data.whitelist) ? data.whitelist : [];
    const updated = currentList.filter((d) => d.toLowerCase() !== domain.toLowerCase());

    await api.storage.sync.set({ whitelist: updated });
    await api.runtime.sendMessage({ type: "SYNC_RULES" });
    await refreshUI();
  } catch (err) {
    console.error("Failed to remove from whitelist:", err);
  }
}

/**
 * Toggles whitelist state for the current tab's domain.
 */
async function toggleCurrentSiteWhitelist() {
  if (!currentStatus || !currentStatus.hostname) return;

  const targetDomain = currentStatus.primaryDomain || currentStatus.hostname;

  try {
    const data = await api.storage.sync.get(["whitelist"]);
    const currentList = Array.isArray(data.whitelist) ? data.whitelist : [];
    const isCurrentlyWhitelisted = currentStatus.isWhitelisted;

    let updated;
    if (isCurrentlyWhitelisted) {
      updated = currentList.filter((d) => d.toLowerCase() !== targetDomain && d.toLowerCase() !== currentStatus.hostname);
    } else {
      updated = Array.from(new Set([...currentList, targetDomain]));
    }

    await api.storage.sync.set({ whitelist: updated });
    await api.runtime.sendMessage({ type: "SYNC_RULES" });
    await refreshUI();

    if (currentTab?.id) {
      api.tabs.reload(currentTab.id);
    }
  } catch (err) {
    console.error("Failed to toggle whitelist:", err);
  }
}

/**
 * Sets the active target language preference ("fr" or "nl").
 */
async function setTargetLanguage(language) {
  try {
    await api.runtime.sendMessage({
      type: "SET_TARGET_LANGUAGE",
      language
    });
    await refreshUI();
    if (currentTab?.id) {
      api.tabs.reload(currentTab.id);
    }
  } catch (err) {
    console.error("Failed to set target language:", err);
  }
}

/**
 * Sets up user interaction listeners.
 */
function setupEventListeners() {
  // Global Toggle
  globalToggle.addEventListener("change", async (e) => {
    const enabled = e.target.checked;
    await api.storage.sync.set({ enabled });
    await api.runtime.sendMessage({ type: "SYNC_RULES" });
    await refreshUI();
  });

  // Language Direction Buttons
  langBtnFr.addEventListener("click", () => setTargetLanguage("fr"));
  langBtnNl.addEventListener("click", () => setTargetLanguage("nl"));

  // Whitelist Toggle
  whitelistToggleBtn.addEventListener("click", toggleCurrentSiteWhitelist);

  // Reset Session Bypass
  resetBypassBtn.addEventListener("click", async () => {
    if (!currentStatus || !currentStatus.hostname) return;
    const targetDomain = currentStatus.primaryDomain || currentStatus.hostname;
    await api.runtime.sendMessage({
      type: "RESET_SESSION_BYPASS",
      domain: targetDomain
    });
    await refreshUI();
    if (currentTab?.id) {
      api.tabs.reload(currentTab.id);
    }
  });

  // Whitelist Accordion Toggle
  whitelistAccordionBtn.addEventListener("click", () => {
    whitelistAccordionBtn.classList.toggle("accordion-open");
    whitelistAccordionContent.classList.toggle("hidden");
  });

  // Firefox Permission Grant
  grantPermissionBtn.addEventListener("click", async () => {
    try {
      const granted = await api.permissions.request({
        origins: ["*://*.be/*"]
      });
      if (granted) {
        permissionBanner.classList.add("hidden");
        await refreshUI();
      }
    } catch (err) {
      console.error("Permission request failed:", err);
    }
  });
}

// Start
document.addEventListener("DOMContentLoaded", init);
