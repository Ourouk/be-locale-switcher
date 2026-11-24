/**
 * BE Locale Switcher - Comprehensive Test Suite
 * Tests domain matching, locale constants, DNR rule generation, status calculation, and manifests.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const background = require("../background.js");
const {
  isBeDomain,
  normalizeDomain,
  isDomainMatching,
  buildDnrRules,
  getStatusForUrl,
  FRENCH_ACCEPT_LANGUAGE,
  DUTCH_ACCEPT_LANGUAGE,
  RULE_ID_BE_DOMAINS,
  RULE_ID_CUSTOM_DOMAINS
} = background;

let passed = 0;
let total = 0;

function it(desc, fn) {
  total++;
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${desc}`);
    console.error(`    ${err.message}`);
  }
}

async function itAsync(desc, fn) {
  total++;
  try {
    await fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${desc}`);
    console.error(`    ${err.message}`);
  }
}

async function runTests() {
  console.log("\n🧪 Running BE Locale Switcher Test Suite\n");

  // 1. Domain Utilities
  console.log("▶ 1. Domain Utilities");
  it("identifies .be domains correctly", () => {
    assert.strictEqual(isBeDomain("vrt.be"), true);
    assert.strictEqual(isBeDomain("sub.example.be"), true);
    assert.strictEqual(isBeDomain("deep.sub.domain.be"), true);
    assert.strictEqual(isBeDomain("be"), true);
    assert.strictEqual(isBeDomain("example.com"), false);
    assert.strictEqual(isBeDomain("notbe.org"), false);
    assert.strictEqual(isBeDomain("aliexpress.com"), false);
    assert.strictEqual(isBeDomain("lemonde.fr"), false);
    assert.strictEqual(isBeDomain("nos.nl"), false);
    assert.strictEqual(isBeDomain(""), false);
    assert.strictEqual(isBeDomain(null), false);
  });

  it("normalizes URLs and domain inputs into clean hostnames", () => {
    assert.strictEqual(normalizeDomain("https://nl.aliexpress.com/item/123.html?foo=bar#baz"), "nl.aliexpress.com");
    assert.strictEqual(normalizeDomain("http://example.be:8080/path"), "example.be");
    assert.strictEqual(normalizeDomain("  VRT.BE/nieuws  "), "vrt.be");
    assert.strictEqual(normalizeDomain("ikea.com/"), "ikea.com");
  });

  it("matches domains including subdomains", () => {
    const list = ["aliexpress.com", "ikea.com", "vrt.be"];
    assert.strictEqual(isDomainMatching("aliexpress.com", list), true);
    assert.strictEqual(isDomainMatching("nl.aliexpress.com", list), true);
    assert.strictEqual(isDomainMatching("fr.aliexpress.com", list), true);
    assert.strictEqual(isDomainMatching("www.ikea.com", list), true);
    assert.strictEqual(isDomainMatching("vrt.be", list), true);
    assert.strictEqual(isDomainMatching("amazon.com", list), false);
    assert.strictEqual(isDomainMatching("evilaliexpress.com", list), false);
  });

  // 2. Locale Constants
  console.log("\n▶ 2. Accept-Language Constants");
  it("defines accurate Accept-Language headers for French and Dutch", () => {
    assert.strictEqual(FRENCH_ACCEPT_LANGUAGE.startsWith("fr-FR,fr;q=0.9"), true);
    assert.strictEqual(FRENCH_ACCEPT_LANGUAGE.includes("fr-BE"), true);
    assert.strictEqual(DUTCH_ACCEPT_LANGUAGE.startsWith("nl-BE,nl;q=0.9"), true);
    assert.strictEqual(DUTCH_ACCEPT_LANGUAGE.includes("nl-NL"), true);
  });

  // 3. DeclarativeNetRequest Rule Generation
  console.log("\n▶ 3. DeclarativeNetRequest Rule Generation");
  it("returns no rules when extension is disabled", () => {
    const rules = buildDnrRules({
      enabled: false,
      targetLanguage: "fr",
      customDomains: ["aliexpress.com"],
      excludedBeDomains: []
    });
    assert.deepStrictEqual(rules, []);
  });

  it("generates Rule 1 for all .be domains by default with French headers", () => {
    const rules = buildDnrRules({
      enabled: true,
      targetLanguage: "fr",
      customDomains: [],
      excludedBeDomains: []
    });
    assert.strictEqual(rules.length, 1);
    const beRule = rules[0];
    assert.strictEqual(beRule.id, RULE_ID_BE_DOMAINS);
    assert.strictEqual(beRule.action.type, "modifyHeaders");
    assert.strictEqual(beRule.action.requestHeaders[0].header, "accept-language");
    assert.strictEqual(beRule.action.requestHeaders[0].value, FRENCH_ACCEPT_LANGUAGE);
    assert.strictEqual(beRule.condition.regexFilter, "^https?://[^/:]+\\.be(:[0-9]+)?/");
    assert.strictEqual(beRule.condition.excludedDomains, undefined);
  });

  it("generates Rule 1 with excluded .be domains when specified", () => {
    const rules = buildDnrRules({
      enabled: true,
      targetLanguage: "fr",
      customDomains: [],
      excludedBeDomains: ["vrt.be", "demorgen.be"]
    });
    assert.strictEqual(rules.length, 1);
    assert.deepStrictEqual(rules[0].condition.excludedDomains, ["vrt.be", "demorgen.be"]);
  });

  it("generates Rule 2 for custom domains whitelist", () => {
    const rules = buildDnrRules({
      enabled: true,
      targetLanguage: "fr",
      customDomains: ["aliexpress.com", "ikea.com"],
      excludedBeDomains: []
    });
    assert.strictEqual(rules.length, 2);
    const customRule = rules[1];
    assert.strictEqual(customRule.id, RULE_ID_CUSTOM_DOMAINS);
    assert.strictEqual(customRule.action.type, "modifyHeaders");
    assert.strictEqual(customRule.action.requestHeaders[0].value, FRENCH_ACCEPT_LANGUAGE);
    assert.deepStrictEqual(customRule.condition.domains, ["aliexpress.com", "ikea.com"]);
  });

  it("generates Dutch headers when target language is Dutch", () => {
    const rules = buildDnrRules({
      enabled: true,
      targetLanguage: "nl",
      customDomains: ["aliexpress.com"],
      excludedBeDomains: []
    });
    assert.strictEqual(rules.length, 2);
    assert.strictEqual(rules[0].action.requestHeaders[0].value, DUTCH_ACCEPT_LANGUAGE);
    assert.strictEqual(rules[1].action.requestHeaders[0].value, DUTCH_ACCEPT_LANGUAGE);
  });

  // 4. Status Computation
  console.log("\n▶ 4. Status Computation for URLs");
  await itAsync("computes status for standard .be domain", async () => {
    background.setSyncData({
      enabled: true,
      targetLanguage: "fr",
      customDomains: ["aliexpress.com"],
      excludedBeDomains: ["vrt.be"]
    });

    const status1 = await getStatusForUrl("https://rtbf.be/article/123");
    assert.strictEqual(status1.isBe, true);
    assert.strictEqual(status1.isCustom, false);
    assert.strictEqual(status1.isExcludedBe, false);
    assert.strictEqual(status1.isInjecting, true);

    const status2 = await getStatusForUrl("https://vrt.be/nieuws");
    assert.strictEqual(status2.isBe, true);
    assert.strictEqual(status2.isExcludedBe, true);
    assert.strictEqual(status2.isInjecting, false);

    const status3 = await getStatusForUrl("https://nl.aliexpress.com/item/100500.html");
    assert.strictEqual(status3.isBe, false);
    assert.strictEqual(status3.isCustom, true);
    assert.strictEqual(status3.isInjecting, true);

    const status4 = await getStatusForUrl("https://lemonde.fr/");
    assert.strictEqual(status4.isBe, false);
    assert.strictEqual(status4.isCustom, false);
    assert.strictEqual(status4.isInjecting, false);
  });

  // 5. Manifest Validation
  console.log("\n▶ 5. Manifest Validation");
  it("validates manifest.json syntax and structure (Universal MV3)", () => {
    const content = JSON.parse(fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8"));
    assert.strictEqual(content.manifest_version, 3);
    assert.strictEqual(content.permissions.includes("declarativeNetRequest"), true);
    assert.strictEqual(content.permissions.includes("storage"), true);
    assert.strictEqual(content.permissions.includes("tabs"), true);
    assert.strictEqual(content.host_permissions.includes("*://*.be/*"), true);
    assert.strictEqual(content.host_permissions.includes("*://*/*"), true);
    assert.strictEqual(content.content_scripts, undefined); // Zero content scripts!
  });

  it("validates manifest.chrome.json syntax (Chromium service worker)", () => {
    const content = JSON.parse(fs.readFileSync(path.join(__dirname, "../manifest.chrome.json"), "utf8"));
    assert.strictEqual(content.manifest_version, 3);
    assert.strictEqual(content.background.service_worker, "background.js");
    assert.strictEqual(content.content_scripts, undefined);
  });

  it("validates manifest.firefox.json syntax (Gecko background.scripts)", () => {
    const content = JSON.parse(fs.readFileSync(path.join(__dirname, "../manifest.firefox.json"), "utf8"));
    assert.strictEqual(content.manifest_version, 3);
    assert.deepStrictEqual(content.background.scripts, ["background.js"]);
    assert.strictEqual(content.browser_specific_settings.gecko.id, "be-locale-switcher@extension");
    assert.strictEqual(content.content_scripts, undefined);
  });

  console.log(`\n========================================`);
  console.log(`Test Results: ${passed}/${total} passed (${Math.round((passed / total) * 100)}%)`);
  console.log(`========================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runTests();
