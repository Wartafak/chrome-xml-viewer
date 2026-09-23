// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const XHTML = "http://www.w3.org/1999/xhtml";
const fixture = '<root id="one"><item>hello world</item><item>hello again</item><empty/><mixed>before<b>bold</b>after</mixed><!-- note --><![CDATA[raw]]><?task go?></root>';

async function load(html = "", url = "https://example.com/data.xml", contentType = "text/html") {
  window.history.replaceState(null, "", url);
  document.open();
  document.write(html);
  document.close();
  Object.defineProperty(document, "contentType", { configurable: true, value: contentType });
  vi.resetModules();
  await import("../src/content");
  document.dispatchEvent(new Event("DOMContentLoaded"));
}

function plain(xml: string) {
  return `<pre>${xml.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`;
}

function click(selector: string) {
  const el = document.querySelector<HTMLElement>(selector);
  expect(el, selector).not.toBeNull();
  el!.click();
}

function lines() {
  return Array.from(document.querySelectorAll<HTMLElement>("#xv-main .xv-line"));
}

function invalidParserResult(message = "bad XML") {
  const parse = DOMParser.prototype.parseFromString;
  vi.spyOn(DOMParser.prototype, "parseFromString").mockImplementation(function (this: DOMParser, source, type) {
    if (source === "<broken>" || source === "<root>") {
      return parse.call(this, `<parsererror xmlns="${XHTML}"><div>${message}</div></parsererror>`, type);
    }
    return parse.call(this, source, type);
  });
}

beforeEach(() => {
  vi.stubGlobal("chrome", undefined);
  // jsdom doesn't implement scrolling; keep the rest of the DOM interactions real.
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
});

describe("content script takeover", () => {
  it.each([
    ["application/json", "https://example.com/data.json", plain(fixture)],
    ["image/svg+xml", "https://example.com/icon.svg", plain(fixture)],
    ["application/xhtml+xml", "https://example.com/data.xml", plain(fixture)],
    ["text/html", "https://example.com/data.xml", "<h1>Rendered by XSLT</h1>"],
    ["text/plain", "https://example.com/feed", plain("ordinary text")],
  ])("leaves unrelated content alone (%s, %s)", async (type, url, html) => {
    await load(html, url, type);
    expect(document.querySelector("#xv-header")).toBeNull();
    expect(document.body.textContent).toBe(new DOMParser().parseFromString(html, "text/html").body.textContent);
  });

  it("sniffs valid plain text XML without an extension, but does not take over invalid XML", async () => {
    await load(plain("<root/>"), "https://example.com/feed", "text/plain");
    expect(lines().map((l) => l.textContent)).toContain("1<root/>");
    invalidParserResult();
    await load(plain("<root>"), "https://example.com/feed", "text/plain");
    expect(document.querySelector("#xv-header")).toBeNull();
  });

  it("shows a parse error and raw source for declared invalid XML", async () => {
    invalidParserResult("unexpected end");
    await load(plain("<broken>"));
    expect(document.querySelector("#xv-error")?.textContent).toContain("unexpected end");
    expect(document.querySelector<HTMLElement>("#xv-raw")?.style.display).toBe("block");
    expect(document.querySelector("#xv-raw .xv-code")?.textContent).toBe("<broken>");
    expect(document.querySelector<HTMLButtonElement>("#xv-toggle-raw")?.disabled).toBe(true);
  });

  it("does not take over an XML document with its own stylesheet PI", async () => {
    await load(plain('<?xml version="1.0"?><?xml-stylesheet href="style.xsl"?><root/>'));
    expect(document.querySelector("#xv-header")).toBeNull();
  });

  it("renders a native XML document with XHTML viewer nodes without re-fetching", async () => {
    // jsdom supports XMLDocument through DOMParser, unlike document.write on an HTML page.
    const xml = new DOMParser().parseFromString('<?xml version="1.0"?><!DOCTYPE root><root><item>hello</item></root>', "application/xml");
    const warning = vi.spyOn(console, "warn");
    vi.stubGlobal("document", xml);
    // jsdom aliases HTMLDocument to Document, including for parsed XML documents.
    vi.stubGlobal("HTMLDocument", class HTMLDocument {});
    vi.resetModules();
    await import("../src/content");
    xml.dispatchEvent(new Event("DOMContentLoaded"));
    expect(warning).not.toHaveBeenCalled();
    expect(xml.querySelector("#xv-header")?.namespaceURI).toBe(XHTML);
    expect(xml.querySelector("#xv-main")?.textContent).toContain("hello");
    expect(xml.querySelector(".tk-doctype")?.textContent).toBe("<!DOCTYPE root>");
    expect(xml.documentElement.localName).toBe("html");
  });

  it("reads the browser's native viewer source rather than its surrounding HTML", async () => {
    await load(`<div id="webkit-xml-viewer-source-xml"><root><item>native</item></root></div><h1>browser chrome</h1>`, "https://example.com/feed", "text/html");
    expect(document.querySelector("#xv-main")?.textContent).toContain("native");
    expect(document.querySelector("#xv-main")?.textContent).not.toContain("browser chrome");
    expect(document.querySelector("#xv-error")?.textContent).toBe("");
  });

  it("preserves a declared XML page when its source is empty", async () => {
    await load("<pre>   </pre>");
    expect(document.querySelector("#xv-header")).toBeNull();
  });
});

