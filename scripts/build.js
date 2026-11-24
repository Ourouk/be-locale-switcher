#!/usr/bin/env node
/**
 * BE Locale Switcher - Build & Manifest Switcher Script
 * Zero-dependency helper to swap manifests between Chromium and Firefox,
 * and optionally build release distribution archives.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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
    if (content.background?.scripts && content.background?.service_worker) {
      return 'universal (chrome + firefox)';
    }
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
    console.log('✓ Switched manifest.json to Mozilla Firefox (Gecko MV3 with background.scripts)');
  } else if (browser === 'universal' || browser === 'all' || browser === 'shared') {
    const base = JSON.parse(fs.readFileSync(FIREFOX_MANIFEST, 'utf8'));
    base.background.service_worker = "background.js";
    fs.writeFileSync(ACTIVE_MANIFEST, JSON.stringify(base, null, 2) + '\n');
    console.log('✓ Switched manifest.json to Universal (Both background.scripts & service_worker)');
  } else {
    console.error(`Unknown target: "${browser}". Use "chrome", "firefox", "universal", "package", or "status".`);
    process.exit(1);
  }
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function collectFiles(items, rootDir) {
  const files = [];
  for (const item of items) {
    const absPath = path.join(rootDir, item);
    if (!fs.existsSync(absPath)) continue;
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absPath, { withFileTypes: true })) {
        const relEntry = path.join(item, entry.name);
        if (entry.isDirectory()) {
          files.push(...collectFiles([relEntry], rootDir));
        } else if (entry.isFile()) {
          files.push(relEntry);
        }
      }
    } else if (stat.isFile()) {
      files.push(item);
    }
  }
  return files;
}

function toDosTimeDate(date) {
  const year = Math.max(1980, date.getFullYear()) - 1980;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);
  return {
    dosTime: (hours << 11) | (minutes << 5) | seconds,
    dosDate: (year << 9) | (month << 5) | day
  };
}

function createZipArchive(destZip, items) {
  const relFiles = collectFiles(items, ROOT_DIR);
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const relPath of relFiles) {
    const fullPath = path.join(ROOT_DIR, relPath);
    const raw = fs.readFileSync(fullPath);
    const stat = fs.statSync(fullPath);
    const { dosTime, dosDate } = toDosTimeDate(stat.mtime);
    const deflated = zlib.deflateRawSync(raw);
    const useDeflate = deflated.length < raw.length;
    const payload = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);
    const nameBuf = Buffer.from(relPath.split(path.sep).join('/'), 'utf8');

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // Version needed to extract (2.0)
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    // Central directory header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // Version made by
    centralHeader.writeUInt16LE(20, 6); // Version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    localChunks.push(localHeader, nameBuf, payload);
    centralChunks.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDirBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(relFiles.length, 8);
  eocd.writeUInt16LE(relFiles.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(destZip, Buffer.concat([...localChunks, centralDirBuf, eocd]));
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
    'popup',
    'icons'
  ];

  // 1. Package Chrome
  activate('chrome');
  const chromeZip = path.join(DIST_DIR, `be-locale-switcher-v${version}-chrome.zip`);
  if (fs.existsSync(chromeZip)) fs.unlinkSync(chromeZip);
  createZipArchive(chromeZip, filesToInclude);
  console.log(`✓ Packaged Chrome extension: dist/${path.basename(chromeZip)}`);

  // 2. Package Firefox
  activate('firefox');
  const firefoxZip = path.join(DIST_DIR, `be-locale-switcher-v${version}-firefox.zip`);
  if (fs.existsSync(firefoxZip)) fs.unlinkSync(firefoxZip);
  createZipArchive(firefoxZip, filesToInclude);
  console.log(`✓ Packaged Firefox extension: dist/${path.basename(firefoxZip)}`);

  // Reset to universal by default so both work immediately out of the box
  activate('universal');
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

  case 'universal':
  case 'all':
  case 'shared':
    activate('universal');
    break;

  case 'package':
  case 'dist':
    packageExtensions();
    break;

  case 'status':
  default:
    console.log(`Active manifest target: [${getActiveBrowser().toUpperCase()}]`);
    console.log('Usage:');
    console.log('  node scripts/build.js universal -> Universal manifest (loads directly in both browsers)');
    console.log('  node scripts/build.js firefox   -> Mozilla Firefox dedicated manifest');
    console.log('  node scripts/build.js chrome    -> Chromium dedicated manifest');
    console.log('  node scripts/build.js package   -> Create .zip distribution builds');
    break;
}
