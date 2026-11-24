# No Dutch Please 🇧🇪 🇫🇷

> **Zero-bloat, privacy-friendly Manifest V3 cross-browser extension for Chromium (Chrome, Brave, Edge) and Firefox that automatically defaults Belgian websites to French while keeping the rest of the web in your preferred browser language (e.g. English).**

---

## The Problem

When your browser language is set to English, visiting Belgian (`.be`) websites frequently defaults to Dutch (`nl`) because English versions are rarely provided, and servers fall back to the first national language alphabetically or geographically. 

**No Dutch Please** solves this seamlessly by:
1. Setting the `Accept-Language` HTTP header on `.be` requests to French (`fr-FR`) using native, zero-CPU `declarativeNetRequest`.
2. Rewriting Dutch URL patterns (`nl` → `fr`) on subdomains, path segments, and query parameters.
3. Protecting against infinite redirect loops and 404 errors on Flemish/Dutch-only websites with a session-based loop guard.
4. Letting the rest of the internet stay in English (or whatever your browser default is).

---

## Key Features

- **Header Locale Forcing (`Accept-Language`):**
  Uses `declarativeNetRequest` (`modifyHeaders`) to intercept requests to `*://*.be/*` (`main_frame`, `sub_frame`, `xmlhttprequest`), setting:
  ```http
  Accept-Language: fr-FR,fr;q=0.9,fr-BE;q=0.8,en;q=0.7
  ```
  Non-`.be` domains are untouched.

- **Smart URL Rewriting (`nl` → `fr`):**
  - **Subdomains:** `nl.example.be` → `fr.example.be`, `nl-be.example.be` → `fr-be.example.be`
  - **Path segments:** `/nl/`, `/nl`, `/nl-be/`, `/nl_BE/`, `/nl_be/` → `/fr/`, `/fr`, `/fr-be/`, etc.
  - **Query parameters:** `lang=nl` → `lang=fr`, `locale=nl_BE` → `locale=fr_BE`, `hl=nl` → `hl=fr`
  - **Non-`.be` international sites:** Only rewrites Belgian-specific Dutch codes (e.g., `example.com/nl-be/` → `example.com/fr-be/`), never touching generic Dutch sites (`example.com/nl/`).
  - **Strict boundary matching:** Word boundaries prevent altering words like `/online`, `/only`, or `/download`.

- **Infinite Redirect Loop & 404 Protection:**
  Some Belgian sites are Flemish-only and redirect `/fr` back to `/nl` or return an HTTP 404:
  - If a tab redirects from `nl` → `fr` and bounces back to `nl` within **5 seconds**, the extension automatically detects the loop, halts redirects, and temporarily bypasses that domain in `storage.session`.
  - If a 404 occurs on the French URL within 5 seconds, the extension reverts the tab back to the original Dutch URL and temporarily bypasses the domain for the session.

- **Minimalist Popup UI:**
  - **Global Switch:** Instantly enable or disable the extension.
  - **Site Whitelist Button:** One-click "Ignore this site" toggle, saved in `storage.sync` and dynamically updating `declarativeNetRequest` exclusion rules.
  - **Live Status Indicator:** Real-time feedback (`Forcing French`, `Whitelisted`, `Temporarily Bypassed`, `Inactive`).
  - **Ignored Sites List:** View and manage whitelisted domains.
  - **Firefox Permission Helper:** Built-in prompt to grant host permissions in Firefox MV3.

- **Strict Privacy & Zero Dependencies:**
  - Zero external libraries or npm build requirements.
  - Permissions strictly scoped (`*://*.be/*`). No broad tracking permissions.
  - Memory-efficient background execution (idle event handlers).

---

## Project Structure

```text
no-dutch-please/
├── manifest.chrome.json      # Manifest V3 for Chromium (service_worker)
├── manifest.firefox.json     # Manifest V3 for Firefox (background.scripts & Gecko settings)
├── manifest.json             # Active manifest (swappable via scripts/build.js)
├── background.js             # Shared background script (DNR sync, loop guard, URL rewriting)
├── content.js                # Lightweight 404 detector (document_idle)
├── popup/
│   ├── popup.html            # Minimalist popup interface
│   ├── popup.css             # Light/dark responsive styles
│   └── popup.js              # Popup controller and status sync
├── icons/
│   ├── icon.svg              # Scalable vector master icon
│   ├── icon-16.png           # 16x16 PNG
│   ├── icon-32.png           # 32x32 PNG
│   ├── icon-48.png           # 48x48 PNG
│   └── icon-128.png          # 128x128 PNG
├── scripts/
│   ├── build.js              # Manifest switcher and .zip packaging utility
│   └── build.sh              # Bash switcher wrapper
├── test/
│   └── test-suite.js         # Automated test suite (22 unit & integration tests)
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
5. Select the `no-dutch-please` project folder.
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
4. Browse to the `no-dutch-please` folder and select `manifest.json`.
5. *(Optional/Recommended)* When opening the popup on a `.be` site for the first time, click **Grant** if Firefox displays the host permission prompt to allow `declarativeNetRequest` header modifications.

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

Run the comprehensive unit and integration test suite:

```bash
npm test
# or:
node test/test-suite.js
```

The test suite covers:
- Subdomain transformations and boundary safety (`online.example.be`, `only.example.be`)
- Path segment rewriting and preservation of uppercase (`/NL/` → `/FR/`)
- Query parameter filtering (`lang`, `locale`, `hl`)
- Non-`.be` domain isolation (only Belgian `nl-be` touched)
- Domain extraction and parent domain matching
- Loop Guard simulation (redirect detection within 5000ms)
- Manifest syntax validation for both Chromium and Firefox

---

## License

MIT License. Designed and built with privacy, speed, and zero bloat in mind.
