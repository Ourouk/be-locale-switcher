/**
 * BE Locale Switcher - Popup Controller
 * Minimal, lightweight Manifest V3 popup script.
 * Manages locale selection, active site toggle, and custom domain injection whitelist.
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
const siteActionBtn = document.getElementById("site-action-btn");
const siteActionIcon = document.getElementById("site-action-icon");
const siteActionText = document.getElementById("site-action-text");
const siteError = document.getElementById("site-error");

// Custom Injected Domains Accordion
const customAccordionBtn = document.getElementById("custom-accordion-btn");
const customAccordionContent = document.getElementById("custom-accordion-content");
const customCountLabel = document.getElementById("custom-count-label");
const customDomainInput = document.getElementById("custom-domain-input");
const addDomainBtn = document.getElementById("add-domain-btn");
const customDomainError = document.getElementById("custom-domain-error");
const customDomainItems = document.getElementById("custom-domain-items");

// Excluded .BE Domains Section
const excludedSection = document.getElementById("excluded-section");
const excludedAccordionBtn = document.getElementById("excluded-accordion-btn");
const excludedAccordionContent = document.getElementById("excluded-accordion-content");
const excludedCountLabel = document.getElementById("excluded-count-label");
const excludedDomainItems = document.getElementById("excluded-domain-items");

// Local State
let currentTab = null;
let currentStatus = null;

/**
 * Initializes the popup on load.
 */
async function init() {
  await loadCurrentTab();
  await refreshUI();
  setupEventListeners();
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
      clearInlineError(siteError);
      renderStatus(res);
      renderCustomDomains(res.customDomains || []);
      renderExcludedDomains(res.excludedBeDomains || []);
    }
  } catch (err) {
    console.error("Error communicating with background:", err);
  }
}

/**
 * Renders the active site card and language direction.
 */
function renderStatus(status) {
  const targetLang = status.targetLanguage || "fr";

  // Global toggle state
  globalToggle.checked = !!status.enabled;

  // Language buttons
  if (targetLang === "nl") {
    langBtnNl.classList.add("active");
    langBtnFr.classList.remove("active");
    brandSubtitle.textContent = "Dutch (nl-BE) Locale Enforcer";
    footerBadge.textContent = "nl-BE • .BE";
  } else {
    langBtnFr.classList.add("active");
    langBtnNl.classList.remove("active");
    brandSubtitle.textContent = "French (fr-FR) Locale Enforcer";
    footerBadge.textContent = "fr-FR • .BE";
  }

  // Active site hostname
  const hostname = status.hostname || (currentTab?.url ? "Unknown Domain" : "No Active Page");
  siteDomainEl.textContent = hostname;
  siteDomainEl.title = hostname;

  // Reset indicator dots
  statusDot.className = "status-dot";

  if (!status.enabled) {
    statusDot.classList.add("dot-idle");
    statusTitle.textContent = "Extension Disabled";
    statusDesc.textContent = "Toggle on to inject Accept-Language headers";
    siteActionBtn.disabled = true;
    siteActionIcon.textContent = "⚡";
    siteActionText.textContent = "Disabled";
    return;
  }

  if (!status.hostname) {
    statusDot.classList.add("dot-idle");
    statusTitle.textContent = "No Web Page";
    statusDesc.textContent = "Navigate to a website to manage locale settings";
    siteActionBtn.disabled = true;
    siteActionIcon.textContent = "⚡";
    siteActionText.textContent = "No Active Site";
    return;
  }

  siteActionBtn.disabled = false;
  const langName = targetLang === "nl" ? "Dutch (nl-BE)" : "French (fr-FR)";

  if (status.isBe) {
    if (status.isExcludedBe) {
      statusDot.classList.add("dot-idle");
      statusTitle.textContent = "Excluded .BE Site";
      statusDesc.textContent = "Headers are untouched for this domain";
      siteActionIcon.textContent = "✓";
      siteActionText.textContent = "Re-enable on this .be site";
    } else {
      statusDot.classList.add("dot-active");
      statusTitle.textContent = `Injecting ${langName}`;
      statusDesc.textContent = `Default .be site: Accept-Language forced to ${targetLang}`;
      siteActionIcon.textContent = "🚫";
      siteActionText.textContent = "Exclude this .be site";
    }
  } else {
    if (status.isCustom) {
      statusDot.classList.add("dot-active");
      statusTitle.textContent = `Injecting ${langName}`;
      statusDesc.textContent = `Injected via custom domain whitelist`;
      siteActionIcon.textContent = "➖";
      siteActionText.textContent = "Remove from custom domains";
    } else {
      statusDot.classList.add("dot-idle");
      statusTitle.textContent = "Not Injected";
      statusDesc.textContent = "Headers are untouched on this non-.be domain";
      siteActionIcon.textContent = "➕";
      siteActionText.textContent = "Inject locale on this domain";
    }
  }
}

/**
 * Checks whether an active tab hostname equals or is a subdomain of a domain entry.
 */
function isHostnameMatching(hostname, domain) {
  if (!hostname || !domain) return false;
  const cleanHost = hostname.toLowerCase().replace(/^www\./, "");
  const cleanDomain = domain.toLowerCase().replace(/^www\./, "");
  return cleanHost === cleanDomain || cleanHost.endsWith("." + cleanDomain);
}

