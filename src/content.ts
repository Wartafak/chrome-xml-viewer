import { formatByteSize, hasXmlExtension } from "./xml-utils";

(() => {
  "use strict";
  if (window.top !== window.self) {
    return;
  }

  const XHTML_NS = "http://www.w3.org/1999/xhtml";
  const LARGE_BYTES = 1.5 * 1024 * 1024;
  const LARGE_NODES = 15000;
  const MAX_MATCHES = 1000;
  const THEME_KEY = "xvTheme";
  const THEMES = ["system", "light", "dark"] as const;
  type Theme = typeof THEMES[number];
  const THEME_LABELS = { system: "System", light: "Light", dark: "Dark" };

  // ---------------------------------------------------------------- detection

  function isNativeXmlViewer() {
    return !!document.getElementById("webkit-xml-viewer-source-xml");
  }

  function bodyLooksLikeXml() {
    try {
      const pre = document.querySelector("body > pre");
      if (!pre || document.querySelectorAll("body > *").length !== 1) {
        return false;
      }
      const t = (pre.textContent || "").trim();
      if (t.length < 2 || !t.startsWith("<")) {
        return false;
      }
      if (/^<!doctype\s+html/i.test(t) || /^<html[\s>]/i.test(t)) {
        return false;
      }
      return /^<\?xml[\s>]/.test(t) || /^<[A-Za-z_][\w.:-]*(\s[^>]*)?\/?>/.test(t);
    } catch {
      return false;
    }
  }

  // "declared": content type / extension / native viewer say it is XML.
  // "sniffed": only the text/plain body looks like XML; must parse cleanly to be taken over.
  function candidateKind() {
    if (isNativeXmlViewer()) {
      return "declared";
    }
    const ct = (document.contentType || "").toLowerCase().split(";")[0].trim();
    if (ct === "image/svg+xml" || ct === "application/xhtml+xml") {
      return null;
    }
    if (ct.includes("xml") || ct.includes("rss") || ct.includes("atom")) {
      return "declared";
    }
    if ((ct === "text/plain" || ct === "text/html" || ct === "") && hasXmlExtension(location.href)) {
      return "declared";
    }
    // Server sent XML as text/plain without an .xml extension; the browser wraps it in <body><pre>.
    if (ct === "text/plain" && bodyLooksLikeXml()) {
      return "sniffed";
    }
    return null;
  }

  function hasStylesheetPI(doc: Document) {
    for (const n of doc.childNodes) {
      if (n instanceof ProcessingInstruction && n.target === "xml-stylesheet") {
        return true;
      }
    }
    return false;
  }

  function findParserError(doc: Document): { node: Element; message: string } | null {
    const pe = doc.getElementsByTagNameNS(XHTML_NS, "parsererror")[0];
    if (!pe) {
      return null;
    }
    const detail = pe.querySelector("div") || pe;
    return { node: pe, message: (detail.textContent || "parse error").trim() };
  }

  // Returns { raw, error } from what the browser already loaded. Never re-requests the URL.
  function readLoadedXmlSource(): { raw: string | null; error: string | null } {
    const ser = new XMLSerializer();
    const src = document.getElementById("webkit-xml-viewer-source-xml");
    if (src) {
      return { raw: Array.from(src.childNodes, (n) => ser.serializeToString(n)).join("\n"), error: null };
    }
    if (!(document instanceof HTMLDocument)) {
      const pe = findParserError(document);
      if (!pe) {
        return { raw: ser.serializeToString(document), error: null };
      }
      // Browser recovered a partial document; show what it parsed, minus its error element.
      const clone = document.cloneNode(true) as Document;
      for (const e of Array.from(clone.getElementsByTagNameNS(XHTML_NS, "parsererror"))) {
        e.remove();
      }
      return { raw: ser.serializeToString(clone), error: pe.message + " (showing content up to the error)" };
    }
    const pre = document.querySelector("body > pre");
    return { raw: pre ? pre.textContent : null, error: null };
  }

  function parseXml(raw: string): { doc: Document | null; error: string | null } {
    const doc = new DOMParser().parseFromString(raw, "application/xml");
    const pe = findParserError(doc);
    return pe ? { doc: null, error: pe.message } : { doc, error: null };
  }

  function countNodes(doc: Document, cap: number): number {
    const w = doc.createTreeWalker(doc, NodeFilter.SHOW_ELEMENT);
    let n = 0;
    while (w.nextNode() && n < cap) {
      n++;
    }
    return n;
  }

  // ---------------------------------------------------------------- DOM helpers
  // The page may be an XMLDocument (native XML viewer): createElement() would give
  // null-namespace elements and innerHTML would be parsed as XML, so always build XHTML nodes.

  function createXhtmlElement(tag: string, cls: string | null = null, text?: string): HTMLElement {
    const e = document.createElementNS(XHTML_NS, tag) as HTMLElement;
    if (cls) {
      e.setAttribute("class", cls);
    }
    if (text != null) {
      e.textContent = text;
    }
    return e;
  }

  function createTokenSpan(cls: string, text: string): HTMLElement { return createXhtmlElement("span", cls, text); }

  function button(id: string, text: string): HTMLButtonElement {
    const b = createXhtmlElement("button", null, text) as HTMLButtonElement;
    b.id = id;
    b.setAttribute("type", "button");
    return b;
  }

  // ---------------------------------------------------------------- XML tree model

  function isVisible(n: Node): boolean {
    switch (n.nodeType) {
      case Node.TEXT_NODE: {
        return (n as Text).data.trim() !== "";
      }
      case Node.ELEMENT_NODE:
      case Node.CDATA_SECTION_NODE:
      case Node.COMMENT_NODE:
      case Node.PROCESSING_INSTRUCTION_NODE:
      case Node.DOCUMENT_TYPE_NODE: {
        return true;
      }
      default: {
        return false;
      }
    }
  }

  function visibleChildren(n: ParentNode): Node[] {
    const out: Node[] = [];
    for (const c of n.childNodes) {
      if (isVisible(c)) {
        out.push(c);
      }
    }
    return out;
  }

  function shapeOf(el: Element): { kind: "empty" | "compact" | "block"; children: Node[] } {
    const children = visibleChildren(el);
    if (children.length === 0) {
      return { kind: "empty", children };
    }
    if (children.length === 1 && children[0].nodeType === Node.TEXT_NODE) {
      return { kind: "compact", children };
    }
    return { kind: "block", children };
  }

  const lineCounts = new WeakMap<Element, number>();
  function renderedLineCount(n: Node): number {
    if (!(n instanceof Element)) {
      return 1;
    }
    let c = lineCounts.get(n);
    if (c !== undefined) {
      return c;
    }
    const s = shapeOf(n);
    c = 1;
    if (s.kind === "block") {
      c = 2;
      for (const child of s.children) {
        c += renderedLineCount(child);
      }
    }
    lineCounts.set(n, c);
    return c;
  }

  function xpathStep(el: Element): string {
    const ns = el.namespaceURI, ln = el.localName;
    let idx = 0, total = 0;
    for (const s of el.parentElement?.children ?? []) {
      if (s.localName === ln && s.namespaceURI === ns) {
        total++;
        if (s === el) {
          idx = total;
        }
      }
    }
    const q = (v: string) => (v.includes("'") ? `"${v}"` : `'${v}'`);
    const name = ns ? `*[local-name()=${q(ln)} and namespace-uri()=${q(ns)}]` : ln;
    return total > 1 ? `${name}[${idx}]` : name;
  }

  function xpathFor(el: Element): string {
    const parts: string[] = [];
    for (let n: Element | null = el; n; n = n.parentElement) {
      parts.unshift(xpathStep(n));
    }
    return "/" + parts.join("/");
  }

  // ---------------------------------------------------------------- viewer

  function buildViewer({ raw, doc, error }: { raw: string; doc: Document | null; error: string | null }) {
    const bytes = new TextEncoder().encode(raw).length;
    const nodeCount = doc ? countNodes(doc, LARGE_NODES + 1) : 0;
    const large = bytes > LARGE_BYTES || nodeCount > LARGE_NODES;

    let collapseDepth = large ? 1 : 8;
    let rawMode = !!error;
    let rawBuilt = false;
    let selectedLine: HTMLElement | null = null;
    let selectedXPath: string | null = null;
    let matches: HTMLElement[][] = [];   // array of arrays of <mark> (one group per match)
    let matchIdx = -1;
    let capped = false;
    let theme: Theme = "system";

    const lineOwner = new WeakMap<HTMLElement, Node>(); // .xv-line -> XML node
    const pending = new Map<HTMLElement, { node: Element; depth: number; start: number }>(); // deferred child render state

    // ---- line rendering

    function makeLine(num: number, depth: number, parts: Node[], owner?: Node | null): HTMLElement {
      const line = createXhtmlElement("div", "xv-line");
      line.setAttribute("data-line", String(num));
      const code = createXhtmlElement("span", "xv-code");
      if (depth > 0) {
        code.append(createXhtmlElement("span", "xv-indent", "  ".repeat(depth)));
      }
      code.append(...parts);
      line.append(createXhtmlElement("span", "xv-gutter", String(num)), code);
      if (owner) {
        lineOwner.set(line, owner);
      }
      return line;
    }

    function openTag(el: Element, selfClose: boolean): Node[] {
      const parts: Node[] = [createTokenSpan("tk-bracket", "<"), createTokenSpan("tk-tag", el.nodeName)];
      for (const a of el.attributes) {
        parts.push(document.createTextNode(" "), createTokenSpan("tk-attr", a.name), createTokenSpan("tk-bracket", "="),
          createTokenSpan("tk-bracket", "\""), createTokenSpan("tk-val", a.value), createTokenSpan("tk-bracket", "\""));
      }
      parts.push(createTokenSpan("tk-bracket", selfClose ? "/>" : ">"));
      return parts;
    }

    function closeTag(el: Element): Node[] {
      return [createTokenSpan("tk-bracket", "</"), createTokenSpan("tk-tag", el.nodeName), createTokenSpan("tk-bracket", ">")];
    }

    function renderNode(n: Node, depth: number, num: number, out: HTMLElement | DocumentFragment): void {
      if (n instanceof CDATASection) {
        out.append(makeLine(num, depth, [createTokenSpan("tk-cdata", `<![CDATA[${n.data}]]>`)], n));
        return;
      }
      if (n instanceof Text) {
        out.append(makeLine(num, depth, [createTokenSpan("tk-text", n.data.trim())], n));
        return;
      }
      if (n instanceof Comment) {
        out.append(makeLine(num, depth, [createTokenSpan("tk-comment", `<!--${n.data}-->`)], n));
        return;
      }
      if (n instanceof ProcessingInstruction) {
        out.append(makeLine(num, depth, [createTokenSpan("tk-pi", `<?${n.target}${n.data ? " " + n.data : ""}?>`)], n));
        return;
      }
      if (n instanceof DocumentType) {
        out.append(makeLine(num, depth, [createTokenSpan("tk-doctype", `<!DOCTYPE ${n.name}>`)], n));
        return;
      }
      if (!(n instanceof Element)) {
        return;
      }
      const s = shapeOf(n);
      if (s.kind === "empty") {
        out.append(makeLine(num, depth, openTag(n, true), n));
        return;
      }
      if (s.kind === "compact") {
        out.append(makeLine(num, depth, [...openTag(n, false), createTokenSpan("tk-text", (s.children[0] as Text).data.trim()), ...closeTag(n)], n));
        return;
      }
      const toggle = createXhtmlElement("button", "xv-toggle");
      toggle.setAttribute("type", "button");
      const childCount = n.childElementCount;
      const ellipsis = createTokenSpan("xv-ellipsis", childCount ? `… ${childCount}` : "…");
      const childrenBox = createXhtmlElement("div", "xv-children");
      out.append(
        makeLine(num, depth, [toggle, ...openTag(n, false), document.createTextNode(" "), ellipsis], n),
        childrenBox,
        makeLine(num + renderedLineCount(n) - 1, depth, closeTag(n), n),
      );
      if (depth + 1 > collapseDepth) {
        pending.set(childrenBox, { node: n, depth: depth + 1, start: num + 1 });
        setCollapsed(childrenBox, true);
      } else {
        renderChildren(n, depth + 1, num + 1, childrenBox);
        setCollapsed(childrenBox, false);
      }
    }

    function renderChildren(parent: ParentNode, depth: number, num: number, out: HTMLElement | DocumentFragment): void {
      const frag = document.createDocumentFragment();
      for (const child of visibleChildren(parent)) {
        renderNode(child, depth, num, frag);
        num += renderedLineCount(child);
      }
      out.append(frag);
    }

    function materialize(box: HTMLElement): void {
      const p = pending.get(box);
      if (!p) {
        return;
      }
      pending.delete(box);
      renderChildren(p.node, p.depth, p.start, box);
    }

    function materializeAll() {
      while (pending.size) {
        for (const box of Array.from(pending.keys())) {
          materialize(box);
        }
      }
    }

    function setCollapsed(box: HTMLElement, collapsed: boolean): void {
      if (!collapsed) {
        materialize(box);
      }
      box.classList.toggle("collapsed", collapsed);
      const open = box.previousElementSibling;
      const toggle = open?.querySelector(".xv-toggle");
      const ellipsis = open?.querySelector<HTMLElement>(".xv-ellipsis");
      if (toggle) {
        toggle.textContent = collapsed ? "▸" : "▾";
      }
      if (ellipsis) {
        ellipsis.style.display = collapsed ? "" : "none";
      }
    }

    // ---- skeleton

    const title = location.href.split("/").pop() || location.href;
    const header = createXhtmlElement("header");
    header.id = "xv-header";
    const titleEl = createXhtmlElement("span", null, title);
    titleEl.id = "xv-title";
    const metaEl = createXhtmlElement("span", null,
      `${formatByteSize(bytes)} · ${error ? "invalid XML" : `${nodeCount > LARGE_NODES ? LARGE_NODES + "+" : nodeCount} nodes`} · auto (system theme)`);
    metaEl.id = "xv-meta";

    const controls = createXhtmlElement("div");
    controls.id = "xv-controls";
    const search = createXhtmlElement("input") as HTMLInputElement;
    search.id = "xv-search";
    search.setAttribute("type", "search");
    search.setAttribute("placeholder", "Search…");
    const prevBtn = button("xv-prev", "↑");
    const nextBtn = button("xv-next", "↓");
    const countEl = createXhtmlElement("span");
    countEl.id = "xv-count";
    const expandBtn = button("xv-expand", "Expand all");
    const collapseBtn = button("xv-collapse", "Collapse all");
    const rawBtn = button("xv-toggle-raw", "Raw");
    const copyBtn = button("xv-copy-xpath", "Copy XPath");
    copyBtn.disabled = true;
    const themeBtn = button("xv-theme", "Theme: System");
    controls.append(search, prevBtn, nextBtn, countEl, expandBtn, collapseBtn, rawBtn, copyBtn, themeBtn);
    header.append(titleEl, metaEl, controls);

    const banner = createXhtmlElement("div");
    banner.id = "xv-banner";
    if (large && !error) {
      banner.textContent = "Large document: elements below the first level start collapsed and are rendered on demand.";
      banner.style.display = "block";
    }
    const errorBox = createXhtmlElement("div");
    errorBox.id = "xv-error";
    if (error) {
      errorBox.textContent = "Invalid XML: " + error;
      errorBox.style.display = "block";
    }

    const main = createXhtmlElement("div");
    main.id = "xv-main";
    const rawBox = createXhtmlElement("div");
    rawBox.id = "xv-raw";

    const status = createXhtmlElement("div");
    status.id = "xv-status";
    const xpathEl = createXhtmlElement("span", null, "(click a tag)");
    xpathEl.id = "xv-xpath";
    status.append(createXhtmlElement("strong", null, "XPath:"), document.createTextNode(" "), xpathEl);

    if (doc) {
      renderChildren(doc, 0, 1, main);
    }

    function ensureRaw() {
      if (rawBuilt) {
        return;
      }
      rawBuilt = true;
      const frag = document.createDocumentFragment();
      raw.split(/\r\n|\r|\n/).forEach((text, i) => frag.append(makeLine(i + 1, 0, [document.createTextNode(text)])));
      const inner = createXhtmlElement("div");
      inner.append(frag);
      rawBox.append(inner);
    }

    function syncMode() {
      if (rawMode) {
        ensureRaw();
      }
      main.style.display = rawMode ? "none" : "";
      rawBox.style.display = rawMode ? "block" : "none";
      rawBtn.textContent = rawMode ? "Tree" : "Raw";
      rawBtn.disabled = !doc;
      expandBtn.disabled = collapseBtn.disabled = rawMode;
    }

    // ---- selection

    function selectLine(line: HTMLElement) {
      if (selectedLine) {
        selectedLine.classList.remove("selected");
      }
      selectedLine = line;
      line.classList.add("selected");
      const owner = lineOwner.get(line);
      selectedXPath = owner instanceof Element ? xpathFor(owner) : null;
      xpathEl.textContent = selectedXPath || "(no xpath)";
      copyBtn.disabled = !selectedXPath;
      line.scrollIntoView({ block: "nearest" });
    }

    main.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof Element)) {
        return;
      }
      const line = target.closest<HTMLElement>(".xv-line");
      if (!line) {
        return;
      }
      if (target.closest(".xv-toggle, .xv-ellipsis")) {
        const box = line.nextElementSibling;
        if (box instanceof HTMLElement && box.classList.contains("xv-children")) {
          setCollapsed(box, !box.classList.contains("collapsed"));
        }
        return;
      }
      selectLine(line);
    });

    // ---- search

    function textSegments(code: HTMLElement): { node: Text; start: number; end: number }[] {
      const segs: { node: Text; start: number; end: number }[] = [];
      let pos = 0;
      const w = document.createTreeWalker(code, NodeFilter.SHOW_TEXT, {
        acceptNode: (t) => ((t.parentElement?.closest(".xv-indent, .xv-toggle, .xv-ellipsis"))
          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      for (let t = w.nextNode(); t; t = w.nextNode()) {
        const text = t as Text;
        segs.push({ node: text, start: pos, end: pos + text.data.length });
        pos += text.data.length;
      }
      return segs;
    }

    function wrapText(node: Text, a: number, b: number): HTMLElement {
      let t = node;
      if (a > 0) {
        t = t.splitText(a);
      }
      if (b - a < t.data.length) {
        t.splitText(b - a);
      }
      const m = createXhtmlElement("mark");
      t.parentNode!.replaceChild(m, t);
      m.append(t);
      return m;
    }

    function clearMarks() {
      const parents = new Set<Node>();
      for (const group of matches) {
        for (const m of group) {
          const p = m.parentNode;
          if (!p) {
            continue;
          }
          while (m.firstChild) {
            p.insertBefore(m.firstChild, m);
          }
          m.remove();
          parents.add(p);
        }
      }
      for (const p of parents) {
        p.normalize();
      }
      matches = [];
      matchIdx = -1;
      capped = false;
    }

    function updateCount() {
      if (!search.value.trim()) {
        countEl.textContent = "";
      } else if (!matches.length) {
        countEl.textContent = "no matches";
      } else {
        countEl.textContent = `${matchIdx + 1}/${matches.length}${capped ? "+" : ""}`;
      }
    }

    function doSearch() {
      clearMarks();
      const q = search.value.trim();
      if (q) {
        const view = rawMode ? rawBox : main;
        if (!rawMode) {
          materializeAll();
        }
        const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
        outer:
        for (const code of view.querySelectorAll<HTMLElement>(".xv-code")) {
          const segs = textSegments(code);
          if (!segs.length) {
            continue;
          }
          const text = segs.map((s) => s.node.data).join("");
          const found: [number, number][] = [];
          re.lastIndex = 0;
          for (let m = re.exec(text); m; m = re.exec(text)) {
            if (matches.length + found.length >= MAX_MATCHES) {
              capped = true;
              break;
            }
            found.push([m.index, m.index + m[0].length]);
          }
          // Wrap back-to-front so earlier offsets stay valid after splitText().
          const groups: HTMLElement[][] = [];
          for (let i = found.length - 1; i >= 0; i--) {
            const [s, e] = found[i];
            const group: HTMLElement[] = [];
            for (let j = segs.length - 1; j >= 0; j--) {
              const seg = segs[j];
              if (seg.end <= s || seg.start >= e) {
                continue;
              }
              group.unshift(wrapText(seg.node, Math.max(s, seg.start) - seg.start, Math.min(e, seg.end) - seg.start));
            }
            groups.unshift(group);
          }
          matches.push(...groups);
          if (capped) {
            break outer;
          }
        }
        if (matches.length) {
          setCurrent(0);
          return;
        }
      }
      updateCount();
    }

    function setCurrent(i: number) {
      if (matchIdx >= 0) {
        for (const m of matches[matchIdx]) {
          m.classList.remove("current");
        }
      }
      matchIdx = i;
      const group = matches[i];
      for (const m of group) {
        m.classList.add("current");
      }
      for (let box = group[0].closest<HTMLElement>(".xv-children.collapsed"); box; box = box.parentElement?.closest<HTMLElement>(".xv-children.collapsed") ?? null) {
        setCollapsed(box, false);
      }
      group[0].scrollIntoView({ block: "center" });
      updateCount();
    }

    function stepMatch(d: number) {
      if (!matches.length) {
        return;
      }
      setCurrent((matchIdx + d + matches.length) % matches.length);
    }

    let searchTimer = 0;
    search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { searchTimer = 0; doSearch(); }, 200);
    });
    search.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") {
        return;
      }
      e.preventDefault();
      if (searchTimer) {
        clearTimeout(searchTimer);
        searchTimer = 0;
        doSearch();
        return;
      }
      stepMatch(e.shiftKey ? -1 : 1);
    });
    prevBtn.addEventListener("click", () => stepMatch(-1));
    nextBtn.addEventListener("click", () => stepMatch(1));

    // ---- toolbar

    expandBtn.addEventListener("click", () => {
      collapseDepth = Infinity;
      materializeAll();
      for (const box of main.querySelectorAll<HTMLElement>(".xv-children")) {
        setCollapsed(box, false);
      }
    });
    collapseBtn.addEventListener("click", () => {
      collapseDepth = 0;
      for (const box of main.querySelectorAll<HTMLElement>(".xv-children")) {
        setCollapsed(box, true);
      }
    });
    rawBtn.addEventListener("click", () => {
      rawMode = !rawMode;
      syncMode();
      if (search.value.trim()) {
        doSearch();
      }
    });
    copyBtn.addEventListener("click", () => {
      if (!selectedXPath) {
        return;
      }
      navigator.clipboard.writeText(selectedXPath).then(() => {
        copyBtn.textContent = "Copied";
        setTimeout(() => { copyBtn.textContent = "Copy XPath"; }, 1200);
      }, (err) => {
        console.warn("[XML Viewer] clipboard write failed:", err);
      });
    });

    function applyTheme(t: unknown) {
      theme = typeof t === "string" && THEMES.includes(t as Theme) ? t as Theme : "system";
      if (theme === "system") {
        document.documentElement.removeAttribute("data-theme");
      } else {
        document.documentElement.setAttribute("data-theme", theme);
      }
      themeBtn.textContent = `Theme: ${THEME_LABELS[theme]}`;
      themeBtn.title = theme === "system" ? "Theme: follow system (click to change)" : `Theme: forced ${theme} (click to change)`;
    }
    const storage = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
    themeBtn.addEventListener("click", () => {
      applyTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]);
      if (!storage) {
        return;
      }
      try {
        storage.set({ [THEME_KEY]: theme }, () => {
          if (chrome.runtime.lastError) {
            console.warn("[XML Viewer] theme not saved:", chrome.runtime.lastError.message);
          }
        });
      } catch (err) {
        console.warn("[XML Viewer] theme not saved:", err);
      }
    });

    syncMode();

    // Called only after the viewer has been mounted (the root element may have been replaced).
    function afterMount() {
      applyTheme("system");
      if (!storage) {
        return;
      }
      try {
        storage.get(THEME_KEY, (r) => {
          if (!chrome.runtime.lastError && r) {
            applyTheme(r[THEME_KEY]);
          }
        });
      } catch {
        /* extension context invalidated */
      }
    }

    return { bodyNodes: [header, banner, errorBox, main, rawBox, status], afterMount };
  }

  function mount(bodyNodes: HTMLElement[]) {
    const name = location.pathname.split("/").filter(Boolean).pop() || location.host || "XML";
    const headNodes = [createXhtmlElement("title", null, `${name} — XML Viewer`)];
    const meta = createXhtmlElement("meta");
    meta.setAttribute("charset", "utf-8");
    headNodes.unshift(meta);
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) {
      const link = createXhtmlElement("link");
      link.setAttribute("rel", "stylesheet");
      link.setAttribute("href", chrome.runtime.getURL("viewer.css"));
      headNodes.push(link);
    }

    const head = document.head, body = document.body;
    if (head && body) {
      for (const a of Array.from(body.attributes)) {
        body.removeAttribute(a.name);
      }
      head.replaceChildren(...headNodes);
      body.replaceChildren(...bodyNodes);
    } else {
      // Plain XMLDocument without the native viewer: swap in an XHTML root.
      const html = createXhtmlElement("html"), newHead = createXhtmlElement("head"), newBody = createXhtmlElement("body");
      newHead.append(...headNodes);
      newBody.append(...bodyNodes);
      html.append(newHead, newBody);
      for (const n of Array.from(document.childNodes)) {
        if (n !== document.documentElement) {
          n.remove();
        }
      }
      document.replaceChild(html, document.documentElement);
    }
    document.title = `${name} — XML Viewer`;
  }

  function boot() {
    const kind = candidateKind();
    if (!kind) {
      return;
    }
    const de = document.documentElement;
    const isHtmlDoc = !!de && de.namespaceURI === XHTML_NS && de.localName === "html";
    if (isHtmlDoc && !isNativeXmlViewer() && !bodyLooksLikeXml()) {
      return; // real HTML (e.g. XSLT output)
    }
    if (hasStylesheetPI(document)) {
      return; // respect the document's own stylesheet
    }

    const { raw, error: nativeError } = readLoadedXmlSource();
    if (raw == null || !raw.trim()) {
      return;
    }
    const parsed = nativeError ? { doc: null, error: nativeError } : parseXml(raw);
    if (kind === "sniffed" && parsed.error) {
      return;
    }
    if (parsed.doc && hasStylesheetPI(parsed.doc)) {
      return;
    }

    // Build everything detached first, so a failure leaves the page untouched.
    const viewer = buildViewer({ raw, doc: parsed.doc, error: parsed.error });
    mount(viewer.bodyNodes);
    viewer.afterMount();
  }

  function start() {
    try {
      boot();
    } catch (err) {
      console.warn("[XML Viewer] not rendered:", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
