#!/usr/bin/env node
/**
 * No Dutch Please - Build & Manifest Switcher Script
 * Zero-dependency helper to swap manifests between Chromium and Firefox,
 * and optionally build release distribution archives.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const CHROME_MANIFEST = path.join(ROOT_DIR, 'manifest.chrome.json');
const FIREFOX_MANIFEST = path.join(ROOT_DIR, 'manifest.firefox.json');
const ACTIVE_MANIFEST = path.join(ROOT_DIR, 'manifest.json');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

const target = (process.argv[2] || 'status').toLowerCase();

function getActiveBrowser() {
  if (!fs.existsSync(ACTIVE_MANIFEST)) return 'none';
  try {
    const content = JSON.parse(fs.readFileSync(ACTIVE_MANIFEST, 'utf8'));
    if (content.browser_specific_settings?.gecko) {
      return 'firefox';
    }
    if (content.background?.service_worker) {
      return 'chrome';
    }
    return 'unknown';
  } catch {
    return 'invalid';
  }
}

function activate(browser) {
  if (browser === 'chrome' || browser === 'chromium') {
    fs.copyFileSync(CHROME_MANIFEST, ACTIVE_MANIFEST);
    console.log('✓ Switched manifest.json to Chromium (Chrome, Brave, Edge)');
  } else if (browser === 'firefox' || browser === 'gecko') {
    fs.copyFileSync(FIREFOX_MANIFEST, ACTIVE_MANIFEST);
    console.log('✓ Switched manifest.json to Mozilla Firefox (Gecko MV3)');
  } else {
    console.error(`Unknown target: "${browser}". Use "chrome", "firefox", "package", or "status".`);
    process.exit(1);
  }
}

function createZipArchive(destZip, items) {
  const pythonScript = `
import zipfile, os
dest = r"${destZip}"
items = ${JSON.stringify(items)}
with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
  for item in items:
    if os.path.isdir(item):
      for root, dirs, files in os.walk(item):
        for f in files:
          full_path = os.path.join(root, f)
          rel_path = os.path.relpath(full_path, ".")
          z.write(full_path, rel_path)
    elif os.path.exists(item):
      z.write(item, os.path.basename(item))
`;
  execSync(`python3 -c '${pythonScript.replace(/'/g, "\\'")}'`, { cwd: ROOT_DIR });
}

function packageExtensions() {
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  const version = pkg.version || '1.0.0';

  const filesToInclude = [
    'manifest.json',
    'background.js',
    'content.js',
    'popup',
    'icons'
  ];

  // 1. Package Chrome
  activate('chrome');
  const chromeZip = path.join(DIST_DIR, `no-dutch-please-v${version}-chrome.zip`);
  if (fs.existsSync(chromeZip)) fs.unlinkSync(chromeZip);
  createZipArchive(chromeZip, filesToInclude);
  console.log(`✓ Packaged Chrome extension: dist/${path.basename(chromeZip)}`);

  // 2. Package Firefox
  activate('firefox');
  const firefoxZip = path.join(DIST_DIR, `no-dutch-please-v${version}-firefox.zip`);
  if (fs.existsSync(firefoxZip)) fs.unlinkSync(firefoxZip);
  createZipArchive(firefoxZip, filesToInclude);
  console.log(`✓ Packaged Firefox extension: dist/${path.basename(firefoxZip)}`);

  // Reset back to chrome
  activate('chrome');
}

switch (target) {
  case 'chrome':
  case 'chromium':
    activate('chrome');
    break;

  case 'firefox':
  case 'gecko':
    activate('firefox');
    break;

  case 'package':
  case 'dist':
    packageExtensions();
    break;

  case 'status':
  default:
    console.log(`Active manifest target: [${getActiveBrowser().toUpperCase()}]`);
    console.log('Usage:');
    console.log('  node scripts/build.js chrome   -> Activate Chromium manifest');
    console.log('  node scripts/build.js firefox  -> Activate Firefox manifest');
    console.log('  node scripts/build.js package  -> Create .zip distribution builds');
    break;
}
