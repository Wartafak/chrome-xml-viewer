# Chrome XML Viewer

Manifest V3 extension for Chrome 88+ and compatible Chromium-based browsers that support Manifest V3. It auto-formats XML with syntax highlighting, collapsible elements, line numbers, search, and XPath. Browser-specific XML handling may vary. The viewer works offline, follows the browser's light/dark color preference with a manual System/Light/Dark toggle, and respects XSLT.

## Install in Chrome or another Chromium-based browser

1. Open the browser's extensions page (for example, `chrome://extensions/` or `edge://extensions/`).
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select this folder (`chrome-xml-viewer/`)
4. For local files: on the extension card click **Details** → enable **Allow access to file URLs** (wording may vary by browser)
5. Open `test/sample.xml` via `file://` or serve: `python3 -m http.server` → `http://localhost:8000/test/sample.xml`

## Test cases

- `test/sample.xml` — highlighting, CDATA, comments, PI, collapse, search, XPath
- `test/invalid.xml` — error banner + raw view
- Large file: duplicate `sample.xml` content to >1.5MB, confirm auto-collapse banner
- XSLT: add `<?xml-stylesheet type="text/xsl" href="style.xsl"?>` → viewer must NOT override
- Theme: change the browser or OS light/dark preference → viewer follows via `prefers-color-scheme`; toolbar **Theme** button cycles System → Light → Dark (persisted via `chrome.storage`)

## Structure

- `manifest.json` — MV3, `<all_urls>` content script at `document_start`
- `content.js` — detect and parse the loaded XML, render tree/raw views, search/XPath
- `viewer.css` — light/dark theme variables, tree/search/error styles
