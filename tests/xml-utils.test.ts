import { describe, expect, it } from "vitest";
import { formatByteSize, hasXmlExtension } from "../src/xml-utils";

describe("hasXmlExtension", () => {
  it.each(["https://example.com/data.xml", "https://example.com/feed.RSS", "file:///tmp/config.xml?download=1", "https://example.com/file.svg#fragment"])("recognizes XML-like URL: %s", (url) => {
    expect(hasXmlExtension(url)).toBe(true);
  });

  it.each(["https://example.com/data.json", "https://example.com/xml", "https://example.com/page.html#file.xml"])("rejects non-XML URL: %s", (url) => {
    expect(hasXmlExtension(url)).toBe(false);
  });
});

describe("formatByteSize", () => {
  it.each([
    [512, "512 B"],
    [2048, "2.0 KB"],
    [2 * 1024 * 1024, "2.00 MB"],
  ])("formats %i bytes", (bytes, expected) => {
    expect(formatByteSize(bytes)).toBe(expected);
  });
});
