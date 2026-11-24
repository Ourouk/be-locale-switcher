/**
 * No Dutch Please - Comprehensive Test Suite
 * Tests URL rewriting, domain extraction, exclusion rules, loop guard logic, and manifest structures.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const background = require("../background.js");
const {
  rewriteUrl,
  isDutchUrl,
  getPrimaryDomain,
  isDomainExcluded,
  rewriteLocaleString,
  FRENCH_ACCEPT_LANGUAGE,
  REDIRECT_LOOP_WINDOW_MS
} = background;

let passed = 0;
let total = 0;

function it(desc, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✓ ${desc}`);
  } catch (err) {
    console.error(`  ✗ ${desc}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("\n🧪 Running No Dutch Please Test Suite\n");

// 1. Subdomain Rewriting
console.log("▶ 1. Subdomain Rewriting (.be domains)");
it("rewrites nl.example.be to fr.example.be", () => {
  assert.strictEqual(rewriteUrl("https://nl.example.be/"), "https://fr.example.be/");
  assert.strictEqual(rewriteUrl("http://nl.example.be/path"), "http://fr.example.be/path");
});

it("rewrites nl-be.example.be to fr-be.example.be", () => {
  assert.strictEqual(rewriteUrl("https://nl-be.example.be/"), "https://fr-be.example.be/");
});

it("never modifies subdomains containing 'nl' like 'online', 'only', 'download'", () => {
  assert.strictEqual(rewriteUrl("https://online.example.be/"), null);
  assert.strictEqual(rewriteUrl("https://only.example.be/"), null);
  assert.strictEqual(rewriteUrl("https://download.example.be/"), null);
});

it("does not rewrite subdomains on non-.be domains (e.g. nl.example.com)", () => {
  assert.strictEqual(rewriteUrl("https://nl.example.com/"), null);
});

// 2. Path Segment Rewriting
console.log("\n▶ 2. Path Segment Rewriting");
it("rewrites standard /nl/ and /nl on .be domains", () => {
  assert.strictEqual(rewriteUrl("https://example.be/nl/"), "https://example.be/fr/");
  assert.strictEqual(rewriteUrl("https://example.be/nl"), "https://example.be/fr");
});

it("rewrites Belgian variants /nl-be/, /nl_BE/, /nl_be/", () => {
  assert.strictEqual(rewriteUrl("https://example.be/nl-be/"), "https://example.be/fr-be/");
  assert.strictEqual(rewriteUrl("https://example.be/nl_BE/"), "https://example.be/fr_BE/");
  assert.strictEqual(rewriteUrl("https://example.be/nl_be"), "https://example.be/fr_be");
});

it("preserves uppercase codes like /NL/", () => {
  assert.strictEqual(rewriteUrl("https://example.be/NL/"), "https://example.be/FR/");
});

it("rewrites nested paths e.g. /app/nl/profile", () => {
  assert.strictEqual(rewriteUrl("https://example.be/app/nl/profile"), "https://example.be/app/fr/profile");
});

it("never breaks words containing 'nl' in path segments", () => {
  assert.strictEqual(rewriteUrl("https://example.be/online/"), null);
  assert.strictEqual(rewriteUrl("https://example.be/only"), null);
  assert.strictEqual(rewriteUrl("https://example.be/download/"), null);
  assert.strictEqual(rewriteUrl("https://example.be/downloads/nl-file.zip"), null);
});

it("handles paths with both 'nl' segment and downstream words containing 'nl'", () => {
  assert.strictEqual(
    rewriteUrl("https://example.be/nl/online/download"),
    "https://example.be/fr/online/download"
  );
});

it("rewrites /nl-be/ on non-.be domains while leaving generic /nl/ untouched", () => {
  assert.strictEqual(rewriteUrl("https://example.com/nl-be/products"), "https://example.com/fr-be/products");
  assert.strictEqual(rewriteUrl("https://example.com/nl_BE/item"), "https://example.com/fr_BE/item");
  assert.strictEqual(rewriteUrl("https://example.com/nl/products"), null); // untouched
});

// 3. Query Parameter Rewriting
console.log("\n▶ 3. Query Parameter Rewriting");
it("rewrites lang=nl and locale=nl_BE on .be domains", () => {
  assert.strictEqual(rewriteUrl("https://example.be/?lang=nl"), "https://example.be/?lang=fr");
  assert.strictEqual(rewriteUrl("https://example.be/?locale=nl_BE"), "https://example.be/?locale=fr_BE");
  assert.strictEqual(rewriteUrl("https://example.be/?language=nl"), "https://example.be/?language=fr");
  assert.strictEqual(rewriteUrl("https://example.be/?hl=nl"), "https://example.be/?hl=fr");
});

it("does not rewrite unrelated query parameters like search queries", () => {
  assert.strictEqual(rewriteUrl("https://example.be/?q=nl"), null);
  assert.strictEqual(rewriteUrl("https://example.be/?search=only&filter=online"), null);
});

it("rewrites query parameters on non-.be domains only if Belgian Dutch", () => {
  assert.strictEqual(rewriteUrl("https://example.com/?lang=nl-be"), "https://example.com/?lang=fr-be");
  assert.strictEqual(rewriteUrl("https://example.com/?locale=nl_BE"), "https://example.com/?locale=fr_BE");
  assert.strictEqual(rewriteUrl("https://example.com/?lang=nl"), null); // untouched
});

// 4. Combined Rewriting
console.log("\n▶ 4. Combined Rewriting");
it("handles subdomain, path, and query parameter simultaneously", () => {
  assert.strictEqual(
    rewriteUrl("https://nl.example.be/nl/home?lang=nl"),
    "https://fr.example.be/fr/home?lang=fr"
  );
});

it("ignores non-http/https protocols", () => {
  assert.strictEqual(rewriteUrl("javascript:void(0)"), null);
  assert.strictEqual(rewriteUrl("chrome://extensions"), null);
  assert.strictEqual(rewriteUrl("about:blank"), null);
});

// 5. Domain & Exclusion Utilities
console.log("\n▶ 5. Domain & Exclusion Utilities");
it("extracts primary domain properly", () => {
  assert.strictEqual(getPrimaryDomain("nl.vrt.be"), "vrt.be");
  assert.strictEqual(getPrimaryDomain("vrt.be"), "vrt.be");
  assert.strictEqual(getPrimaryDomain("sub.nl.bpost.be"), "bpost.be");
  assert.strictEqual(getPrimaryDomain("info.ulb.ac.be"), "ulb.ac.be");
  assert.strictEqual(getPrimaryDomain("example.com"), "example.com");
});

it("detects domain exclusions (exact match, subdomain, and parent match)", () => {
  const whitelist = ["vrt.be", "specific.sub.be"];
  assert.strictEqual(isDomainExcluded("vrt.be", whitelist), true);
  assert.strictEqual(isDomainExcluded("nl.vrt.be", whitelist), true);
  assert.strictEqual(isDomainExcluded("sub.vrt.be", whitelist), true);
  assert.strictEqual(isDomainExcluded("specific.sub.be", whitelist), true);
  assert.strictEqual(isDomainExcluded("other.sub.be", whitelist), false);
  assert.strictEqual(isDomainExcluded("bpost.be", whitelist), false);
  assert.strictEqual(isDomainExcluded("vrt.be.com", whitelist), false);
});

// 6. Loop Guard Simulation
console.log("\n▶ 6. Loop Guard Simulation");
it("identifies Dutch URLs accurately", () => {
  assert.strictEqual(isDutchUrl("https://example.be/nl/"), true);
  assert.strictEqual(isDutchUrl("https://nl.example.be/"), true);
  assert.strictEqual(isDutchUrl("https://example.be/?lang=nl"), true);
  assert.strictEqual(isDutchUrl("https://example.be/fr/"), false);
  assert.strictEqual(isDutchUrl("https://example.com/en/"), false);
});

it("simulates loop guard redirect detection within 5000ms window", () => {
  const tabId = 123;
  const store = {
    pendingRedirects: {},
    sessionBypassed: []
  };

  const initialUrl = "https://flemish-only.be/nl/nieuws";
  const rewritten = rewriteUrl(initialUrl);
  assert.strictEqual(rewritten, "https://flemish-only.be/fr/nieuws");

  // Step 1: Record initial redirect
  const startTime = Date.now();
  store.pendingRedirects[tabId] = {
    domain: getPrimaryDomain("flemish-only.be"),
    fromUrl: initialUrl,
    toUrl: rewritten,
    timestamp: startTime
  };

  // Step 2: Server bounces back to /nl/ within 1000ms
  const bouncedUrl = "https://flemish-only.be/nl/nieuws";
  const pending = store.pendingRedirects[tabId];
  const elapsed = (startTime + 1000) - pending.timestamp;

  let loopDetected = false;
  if (elapsed < REDIRECT_LOOP_WINDOW_MS) {
    if (isDutchUrl(bouncedUrl) || bouncedUrl === pending.fromUrl) {
      loopDetected = true;
      delete store.pendingRedirects[tabId];
      store.sessionBypassed.push(pending.domain);
    }
  }

  assert.strictEqual(loopDetected, true);
  assert.strictEqual(store.sessionBypassed.includes("flemish-only.be"), true);
  assert.strictEqual(isDomainExcluded("flemish-only.be", store.sessionBypassed), true);
});

// 7. Manifest Validation
console.log("\n▶ 7. Manifest Validation");
it("validates manifest.chrome.json syntax and MV3 service worker", () => {
  const content = JSON.parse(fs.readFileSync(path.join(__dirname, "../manifest.chrome.json"), "utf8"));
  assert.strictEqual(content.manifest_version, 3);
  assert.strictEqual(content.background.service_worker, "background.js");
  assert.strictEqual(content.permissions.includes("declarativeNetRequest"), true);
  assert.strictEqual(content.permissions.includes("declarativeNetRequestWithHostAccess"), true);
  assert.strictEqual(content.permissions.includes("storage"), true);
  assert.strictEqual(content.permissions.includes("tabs"), true);
  assert.strictEqual(content.host_permissions.includes("*://*.be/*"), true);
  assert.strictEqual(content.action.default_popup, "popup/popup.html");
});

it("validates manifest.firefox.json syntax, Gecko settings, and strict_min_version", () => {
  const content = JSON.parse(fs.readFileSync(path.join(__dirname, "../manifest.firefox.json"), "utf8"));
  assert.strictEqual(content.manifest_version, 3);
  assert.deepStrictEqual(content.background.scripts, ["background.js"]);
  assert.strictEqual(content.browser_specific_settings.gecko.id, "no-dutch-please@extension");
  assert.strictEqual(content.browser_specific_settings.gecko.strict_min_version, "115.0");
  assert.strictEqual(content.permissions.includes("declarativeNetRequest"), true);
  assert.strictEqual(content.host_permissions.includes("*://*.be/*"), true);
});

console.log(`\n========================================`);
console.log(`Test Results: ${passed}/${total} passed (${Math.round((passed / total) * 100)}%)`);
console.log(`========================================\n`);

if (passed !== total) {
  process.exit(1);
}
