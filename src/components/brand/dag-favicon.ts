/** Inline favicon SVG (data URI) using the DAG glyph, tinted by network color. */
export function dagFaviconHref(color: string): string {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">`,
    `<rect width="32" height="32" rx="7" fill="#09090b"/>`,
    `<g fill="none" stroke="${color}" stroke-linecap="round">`,
    `<path d="M10 14.75 L16 19.5" stroke-width="1.4" opacity="0.5"/>`,
    `<path d="M22 14.75 L16 19.5" stroke-width="2.2"/>`,
    `</g>`,
    `<g fill="${color}">`,
    `<rect x="6.5" y="7.5" width="7" height="7" rx="1.2" transform="rotate(45 10 11)" opacity="0.6"/>`,
    `<rect x="18.5" y="7.5" width="7" height="7" rx="1.2" transform="rotate(45 22 11)"/>`,
    `<rect x="12.5" y="19.5" width="7" height="7" rx="1.2" transform="rotate(45 16 23)"/>`,
    `</g>`,
    `</svg>`,
  ].join("");
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
