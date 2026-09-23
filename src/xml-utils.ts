const XML_EXT = /\.(xml|xsl|rss|atom|wsdl|xsd|plist|svg|config|kml|gpx|opml)(\?.*)?$/i;

export function hasXmlExtension(url: string): boolean {
  return XML_EXT.test(url.split("#")[0]);
}

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) {
    return bytes + " B";
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + " KB";
  }
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}
