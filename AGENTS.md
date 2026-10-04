# AGENTS.md

Chrome MV3 extension that replaces the browser's plain-XML page with a formatted tree.
Read `README.md` first — it documents install steps and the manual test matrix.

## Commands

- `npm run build` — Vite bundles `src/content.ts` → `dist/content.js` (IIFE) and copies `public/` (manifest.json, viewer.css, icons) into `dist/`. `dist/` is gitignored; always rebuild before "Load unpacked".
- `npm test` — Vitest, single pass. `npm run test:watch` for the loop.
- `npm run typecheck` — `tsc --noEmit`, `strict: true`. No linter is configured.

Run `npm run typecheck && npm test` before committing; there is no CI.

## Architecture

- Everything lives in one content script: `src/content.ts` (~800 lines, an IIFE, no modules/exports at runtime). `src/xml-utils.ts` holds the only extracted pure helpers (`hasXmlExtension`, `formatByteSize`) so they are unit-testable.
- `public/manifest.json` injects `content.js` at `document_start` for `<all_urls>`, `all_frames: false`. The script bails when `window.top !== window.self`.
- No network calls, ever. The script reads XML from what the browser already loaded: the native viewer's `#webkit-xml-viewer-source-xml`, the live `XMLDocument`, or the `body > pre` wrapper Chrome adds for `text/plain` XML.
- `public/viewer.css` is loaded at runtime via `chrome.runtime.getURL`, not bundled — it is in `web_accessible_resources`.

## Invariants that are easy to break

- **Build output must stay Chrome 88 compatible** (`build.target: "chrome88"`). Avoid modern syntax/APIs that Chrome 88 lacks.
- **Always build DOM with `createElementNS(XHTML_NS, ...)`**, never `innerHTML`. The host page may be an `XMLDocument` (native viewer) where `document.createElement()` yields null-namespace nodes and `innerHTML` re-parses as XML. This is why every element goes through `createXhtmlElement` (`src/content.ts:126`).
- **Takeover is opt-out for XSLT and non-XML types.** `candidateKind()` returns `"declared" | "sniffed" | null`; `null` means leave the page alone. `image/svg+xml` and `application/xhtml+xml` are always skipped, and a document with an `xml-stylesheet` PI is never overridden. Preserve these exclusions.
- **Version is duplicated** in `package.json` and `public/manifest.json` (currently `0.1.8`). Bump both when releasing.
- Theme is persisted under `chrome.storage` key `xvTheme` and must degrade quietly when `chrome.runtime` is absent (tests stub `chrome` as `undefined`).

## Testing quirks

- `tests/content.test.ts` needs jsdom, but the default Vitest environment is `node`; the file opts in with a `// @vitest-environment jsdom` comment. Do not remove it.
- The test helper `load()` re-imports `src/content` after `vi.resetModules()` and dispatches `DOMContentLoaded` by hand — the content script waits for that event. Preserve that sequence when adding tests.
- `tests/fixtures/*.xml` exist for manual browser testing, not for the unit suite (which builds XML inline as strings).
- jsdom gaps the tests stub around: `scrollIntoView`, `chrome`, and `DOMParser.parseFromString` for invalid-XML cases.

## Conventions

- Always use braces for control flow — an explicit decision in this repo (commit "Always use braces for control flow").
- Screenshots and docs images go in `docs/`; README references them relatively.