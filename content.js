(() => {
  "use strict";
  if (window.top !== window.self) return;

  const XML_TYPES = ["text/xml", "application/xml", "application/rss+xml", "application/atom+xml", "application/rdf+xml"];
  const XML_EXT = /\.(xml|xsl|rss|atom|wsdl|xsd|xsd|plist|svg|config|kml|gpx|opml)(\?.*)?$/i;
  const LARGE_BYTES = 1.5 * 1024 * 1024;
  const LARGE_NODES = 15000;

  function isChromeXmlViewer() {
    return !!document.getElementById("webkit-xml-viewer-source-xml");
  }

  function bodyLooksLikeXml() {
    try {
      const pre = document.querySelector("body > pre");
      if (!pre || document.querySelectorAll("body > *").length !== 1) return false;
      const t = (pre.textContent || "").trim();
      if (t.length < 2 || !t.startsWith("<")) return false;
      if (/^<!doctype\s+html/i.test(t) || /^<html[\s>]/i.test(t)) return false;
      return /^<\?xml[\s>]/.test(t) || /^<(rss|feed|rdf|channel|root|catalog)\b/i.test(t) || /^<[A-Za-z_][\w.-]*(\s[^>]*)?\/?>/.test(t);
    } catch { return false; }
  }

  function isXmlCandidate() {
    if (isChromeXmlViewer()) return true;
    const ct = (document.contentType || "").toLowerCase().split(";")[0].trim();
    const url = location.href;
    if (ct === "image/svg+xml" || ct === "application/xhtml+xml") return false;
    if (ct && (ct.includes("xml") || ct.includes("rss") || ct.includes("atom") || XML_TYPES.includes(ct))) return true;
    if ((ct === "text/plain" || ct === "text/html" || ct === "") && XML_EXT.test(url.split("#")[0])) return true;
    // Server sent XML as text/plain (no .xml extension) — Brave wraps it in <body><pre>.
    // This is exactly the rss.impresa.pt case: contentType=text/plain, DOM=<pre>&lt;?xml…</pre>.
    if (ct === "text/plain" && bodyLooksLikeXml()) return true;
    return false;
  }

  function hasStylesheet() {
    try {
      for (const n of document.childNodes) {
        if (n.nodeType === Node.PROCESSING_INSTRUCTION_NODE && n.target === "xml-stylesheet") return true;
      }
      const s = new XMLSerializer().serializeToString(document).slice(0, 2000);
      if (s.includes("xml-stylesheet")) return true;
    } catch { /* ignore */ }
    return false;
  }

  async function getRawText() {
    // 1. Chrome native XML viewer (Brave renders RSS/XML as HTML) — grab its source element.
    const viewerEl = document.getElementById("webkit-xml-viewer-source-xml");
    if (viewerEl && viewerEl.textContent && viewerEl.textContent.trim().startsWith("<")) {
      return viewerEl.textContent;
    }
    // 2. text/plain-wrapped XML (e.g. rss.impresa.pt serves text/plain + <body><pre>).
    const pre = document.querySelector("body > pre");
    if (pre && pre.textContent && pre.textContent.trim().startsWith("<")) {
      return pre.textContent;
    }
    // 3. Prefer fetch for exact source (http/https). file:// needs "Allow access to file URLs".
    if (/^(https?|file):/.test(location.protocol)) {
      try {
        const res = await fetch(location.href, { credentials: "same-origin" });
        if (res.ok) {
          const t = await res.text();
          if (t.trim().startsWith("<")) return t;
        }
      } catch { /* fallback below */ }
    }
    try {
      return new XMLSerializer().serializeToString(document);
    } catch {
      return document.documentElement ? document.documentElement.outerHTML : "";
    }
  }

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function fmtSize(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(2) + " MB";
  }

  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const err = doc.getElementsByTagName("parsererror")[0];
    return { doc, error: err ? err.textContent : null };
  }

  function countNodes(doc) {
    let n = 0;
    const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_ALL);
    while (walker.nextNode()) { n++; if (n > LARGE_NODES + 5000) break; }
    return n;
  }

  // ---------- viewer ----------
  let lineNo = 0;
  let matches = [];
  let matchIdx = -1;
  let selectedLine = null;

  function el(tag, cls, html) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html !== undefined) d.innerHTML = html;
    return d;
  }

  function makeLine(codeHtml, indent) {
    lineNo++;
    const line = el("div", "xv-line");
    line.dataset.line = String(lineNo);
    const g = el("span", "xv-gutter", String(lineNo));
    const c = el("span", "xv-code", "  ".repeat(indent) + codeHtml);
    line.appendChild(g);
    line.appendChild(c);
    return { line, code: c };
  }

  function attrHtml(node) {
    let s = "";
    for (const a of node.attributes || []) {
      s += ` <span class="tk-attr">${esc(a.name)}</span><span class="tk-bracket">=</span><span class="tk-bracket">"</span><span class="tk-val">${esc(a.value)}</span><span class="tk-bracket">"</span>`;
    }
    return s;
  }

  function xpathFor(node) {
    if (!node || node.nodeType !== 1) return "";
    const parts = [];
    let cur = node;
    while (cur && cur.nodeType === 1) {
      let idx = 1;
      let sib = cur.previousSibling;
      while (sib) { if (sib.nodeType === 1 && sib.nodeName === cur.nodeName) idx++; sib = sib.previousSibling; }
      parts.unshift(`${cur.nodeName}[${idx}]`);
      cur = cur.parentNode;
      if (cur && cur.nodeType === 9) break;
    }
    return "/" + parts.join("/");
  }

  function renderNode(domNode, indent, container, domRef, autoCollapseDepth) {
    const frag = document.createDocumentFragment();
    const push = (lineEl) => frag.appendChild(lineEl);

    if (domNode.nodeType === 9) {
      for (const child of domNode.childNodes) renderNode(child, indent, { appendChild: (n) => frag.appendChild(n) }, domRef, autoCollapseDepth);
      container.appendChild(frag);
      return;
    }

    if (domNode.nodeType === 1) {
      const tag = domNode.tagName;
      const attrs = attrHtml(domNode);
      const elemChildren = [...domNode.childNodes].filter((n) => n.nodeType === 1);
      const textKids = [...domNode.childNodes].filter((n) => n.nodeType === 3 && n.nodeValue.trim() !== "");
      const otherKids = [...domNode.childNodes].filter((n) => ![1, 3].includes(n.nodeType) || (n.nodeType === 3 && n.nodeValue.trim() !== ""));
      const hasBlockChildren = elemChildren.length > 0 || [...domNode.childNodes].some((n) => n.nodeType === 8 || n.nodeType === 4 || n.nodeType === 7);

      // Compact single-text inline: <tag>text</tag>
      if (!hasBlockChildren && textKids.length === 1 && domNode.childNodes.length === 1) {
        const { line, code } = makeLine(
          `<span class="tk-bracket">&lt;</span><span class="tk-tag">${esc(tag)}</span>${attrs}<span class="tk-bracket">&gt;</span>` +
          `<span class="tk-text">${esc(textKids[0].nodeValue)}</span>` +
          `<span class="tk-bracket">&lt;/</span><span class="tk-tag">${esc(tag)}</span><span class="tk-bracket">&gt;</span>`,
          indent
        );
        line.addEventListener("click", () => selectLine(line, domNode));
        push(line);
        container.appendChild(frag);
        return;
      }

      if (!hasBlockChildren && domNode.childNodes.length === 0) {
        const { line } = makeLine(`<span class="tk-bracket">&lt;</span><span class="tk-tag">${esc(tag)}</span>${attrs}<span class="tk-bracket">/&gt;</span>`, indent);
        line.addEventListener("click", () => selectLine(line, domNode));
        push(line);
        container.appendChild(frag);
        return;
      }

      // Open tag line with toggle
      const { line: openLine, code: openCode } = makeLine("", indent);
      const toggle = document.createElement("button");
      toggle.className = "xv-toggle";
      toggle.textContent = "▾";
      const childBox = el("div", "xv-children");
      const ellipsis = el("span", "xv-ellipsis", "");
      const collapsed = indent >= autoCollapseDepth;
      if (collapsed) { childBox.classList.add("collapsed"); toggle.textContent = "▸"; ellipsis.textContent = `… ${elemChildren.length || "…"}`; }
      toggle.onclick = (e) => {
        e.stopPropagation();
        const isCollapsed = childBox.classList.toggle("collapsed");
        toggle.textContent = isCollapsed ? "▸" : "▾";
        ellipsis.style.display = isCollapsed ? "" : "none";
      };
      ellipsis.style.display = collapsed ? "" : "none";
      ellipsis.onclick = (e) => { e.stopPropagation(); toggle.click(); };
      openCode.appendChild(toggle);
      openCode.insertAdjacentHTML("beforeend", `<span class="tk-bracket">&lt;</span><span class="tk-tag">${esc(tag)}</span>${attrs}<span class="tk-bracket">&gt;</span> `);
      openCode.appendChild(ellipsis);
      openLine.addEventListener("click", () => selectLine(openLine, domNode));
      push(openLine);

      // Children
      for (const child of domNode.childNodes) {
        if (child.nodeType === 3) {
          if (child.nodeValue.trim() === "") continue;
          const { line } = makeLine(`<span class="tk-text">${esc(child.nodeValue.trim())}</span>`, indent + 1);
          childBox.appendChild(line);
        } else {
          renderNode(child, indent + 1, childBox, domRef, autoCollapseDepth);
        }
      }
      frag.appendChild(childBox);

      const { line: closeLine } = makeLine(`<span class="tk-bracket">&lt;/</span><span class="tk-tag">${esc(tag)}</span><span class="tk-bracket">&gt;</span>`, indent);
      closeLine.addEventListener("click", () => selectLine(closeLine, domNode));
      frag.appendChild(closeLine);
      container.appendChild(frag);
      return;
    }

    if (domNode.nodeType === 8) {
      const { line } = makeLine(`<span class="tk-comment">&lt;!--${esc(domNode.nodeValue)}--&gt;</span>`, indent);
      push(line);
    } else if (domNode.nodeType === 4) {
      const { line } = makeLine(`<span class="tk-cdata">&lt;![CDATA[${esc(domNode.nodeValue)}]]&gt;</span>`, indent);
      push(line);
    } else if (domNode.nodeType === 7) {
      const { line } = makeLine(`<span class="tk-pi">&lt;?${esc(domNode.target)} ${esc(domNode.data)}?&gt;</span>`, indent);
      push(line);
    } else if (domNode.nodeType === 10) {
      const { line } = makeLine(`<span class="tk-doctype">&lt;!DOCTYPE ${esc(domNode.name)}&gt;</span>`, indent);
      push(line);
    } else if (domNode.nodeType === 3) {
      if (domNode.nodeValue.trim() !== "") {
        const { line } = makeLine(`<span class="tk-text">${esc(domNode.nodeValue.trim())}</span>`, indent);
        push(line);
      } else return;
    } else {
      return;
    }
    container.appendChild(frag);
  }

  function selectLine(line, domNode) {
    if (selectedLine) selectedLine.classList.remove("selected");
    selectedLine = line;
    line.classList.add("selected");
    const xp = el("span");
    const path = domNode ? xpathFor(domNode) : "";
    const xpathEl = document.getElementById("xv-xpath");
    if (xpathEl) xpathEl.textContent = path || "(no xpath)";
    line.scrollIntoView({ block: "nearest" });
  }

  function clearMarks(root) {
    for (const m of root.querySelectorAll("mark")) {
      m.replaceWith(document.createTextNode(m.textContent));
    }
    root.normalize();
    matches = [];
    matchIdx = -1;
    updateCount();
  }

  function updateCount() {
    const c = document.getElementById("xv-count");
    if (c) c.textContent = matches.length ? `${matchIdx + 1}/${matches.length}` : "";
  }

  function doSearch(q) {
    const main = document.getElementById("xv-main");
    clearMarks(main);
    if (!q) return;
    const ql = q.toLowerCase();
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    let capped = false;
    for (const tn of textNodes) {
      const idx = tn.nodeValue.toLowerCase().indexOf(ql);
      if (idx === -1) continue;
      if (matches.length > 500) { capped = true; break; }
      const parent = tn.parentNode;
      if (parent && (parent.tagName === "MARK" || parent.classList?.contains("xv-gutter"))) continue;
      const before = tn.nodeValue.slice(0, idx);
      const mid = tn.nodeValue.slice(idx, idx + q.length);
      const after = tn.nodeValue.slice(idx + q.length);
      const mark = document.createElement("mark");
      mark.textContent = mid;
      parent.insertBefore(document.createTextNode(before), tn);
      parent.insertBefore(mark, tn);
      parent.insertBefore(document.createTextNode(after), tn);
      parent.removeChild(tn);
      matches.push(mark);
      // expand collapsed ancestors
      let a = mark.parentElement;
      while (a) {
        if (a.classList?.contains("xv-children") && a.classList.contains("collapsed")) {
          a.classList.remove("collapsed");
          const prev = a.previousSibling;
          const t = prev?.querySelector?.(".xv-toggle");
          if (t) t.textContent = "▾";
          const e = prev?.querySelector?.(".xv-ellipsis");
          if (e) e.style.display = "none";
        }
        a = a.parentElement;
      }
    }
    if (capped) {
      const c = document.getElementById("xv-count");
      if (c) c.textContent = `500+ matches (capped)`;
      return;
    }
    if (matches.length) { matchIdx = 0; matches[0].classList.add("current"); matches[0].scrollIntoView({ block: "center" }); }
    updateCount();
  }

  function stepMatch(dir) {
    if (!matches.length) return;
    matches[matchIdx]?.classList.remove("current");
    matchIdx = (matchIdx + dir + matches.length) % matches.length;
    matches[matchIdx].classList.add("current");
    matches[matchIdx].scrollIntoView({ block: "center" });
    updateCount();
  }

  async function boot() {
    if (!isXmlCandidate()) return;
    const isHtmlDoc = document.documentElement && document.documentElement.tagName.toLowerCase() === "html";
    // Brave/Chrome renders RSS/XML either via built-in viewer or as text/plain <pre>.
    // Only skip real HTML pages — not the native viewer / pre-wrapped XML.
    if (isHtmlDoc && !isChromeXmlViewer() && !bodyLooksLikeXml()) return;
    if (hasStylesheet()) return; // respect XSLT

    const raw = await getRawText();
    if (!raw || !raw.trim().startsWith("<")) return;
    // Respect XSLT: check raw source too (native viewer hides the PI from the DOM).
    if (raw.slice(0, 3000).includes("xml-stylesheet")) return;

    const { doc, error } = parseXml(raw);
    const nodeCount = error ? 0 : countNodes(doc);
    const isLarge = raw.length > LARGE_BYTES || nodeCount > LARGE_NODES;
    const autoCollapseDepth = isLarge ? 1 : 8;

    // Switch to HTML viewer — reuse existing <head>/<body> when present
    // (text/plain <pre> case). document.open/write leaves document.body null
    // briefly, which caused "Cannot read properties of null (appendChild)".
    const title = (location.pathname.split("/").pop() || location.host || "XML") + " — XML Viewer";
    let cssHref = "";
    try { cssHref = chrome.runtime.getURL("viewer.css"); } catch { cssHref = ""; }
    if (document.head && document.body) {
      document.head.replaceChildren();
      document.body.replaceChildren();
      const meta = document.createElement("meta");
      meta.setAttribute("charset", "utf-8");
      document.head.appendChild(meta);
      if (cssHref) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = cssHref;
        document.head.appendChild(link);
      }
      document.title = title;
    } else {
      document.open("text/html");
      document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title></title>${cssHref ? `<link rel="stylesheet" href="${cssHref}">` : ""}</head><body></body></html>`);
      document.close();
      // body parses async after document.close() — wait for it.
      await new Promise((resolve) => {
        let tries = 0;
        const tick = () => {
          if (document.body || tries++ > 50) resolve();
          else requestAnimationFrame(tick);
        };
        tick();
      });
      if (!document.body) return;
      document.title = title;
    }

    const header = el("header", null);
    header.id = "xv-header";
    const t = el("span", null);
    t.id = "xv-title";
    t.textContent = location.href.split("/").pop() || location.href;
    const meta = el("span", null);
    meta.id = "xv-meta";
    meta.textContent = `${fmtSize(raw.length)} · ${error ? "invalid XML" : nodeCount + " nodes"} · auto (Brave theme)`;
    const controls = el("div", null);
    controls.id = "xv-controls";
    controls.innerHTML = `<input type="search" id="xv-search" placeholder="Search…" aria-label="Search">
      <button id="xv-prev" title="Previous match">↑</button>
      <button id="xv-next" title="Next match">↓</button>
      <span id="xv-count"></span>
      <button id="xv-expand">Expand all</button>
      <button id="xv-collapse">Collapse all</button>
      <button id="xv-toggle-raw">Raw</button>
      <button id="xv-copy-xpath">Copy XPath</button>
      <button id="xv-theme" title="Theme: follow system (click to change)">Theme: System</button>`;
    header.appendChild(t);
    header.appendChild(meta);
    header.appendChild(controls);
    document.body.appendChild(header);

    const banner = el("div", null);
    banner.id = "xv-banner";
    document.body.appendChild(banner);
    if (isLarge && !error) {
      banner.style.display = "block";
      banner.textContent = `Large file (${fmtSize(raw.length)}, ~${nodeCount} nodes) — auto-collapsed to depth 1 for performance. Search capped at 500 matches.`;
    }

    const errBox = el("div", null);
    errBox.id = "xv-error";
    document.body.appendChild(errBox);
    if (error) {
      errBox.style.display = "block";
      errBox.textContent = "Invalid XML: " + error;
    }

    const main = el("div", null);
    main.id = "xv-main";
    document.body.appendChild(main);

    const rawBox = el("div", null);
    rawBox.id = "xv-raw";
    document.body.appendChild(rawBox);

    const status = el("div", null);
    status.id = "xv-status";
    status.innerHTML = `<strong>XPath:</strong> <span id="xv-xpath">(click a tag)</span>`;
    document.body.appendChild(status);

    if (!error) {
      lineNo = 0;
      renderNode(doc, 0, main, null, autoCollapseDepth);
    }

    // Raw view with line numbers
    lineNo = 0;
    const rawFrag = document.createDocumentFragment();
    for (const rawLine of raw.split("\n")) {
      lineNo++;
      const line = el("div", "xv-line");
      line.appendChild(el("span", "xv-gutter", String(lineNo)));
      const code = el("span", "xv-code");
      code.textContent = rawLine;
      line.appendChild(code);
      rawFrag.appendChild(line);
    }
    const pre = el("div", null);
    pre.appendChild(rawFrag);
    rawBox.appendChild(pre);

    // Events
    let rawMode = !!error;
    const syncMode = () => {
      main.style.display = rawMode ? "none" : "";
      rawBox.style.display = rawMode ? "block" : "none";
      document.getElementById("xv-toggle-raw").textContent = rawMode ? "Tree" : "Raw";
    };
    syncMode();

    document.getElementById("xv-toggle-raw").onclick = () => { rawMode = !rawMode; syncMode(); };
    document.getElementById("xv-expand").onclick = () => {
      for (const c of main.querySelectorAll(".xv-children.collapsed")) c.classList.remove("collapsed");
      for (const x of main.querySelectorAll(".xv-toggle")) x.textContent = "▾";
      for (const x of main.querySelectorAll(".xv-ellipsis")) x.style.display = "none";
    };
    document.getElementById("xv-collapse").onclick = () => {
      for (const c of main.querySelectorAll(".xv-children:not(.collapsed)")) c.classList.add("collapsed");
      for (const x of main.querySelectorAll(".xv-toggle")) x.textContent = "▸";
      for (const x of main.querySelectorAll(".xv-ellipsis")) x.style.display = "";
    };
    document.getElementById("xv-copy-xpath").onclick = async () => {
      const xp = document.getElementById("xv-xpath").textContent || "";
      try { await navigator.clipboard.writeText(xp); } catch { /* clipboard may be blocked */ }
    };
    // Theme: 3-state toggle (system → light → dark), persisted extension-wide
    const THEMES = ["system", "light", "dark"];
    const THEME_LABEL = { system: "System", light: "Light", dark: "Dark" };
    let themeMode = "system";
    const applyTheme = (mode) => {
      themeMode = THEMES.includes(mode) ? mode : "system";
      if (themeMode === "light" || themeMode === "dark") {
        document.documentElement.dataset.theme = themeMode;
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
      const btn = document.getElementById("xv-theme");
      if (btn) {
        btn.textContent = "Theme: " + THEME_LABEL[themeMode];
        btn.title = `Theme: ${themeMode === "system" ? "follow system" : "forced " + themeMode} (click to change)`;
      }
    };
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get({ xvTheme: "system" }, (res) => {
          try { applyTheme(res && res.xvTheme); } catch { /* noop */ }
        });
      }
    } catch { /* storage unavailable — stay on system */ }
    document.getElementById("xv-theme").onclick = () => {
      applyTheme(THEMES[(THEMES.indexOf(themeMode) + 1) % THEMES.length]);
      try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ xvTheme: themeMode });
        }
      } catch { /* ignore persistence failure */ }
    };
    let debounce;
    document.getElementById("xv-search").addEventListener("input", (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => doSearch(e.target.value.trim()), 200);
    });
    document.getElementById("xv-search").addEventListener("keydown", (e) => {
      if (e.key === "Enter") stepMatch(e.shiftKey ? -1 : 1);
    });
    document.getElementById("xv-next").onclick = () => stepMatch(1);
    document.getElementById("xv-prev").onclick = () => stepMatch(-1);
    try { window.__xvViewer = { version: "0.1.6", nodes: nodeCount, size: raw.length }; } catch { /* noop */ }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