describe("viewer controls", () => {
  beforeEach(async () => { await load(plain(fixture)); });

  it("renders numbered, syntax-highlighted lines and metadata without interpreting XML markup", () => {
    expect(lines().map((l) => l.dataset.line)).toEqual(Array.from({ length: 13 }, (_, i) => String(i + 1)));
    expect(document.querySelectorAll("#xv-main .tk-tag").length).toBeGreaterThan(0);
    expect(document.querySelector("#xv-main .tk-attr")?.textContent).toBe("id");
    expect(document.querySelector("#xv-main .tk-val")?.textContent).toBe("one");
    expect(document.querySelector("#xv-main .tk-cdata")?.textContent).toBe("<![CDATA[raw]]>");
    expect(document.querySelector("#xv-main .tk-comment")?.textContent).toBe("<!-- note -->");
    expect(document.querySelector("#xv-main .tk-pi")?.textContent).toBe("<?task go?>");
    expect(document.querySelector("#xv-meta")?.textContent).toContain("6 nodes");
    expect(document.querySelector("#xv-main item")).toBeNull();
  });

  it("renders escaped values while skipping indentation-only text", async () => {
    await load(plain('<root attr="a &amp; b">\n  <item>hello</item>\n</root>'));
    expect(document.querySelector(".tk-val")?.textContent).toBe("a & b");
    expect(document.querySelector(".tk-text")?.textContent).toBe("hello");
    expect(lines().map((line) => line.dataset.line)).toEqual(["1", "2", "3"]);
  });

  it("collapses, expands and lazily renders child lines while retaining stable line numbers", () => {
    click("#xv-collapse");
    expect(document.querySelectorAll("#xv-main .xv-children.collapsed").length).toBeGreaterThan(0);
    click("#xv-expand");
    expect(document.querySelectorAll("#xv-main .xv-children.collapsed")).toHaveLength(0);
    click("#xv-main .xv-toggle");
    expect(document.querySelector("#xv-main .xv-children.collapsed")).not.toBeNull();
    click("#xv-main .xv-ellipsis");
    expect(document.querySelector("#xv-main .xv-children.collapsed")).toBeNull();
  });

  it("selects an element's namespace-aware indexed XPath and copies it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const item = lines().filter((line) => line.textContent?.includes("<item>"))[1];
    item.querySelector<HTMLElement>(".tk-tag")!.click();
    expect(document.querySelector("#xv-xpath")?.textContent).toBe("/root/item[2]");
    expect(document.querySelector<HTMLButtonElement>("#xv-copy-xpath")?.disabled).toBe(false);
    click("#xv-copy-xpath");
    expect(writeText).toHaveBeenCalledWith("/root/item[2]");
    await vi.waitFor(() => expect(document.querySelector("#xv-copy-xpath")?.textContent).toBe("Copied"));
  });

  it("searches across syntax token boundaries, navigates matches and clears highlights", () => {
    vi.useFakeTimers();
    const input = document.querySelector<HTMLInputElement>("#xv-search")!;
    input.value = "hello";
    input.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(200);
    expect(document.querySelector("#xv-count")?.textContent).toBe("1/2");
    click("#xv-next");
    expect(document.querySelector("#xv-count")?.textContent).toBe("2/2");
    click("#xv-next");
    expect(document.querySelector("#xv-count")?.textContent).toBe("1/2");
    input.value = "<item>hello";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(document.querySelector("#xv-count")?.textContent).toBe("1/2");
    expect(document.querySelectorAll("#xv-main mark").length).toBeGreaterThan(2);
    input.value = "missing";
    input.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(200);
    expect(document.querySelector("#xv-count")?.textContent).toBe("no matches");
    expect(document.querySelectorAll("mark")).toHaveLength(0);
  });

  it("toggles raw mode, searches raw lines and returns to the tree", () => {
    vi.useFakeTimers();
    click("#xv-toggle-raw");
    expect(document.querySelector<HTMLElement>("#xv-main")?.style.display).toBe("none");
    expect(document.querySelector("#xv-raw .xv-code")?.textContent).toBe(fixture);
    expect(document.querySelector<HTMLButtonElement>("#xv-expand")?.disabled).toBe(true);
    const input = document.querySelector<HTMLInputElement>("#xv-search")!;
    input.value = "hello";
    input.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(200);
    expect(document.querySelector("#xv-count")?.textContent).toBe("1/2");
    expect(document.querySelectorAll("#xv-raw mark")).toHaveLength(2);
    click("#xv-toggle-raw");
    expect(document.querySelector<HTMLElement>("#xv-main")?.style.display).toBe("");
    expect(document.querySelectorAll("#xv-raw mark")).toHaveLength(0);
    expect(document.querySelectorAll("#xv-main mark")).toHaveLength(2);
  });

  it("cycles themes without extension storage", () => {
    click("#xv-theme");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    click("#xv-theme");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    click("#xv-theme");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("treats a sole CDATA section as a separate line, not compact element text", async () => {
    await load(plain("<root><![CDATA[raw]]></root>"));
    expect(lines().map((line) => line.dataset.line)).toEqual(["1", "2", "3"]);
    expect(document.querySelector(".tk-cdata")?.textContent).toBe("<![CDATA[raw]]>");
  });

  it("defers deep branches in large documents and materializes them on expansion", async () => {
    await load(plain(`<root><branch><leaf>${"x".repeat(1.6 * 1024 * 1024)}</leaf></branch></root>`));
    expect(document.querySelector<HTMLElement>("#xv-banner")?.style.display).toBe("block");
    expect(document.querySelector("#xv-main .xv-children.collapsed")).not.toBeNull();
    expect(document.querySelector("#xv-main .tk-text")).toBeNull();
    click("#xv-expand");
    expect(document.querySelectorAll("#xv-main .xv-children.collapsed")).toHaveLength(0);
    expect(document.querySelector("#xv-main .tk-text")?.textContent?.length).toBeGreaterThan(1.5 * 1024 * 1024);
    expect(lines().map((line) => line.dataset.line)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("constructs namespace-aware XPath segments for repeated names", async () => {
    await load(plain('<root xmlns="urn:one" xmlns:other="urn:two"><item/><item/><other:item/></root>'));
    const items = lines().filter((line) => line.textContent?.includes("<item"));
    items[1].click();
    expect(document.querySelector("#xv-xpath")?.textContent).toBe("/*[local-name()='root' and namespace-uri()='urn:one']/*[local-name()='item' and namespace-uri()='urn:one'][2]");
    lines().find((line) => line.textContent?.includes("<other:item"))!.click();
    expect(document.querySelector("#xv-xpath")?.textContent).toContain("namespace-uri()='urn:two'");
  });

  it("does not match search terms that only occur in the collapsed summary", () => {
    vi.useFakeTimers();
    const input = document.querySelector<HTMLInputElement>("#xv-search")!;
    input.value = "…";
    input.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(200);
    expect(document.querySelector("#xv-count")?.textContent).toBe("no matches");
  });

  it("reveals a matching node inside a collapsed branch", async () => {
    await load(plain("<root><branch><nested><leaf>needle</leaf></nested></branch></root>"));
    click("#xv-collapse");
    vi.useFakeTimers();
    const input = document.querySelector<HTMLInputElement>("#xv-search")!;
    input.value = "needle";
    input.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(200);
    expect(document.querySelector("#xv-count")?.textContent).toBe("1/1");
    expect(document.querySelectorAll("#xv-main .xv-children.collapsed mark.current")).toHaveLength(0);
    expect(document.querySelectorAll("#xv-main mark.current")).toHaveLength(1);
  });

  it("limits highlights to 1000 results and reports that more were found", async () => {
    await load(plain(`<root>${"a".repeat(1002)}</root>`));
    vi.useFakeTimers();
    const input = document.querySelector<HTMLInputElement>("#xv-search")!;
    input.value = "a";
    input.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(200);
    expect(document.querySelector("#xv-count")?.textContent).toBe("1/1000+");
    expect(document.querySelectorAll("#xv-main mark")).toHaveLength(1000);
  });

  it("loads a saved theme, validates unknown values, and persists theme changes", async () => {
    const get = vi.fn((_key: string, callback: (value: { xvTheme: string }) => void) => callback({ xvTheme: "dark" }));
    const set = vi.fn();
    vi.stubGlobal("chrome", { storage: { local: { get, set } }, runtime: { lastError: null, getURL: (path: string) => `chrome-extension://id/${path}` } });
    await load(plain(fixture));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.querySelector("link[rel=stylesheet]")?.getAttribute("href")).toBe("chrome-extension://id/viewer.css");
    click("#xv-theme");
    expect(set).toHaveBeenCalledWith({ xvTheme: "system" }, expect.any(Function));
    get.mockImplementationOnce((_key, callback) => callback({ xvTheme: "unexpected" }));
    await load(plain(fixture));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
