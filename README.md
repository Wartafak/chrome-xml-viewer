# Brave XML Viewer

Manifest V3 extension for Brave (Chromium) — auto-formats XML with syntax highlighting, pretty-print + collapse, line numbers, search, and XPath. Offline, follows Brave light/dark theme with a manual System/Light/Dark toggle, respects XSLT.

## Install in Brave

1. Open `brave://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select this folder (`chrome-xml-viewer/`)
4. For local files: on the extension card click **Details** → enable **Allow access to file URLs**
5. Open `test/sample.xml` via `file://` or serve: `python3 -m http.server` → `http://localhost:8000/test/sample.xml`

## Test cases

- `test/sample.xml` — highlighting, CDATA, comments, PI, collapse, search, XPath
- `test/invalid.xml` — error banner + raw view
- Large file: duplicate `sample.xml` content to >1.5MB, confirm auto-collapse banner
- XSLT: add `<?xml-stylesheet type="text/xsl" href="style.xsl"?>` → viewer must NOT override
- Theme: `brave://settings/appearance` light/dark → viewer follows via `prefers-color-scheme`; toolbar **Theme** button cycles System → Light → Dark (persisted via `chrome.storage`)

## Structure

- `manifest.json` — MV3, `<all_urls>` content script at `document_start`
- `content.js` — detect XML, fetch raw, parse, render tree/raw, search/XPath
- `viewer.css` — Brave light/dark variables, tree/search/error styles