function showInlineError(el, message) {
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
}

function clearInlineError(el) {
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
}

/**
 * Renders a list of domains with remove buttons into a target UL container.
 */
function renderDomainList(container, domains, { emptyMessage, removeTitlePrefix, onRemove }) {
  container.innerHTML = "";

  if (domains.length === 0) {
    const li = document.createElement("li");
    li.className = "domain-empty";
    li.textContent = emptyMessage;
    container.appendChild(li);
    return;
  }

  domains.forEach((domain) => {
    const li = document.createElement("li");
    li.className = "domain-item";

    const span = document.createElement("span");
    span.className = "domain-item-text";
    span.textContent = domain;

    const delBtn = document.createElement("button");
    delBtn.className = "btn-remove";
    delBtn.type = "button";
    delBtn.title = `${removeTitlePrefix} ${domain}`;
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", () => onRemove(domain));

    li.appendChild(span);
    li.appendChild(delBtn);
    container.appendChild(li);
  });
}

/**
 * Renders the custom injected domains list.
 */
function renderCustomDomains(domains) {
  customCountLabel.textContent = `Injected Custom Domains (${domains.length})`;
  renderDomainList(customDomainItems, domains, {
    emptyMessage: "No custom domains added yet.",
    removeTitlePrefix: "Remove",
    onRemove: async (domain) => {
      await api.runtime.sendMessage({ type: "REMOVE_CUSTOM_DOMAIN", domain });
      await refreshUI();
      if (currentTab?.id && isHostnameMatching(currentStatus?.hostname, domain)) {
        api.tabs.reload(currentTab.id);
      }
    }
  });
}

/**
 * Renders the excluded .be domains list (if any).
 */
function renderExcludedDomains(domains) {
  if (domains.length === 0) {
    excludedSection.classList.add("hidden");
    return;
  }

  excludedSection.classList.remove("hidden");
  excludedCountLabel.textContent = `Excluded .BE Sites (${domains.length})`;
  renderDomainList(excludedDomainItems, domains, {
    emptyMessage: "No .be sites excluded.",
    removeTitlePrefix: "Re-enable",
    onRemove: async (domain) => {
      await api.runtime.sendMessage({ type: "TOGGLE_CURRENT_SITE", domain });
      await refreshUI();
      if (currentTab?.id && isHostnameMatching(currentStatus?.hostname, domain)) {
        api.tabs.reload(currentTab.id);
      }
    }
  });
}

/**
 * Toggles the active site state.
 */
async function toggleCurrentSite() {
  if (!currentStatus || !currentStatus.hostname) return;
  clearInlineError(siteError);

  try {
    const res = await api.runtime.sendMessage({
      type: "TOGGLE_CURRENT_SITE",
      domain: currentStatus.hostname
    });
    if (res?.status === "error") {
      showInlineError(siteError, res.message || "Could not update this site");
      return;
    }
    await refreshUI();
    if (currentTab?.id) {
      api.tabs.reload(currentTab.id);
    }
  } catch (err) {
    console.error("Failed to toggle site:", err);
  }
}

/**
 * Adds a new custom domain manually.
 */
async function handleAddCustomDomain() {
  const val = customDomainInput.value.trim();
  clearInlineError(customDomainError);
  if (!val) {
    showInlineError(customDomainError, "Enter a domain name (e.g. aliexpress.com)");
    return;
  }

  try {
    const res = await api.runtime.sendMessage({
      type: "ADD_CUSTOM_DOMAIN",
      domain: val
    });
    if (res?.status === "error") {
      showInlineError(customDomainError, res.message || "Invalid domain");
      return;
    }
    customDomainInput.value = "";
    await refreshUI();
    const addedDomain = res?.domain || val;
    if (currentTab?.id && isHostnameMatching(currentStatus?.hostname, addedDomain)) {
      api.tabs.reload(currentTab.id);
    }
  } catch (err) {
    console.error("Failed to add domain:", err);
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
    await api.runtime.sendMessage({
      type: "SET_ENABLED",
      enabled: e.target.checked
    });
    await refreshUI();
    if (currentTab?.id) {
      api.tabs.reload(currentTab.id);
    }
  });

  // Language Direction Buttons
  langBtnFr.addEventListener("click", () => setTargetLanguage("fr"));
  langBtnNl.addEventListener("click", () => setTargetLanguage("nl"));

  // Current Site Action Button
  siteActionBtn.addEventListener("click", toggleCurrentSite);

  // Custom Domains Accordion
  customAccordionBtn.addEventListener("click", () => {
    customAccordionBtn.classList.toggle("accordion-open");
    customAccordionContent.classList.toggle("hidden");
  });

  // Add Domain Button & Enter Key
  addDomainBtn.addEventListener("click", handleAddCustomDomain);
  customDomainInput.addEventListener("input", () => clearInlineError(customDomainError));
  customDomainInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      handleAddCustomDomain();
    }
  });

  // Excluded .BE Domains Accordion
  excludedAccordionBtn.addEventListener("click", () => {
    excludedAccordionBtn.classList.toggle("accordion-open");
    excludedAccordionContent.classList.toggle("hidden");
  });
}

// Initialize on DOM load
document.addEventListener("DOMContentLoaded", init);
