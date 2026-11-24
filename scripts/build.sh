#!/usr/bin/env bash
# No Dutch Please - Quick Manifest Switcher
set -e

TARGET="${1:-status}"

case "$TARGET" in
  chrome|chromium)
    cp manifest.chrome.json manifest.json
    echo "✓ Switched manifest.json to Chromium (Chrome, Brave, Edge)"
    ;;
  firefox|gecko)
    cp manifest.firefox.json manifest.json
    echo "✓ Switched manifest.json to Mozilla Firefox"
    ;;
  package)
    node scripts/build.js package
    ;;
  *)
    node scripts/build.js status
    ;;
esac
