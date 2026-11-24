# BE Locale Switcher 🇧🇪 🇫🇷 🇳🇱

> **Zero-bloat, privacy-friendly Manifest V3 cross-browser extension for Chromium (Chrome, Brave, Edge) and Firefox that automatically defaults Belgian websites to your preferred national language (French or Dutch) via native HTTP `Accept-Language` headers, with a custom domain whitelist for any other website.**

---

## The Problem

When your browser language is set to English, visiting Belgian (`.be`) and international websites frequently defaults to the wrong national language because English versions are rarely provided, and servers fall back automatically:
- **For Francophones / Walloons:** English browsers constantly default to Dutch (`nl`).
- **For Flemings:** English browsers or certain services default to French (`fr`).

**BE Locale Switcher** solves this at the root network layer:
1. **Zero-CPU Header Locale Injection:** Intercepts requests and injects your preferred `Accept-Language` HTTP header (`fr-FR` or `nl-BE`) using native `declarativeNetRequest`.
2. **Default `.be` Coverage:** Automatically active on all Belgian `.be` domains (`*://*.be/*`).
3. **Custom Domain Whitelist:** Easily inject headers on any other domain (e.g. `aliexpress.com`, `ikea.com`, `amazon.com`) with a single click or manual entry.
4. **Zero Bloat & Zero Side Effects:** No URL tampering, no redirect loops, no content scripts injected into pages.

---

## Key Features

- **Native Header Modification (`Accept-Language`):**
  Uses browser `declarativeNetRequest` (`modifyHeaders`) to set:
  - **French First:** `fr-FR,fr;q=0.9,fr-BE;q=0.8,en;q=0.7`
  - **Dutch First:** `nl-BE,nl;q=0.9,nl-NL;q=0.8,en;q=0.7`

- **Automatic Belgian Domain Targeting (`.be`):**
  All `.be` domains receive your preferred language headers out of the box.

- **Custom Domain Injection Whitelist:**
  - One-click toggle in the popup to enable/disable header injection on the active site.
  - Manage your list of custom domains directly from the popup (add or remove any domain).

- **Minimalist Popup UI:**
  - **Language Selector:** Instant toggle between **French First** and **Dutch First**.
  - **Global Switch:** Instantly enable or disable the extension.
  - **Active Site Indicator:** Real-time feedback showing whether headers are currently being injected on the active tab.
  - **Custom Domains List:** Collapsible list showing all manually injected domains with instant deletion.

- **Strict Privacy & Zero Dependencies:**
  - Zero external libraries or npm dependencies.
  - Zero content scripts running on web pages.
  - Completely event-driven background service worker.

---

## Project Structure

```text
be-locale-switcher/
├── manifest.chrome.json      # Manifest V3 for Chromium (service_worker)
├── manifest.firefox.json     # Manifest V3 for Firefox (background.scripts & Gecko settings)
├── manifest.json             # Active manifest (swappable via scripts/build.js)
├── background.js             # Shared background script (declarativeNetRequest sync & badges)
├── popup/
│   ├── popup.html            # Minimalist popup interface
│   ├── popup.css             # Light/dark responsive styles
│   └── popup.js              # Popup controller and status sync
├── icons/
│   ├── icon.svg              # Scalable vector master icon (transparent)
│   ├── icon-16.png           # 16x16 PNG
│   ├── icon-32.png           # 32x32 PNG
│   ├── icon-48.png           # 48x48 PNG
│   ├── icon-128.png          # 128x128 PNG
│   └── icon-master.png       # 512x512 master PNG
├── scripts/
│   ├── build.js              # Manifest switcher and .zip packaging utility
├── test/
│   └── test-suite.js         # Automated test suite (DNR rules, domains, manifests)
├── dist/                     # Packaged zip releases
└── package.json              # NPM metadata and scripts
```

---

## Installation Guide

### 1. Chromium (Google Chrome, Brave, Microsoft Edge, Opera, Vivaldi)

1. Ensure the Chromium manifest is active:
   ```bash
   node scripts/build.js chrome
   # or: npm run build:chrome
   ```
2. Open your Chromium browser and navigate to:
   ```text
   chrome://extensions
   ```
   *(For Brave: `brave://extensions` | For Edge: `edge://extensions`)*
3. Enable **Developer mode** (toggle switch in the top-right corner).
4. Click **Load unpacked** in the top-left corner.
5. Select the `be-locale-switcher` project folder.
6. The extension is now active! Pin it to your toolbar to view status and controls.

---

### 2. Mozilla Firefox (Gecko MV3, Firefox 115+)

1. Switch to the Firefox manifest:
   ```bash
   node scripts/build.js firefox
   # or: npm run build:firefox
   ```
2. Open Firefox and navigate to:
   ```text
   about:debugging#/runtime/this-firefox
   ```
3. Click **Load Temporary Add-on...**
4. Browse to the `be-locale-switcher` folder and select `manifest.json`.

---

## Manifest Switching & Packaging

Switch manifests easily with the zero-dependency helper:

```bash
# Switch to Chromium
node scripts/build.js chrome

# Switch to Firefox
node scripts/build.js firefox

# View currently active manifest
node scripts/build.js status

# Create production zip archives in dist/
node scripts/build.js package
```

---

## Running Automated Tests

Run the unit and integration test suite:

```bash
npm test
# or:
node test/test-suite.js
```

---

## License

MIT License. Designed and built with privacy, speed, and zero bloat in mind.
