/**
 * No Dutch Please - Comprehensive Test Suite
 * Tests URL rewriting, domain extraction, exclusion rules, loop guard logic, bi-directional mode, and manifest structures.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const background = require("../background.js");
const {
  rewriteUrl,
  isDutchUrl,
  isSourceLangUrl,
  getLanguagePair,
  getPrimaryDomain,
  isDomainExcluded,
  applyCase,
  rewriteLocaleString,
  FRENCH_ACCEPT_LANGUAGE,
  DUTCH_ACCEPT_LANGUAGE,
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
console.log("▶ 1. Subdomain Rewriting (.be and commercial .com sites)");
it("rewrites nl.example.be to fr.example.be", () => {
  assert.strictEqual(rewriteUrl("https://nl.example.be/"), "https://fr.example.be/");
  assert.strictEqual(rewriteUrl("http://nl.example.be/path"), "http://fr.example.be/path");
});

it("rewrites nl-be.example.be to fr-be.example.be", () => {
  assert.strictEqual(rewriteUrl("https://nl-be.example.be/"), "https://fr-be.example.be/");
});

it("rewrites commercial .com Dutch subdomains (e.g. nl.aliexpress.com -> fr.aliexpress.com)", () => {
  assert.strictEqual(rewriteUrl("https://nl.aliexpress.com/"), "https://fr.aliexpress.com/");
  assert.strictEqual(
    rewriteUrl("https://nl.aliexpress.com/item/100500628.html?spm=a2g0o"),
    "https://fr.aliexpress.com/item/100500628.html?spm=a2g0o"
  );
  assert.strictEqual(rewriteUrl("https://nl.hotels.com/"), "https://fr.hotels.com/");
  assert.strictEqual(rewriteUrl("https://nl.shein.com/catalog"), "https://fr.shein.com/catalog");
  assert.strictEqual(rewriteUrl("https://nl.tripadvisor.com/"), "https://fr.tripadvisor.com/");
  assert.strictEqual(rewriteUrl("https://nl.wikipedia.org/"), null);
});

it("never modifies subdomains containing 'nl' like 'online', 'only', 'download'", () => {
  assert.strictEqual(rewriteUrl("https://online.aliexpress.com/"), null);
  assert.strictEqual(rewriteUrl("https://only.example.be/"), null);
  assert.strictEqual(rewriteUrl("https://download.example.com/"), null);
});

it("never rewrites subdomains on genuine Netherlands .nl domains (e.g. nl.something.nl or nos.nl)", () => {
  assert.strictEqual(rewriteUrl("https://nos.nl/"), null);
  assert.strictEqual(rewriteUrl("https://nl.something.nl/"), null);
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

it("rewrites Belgian inverted path /be-nl/ and /be_nl/ on international sites", () => {
  assert.strictEqual(rewriteUrl("https://www.apple.com/be-nl/shop"), "https://www.apple.com/be-fr/shop");
  assert.strictEqual(rewriteUrl("https://example.com/be_nl/item"), "https://example.com/be_fr/item");
});

it("rewrites two-segment Belgian paths /be/nl/ and /nl/be/ on international sites", () => {
  assert.strictEqual(rewriteUrl("https://www.ikea.com/be/nl/cat/chairs"), "https://www.ikea.com/be/fr/cat/chairs");
  assert.strictEqual(rewriteUrl("https://www.decathlon.com/be/nl/p/bike"), "https://www.decathlon.com/be/fr/p/bike");
  assert.strictEqual(rewriteUrl("https://example.com/nl/be/home"), "https://example.com/fr/be/home");
});

it("preserves uppercase codes like /NL/", () => {
  assert.strictEqual(rewriteUrl("https://example.be/NL/"), "https://example.be/FR/");
  assert.strictEqual(rewriteUrl("https://www.apple.com/be-NL/shop"), "https://www.apple.com/be-FR/shop");
});

it("rewrites nested paths e.g. /app/nl/profile", () => {
  assert.strictEqual(rewriteUrl("https://example.be/app/nl/profile"), "https://example.be/app/fr/profile");
});

it("never breaks words containing 'nl' in path segments", () => {
  assert.strictEqual(rewriteUrl("https://example.be/online/"), null);
  assert.strictEqual(rewriteUrl("https://example.be/only"), null);
  assert.strictEqual(rewriteUrl("https://example.be/download/"), null);
  assert.strictEqual(rewriteUrl("https://example.be/downloads/nl-file.zip"), null);
  assert.strictEqual(rewriteUrl("https://www.ikea.com/be/online/chairs"), null);
});

it("handles paths with both 'nl' segment and downstream words containing 'nl'", () => {
  assert.strictEqual(
    rewriteUrl("https://example.be/nl/online/download"),
    "https://example.be/fr/online/download"
  );
});

it("leaves generic /nl/ untouched on non-.be domains (e.g. bol.com/nl/)", () => {
  assert.strictEqual(rewriteUrl("https://www.bol.com/nl/p/book"), null);
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
  assert.strictEqual(rewriteUrl("https://example.com/?lang=be-nl"), "https://example.com/?lang=be-fr");
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
  assert.strictEqual(getPrimaryDomain("nl.example.com"), "example.com");
  assert.strictEqual(getPrimaryDomain("vrt.be"), "vrt.be");
  assert.strictEqual(getPrimaryDomain("sub.nl.bpost.be"), "bpost.be");
  assert.strictEqual(getPrimaryDomain("info.ulb.ac.be"), "ulb.ac.be");
  assert.strictEqual(getPrimaryDomain("example.com"), "example.com");
});

it("detects domain exclusions (exact match, subdomain, and parent match)", () => {
  const whitelist = ["vrt.be", "example.com", "specific.sub.be"];
  assert.strictEqual(isDomainExcluded("vrt.be", whitelist), true);
  assert.strictEqual(isDomainExcluded("nl.vrt.be", whitelist), true);
  assert.strictEqual(isDomainExcluded("nl.example.com", whitelist), true);
  assert.strictEqual(isDomainExcluded("fr.example.com", whitelist), true);
  assert.strictEqual(isDomainExcluded("sub.vrt.be", whitelist), true);
  assert.strictEqual(isDomainExcluded("specific.sub.be", whitelist), true);
  assert.strictEqual(isDomainExcluded("other.sub.be", whitelist), false);
  assert.strictEqual(isDomainExcluded("bpost.be", whitelist), false);
});

// 6. Loop Guard Simulation
console.log("\n▶ 6. Loop Guard Simulation");
it("identifies Dutch URLs accurately", () => {
  assert.strictEqual(isDutchUrl("https://example.be/nl/"), true);
  assert.strictEqual(isDutchUrl("https://nl.example.be/"), true);
  assert.strictEqual(isDutchUrl("https://nl.aliexpress.com/"), true);
  assert.strictEqual(isDutchUrl("https://www.apple.com/be-nl/"), true);
  assert.strictEqual(isDutchUrl("https://www.ikea.com/be/nl/"), true);
  assert.strictEqual(isDutchUrl("https://example.be/?lang=nl"), true);
  assert.strictEqual(isDutchUrl("https://fr.aliexpress.com/"), false);
  assert.strictEqual(isDutchUrl("https://example.be/fr/"), false);
  assert.strictEqual(isDutchUrl("https://nos.nl/"), false);
  assert.strictEqual(isDutchUrl("https://nl.wikipedia.org/"), false);
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

// 7. Regression Tests
console.log("\n▶ 7. Regression Tests (audit fixes)");
it("leaves generic Dutch subdomains outside .be / commercial .com alone", () => {
  assert.strictEqual(rewriteUrl("https://nl.wikipedia.org/wiki/Brussel"), null);
  assert.strictEqual(isDutchUrl("https://nl.wikipedia.org/wiki/Brussel"), false);
});

it("rewrites nl. on commercial .com but leaves non-commercial .org and .nl alone", () => {
  assert.strictEqual(rewriteUrl("https://nl.aliexpress.com/"), "https://fr.aliexpress.com/");
  assert.strictEqual(rewriteUrl("https://nl.hotels.com/"), "https://fr.hotels.com/");
  assert.strictEqual(rewriteUrl("https://nl.wikipedia.org/wiki/Brussel"), null);
  assert.strictEqual(rewriteUrl("https://nos.nl/"), null);
  assert.strictEqual(isDutchUrl("https://nl.wikipedia.org/wiki/Brussel"), false);
  assert.strictEqual(isDutchUrl("https://nl.aliexpress.com/"), true);
});

it("rewrites every case variant of /nl/ on .be domains", () => {
  assert.strictEqual(rewriteUrl("https://example.be/nL/"), "https://example.be/fR/");
  assert.strictEqual(rewriteUrl("https://example.be/nl/"), "https://example.be/fr/");
  assert.strictEqual(rewriteUrl("https://example.be/NL/"), "https://example.be/FR/");
  assert.strictEqual(rewriteUrl("https://example.com/be-Nl/shop"), "https://example.com/be-Fr/shop");
  assert.strictEqual(applyCase("nL", "fr"), "fR");
});

it("rewrites all Belgian path pairs in one pass (no double redirect)", () => {
  assert.strictEqual(
    rewriteUrl("https://example.com/be/nl/be/nl/x"),
    "https://example.com/be/fr/be/fr/x"
  );
});

it("preserves untouched query parameters byte-for-byte", () => {
  assert.strictEqual(
    rewriteUrl("https://example.be/?lang=nl&spm=a2g0o.item.100"),
    "https://example.be/?lang=fr&spm=a2g0o.item.100"
  );
  assert.strictEqual(
    rewriteUrl("https://example.be/?q=nl&lang=nl"),
    "https://example.be/?q=nl&lang=fr"
  );
});

// 8. Bi-directional Language Logic (Flemish / Dutch-first mode)
console.log("\n▶ 8. Bi-directional Language Logic (Flemish / Dutch-first mode)");
it("resolves language pairs correctly in both directions", () => {
  assert.deepStrictEqual(getLanguagePair("fr"), { source: "nl", target: "fr" });
  assert.deepStrictEqual(getLanguagePair("nl"), { source: "fr", target: "nl" });
});

it("rewrites French to Dutch when target is 'nl' (FR -> NL)", () => {
  // Subdomains
  assert.strictEqual(rewriteUrl("https://fr.example.be/", "nl"), "https://nl.example.be/");
  assert.strictEqual(rewriteUrl("https://fr.aliexpress.com/", "nl"), "https://nl.aliexpress.com/");
  assert.strictEqual(rewriteUrl("https://fr-be.example.be/", "nl"), "https://nl-be.example.be/");

  // Path segments
  assert.strictEqual(rewriteUrl("https://example.be/fr/", "nl"), "https://example.be/nl/");
  assert.strictEqual(rewriteUrl("https://example.be/fr", "nl"), "https://example.be/nl");
  assert.strictEqual(rewriteUrl("https://example.be/FR/", "nl"), "https://example.be/NL/");
  assert.strictEqual(rewriteUrl("https://www.apple.com/be-fr/shop", "nl"), "https://www.apple.com/be-nl/shop");
  assert.strictEqual(rewriteUrl("https://www.ikea.com/be/fr/cat/chairs", "nl"), "https://www.ikea.com/be/nl/cat/chairs");
  assert.strictEqual(rewriteUrl("https://example.com/fr-be/page", "nl"), "https://example.com/nl-be/page");

  // Query parameters
  assert.strictEqual(rewriteUrl("https://example.be/?lang=fr", "nl"), "https://example.be/?lang=nl");
  assert.strictEqual(rewriteUrl("https://example.be/?locale=fr_BE", "nl"), "https://example.be/?locale=nl_BE");
  assert.strictEqual(rewriteUrl("https://example.com/?lang=be-fr", "nl"), "https://example.com/?lang=be-nl");
});

it("protects domestic French (.fr) sites when in Dutch-first mode", () => {
  assert.strictEqual(rewriteUrl("https://lemonde.fr/", "nl"), null);
  assert.strictEqual(rewriteUrl("https://fr.lemonde.fr/", "nl"), null);
});

it("identifies source language correctly in Dutch-first mode", () => {
  assert.strictEqual(isSourceLangUrl("https://example.be/fr/", "nl"), true);
  assert.strictEqual(isSourceLangUrl("https://fr.example.be/", "nl"), true);
  assert.strictEqual(isSourceLangUrl("https://example.be/nl/", "nl"), false);
  assert.strictEqual(isSourceLangUrl("https://lemonde.fr/", "nl"), false);
});

it("defines distinct Accept-Language headers for both modes", () => {
  assert.strictEqual(FRENCH_ACCEPT_LANGUAGE.startsWith("fr-FR"), true);
  assert.strictEqual(DUTCH_ACCEPT_LANGUAGE.startsWith("nl-BE"), true);
});

// 9. Manifest Validation
console.log("\n▶ 9. Manifest Validation");
it("validates manifest.json supports Firefox (has background.scripts)", () => {
  const content = JSON.parse(fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8"));
  assert.strictEqual(content.manifest_version, 3);
  assert.strictEqual(Array.isArray(content.background.scripts), true);
  assert.strictEqual(content.background.scripts.includes("background.js"), true);
  assert.strictEqual(content.host_permissions.includes("*://*.be/*"), true);
});

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
