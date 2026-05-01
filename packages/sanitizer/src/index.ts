// PAI-0025: shared sanitizer allowlist used by both the server (`sanitize-html`,
// in workers/basepress-api) and the client (`DOMPurify`, in apps/web). Drift
// between the two layers means stored HTML can render differently than what
// was sanitized — fix it by sourcing the allowlist from one place.
//
// Adapter notes:
// - sanitize-html: pass `allowedTags`, `allowedAttributes`, `allowedSchemes`.
// - DOMPurify: pass `ALLOWED_TAGS`, `ALLOWED_ATTR`, `ALLOWED_URI_REGEXP`.

export const ALLOWED_TAGS: readonly string[] = [
  'p', 'br', 'strong', 'em', 'u', 's', 'del', 'code', 'pre',
  'blockquote', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4',
  'a', 'img', 'hr', 'mark', 'span',
];

// Per-tag attribute allowlist (sanitize-html shape). Wildcards are listed under
// the special key `*` which both adapters apply globally.
export const ALLOWED_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  '*': ['style', 'data-color'],
  a: ['href', 'target', 'rel', 'title'],
  img: ['src', 'alt', 'width', 'height', 'title'],
  mark: ['data-color'],
  span: [],
  p: [],
  h1: [], h2: [], h3: [], h4: [],
};

// Flat union of every attribute the allowlist permits — DOMPurify uses a flat
// list (`ALLOWED_ATTR`) rather than per-tag rules.
export const ALLOWED_ATTRIBUTES_FLAT: readonly string[] = Array.from(
  new Set(Object.values(ALLOWED_ATTRIBUTES).flatMap((arr) => Array.from(arr))),
);

export const ALLOWED_SCHEMES: readonly string[] = ['https', 'mailto', 'ipfs'];

// DOMPurify expects this as a regexp.
export const ALLOWED_URI_REGEXP = /^(https?:|mailto:|ipfs:)/i;

// CSS allowlist passed to sanitize-html. DOMPurify does not consume this
// directly, but inline styles end up filtered through the adapter on render.
export const ALLOWED_STYLES: Readonly<Record<string, Readonly<Record<string, readonly RegExp[]>>>> = {
  '*': { 'text-align': [/^left$/, /^center$/, /^right$/] },
  mark: { 'background-color': [/.*/] },
  span: { color: [/.*/] },
};
