import DOMPurify from 'isomorphic-dompurify';
import {
  ALLOWED_TAGS,
  ALLOWED_ATTRIBUTES_FLAT,
  ALLOWED_URI_REGEXP,
  filterStyleString,
} from '@basepress/sanitizer';

let hookInstalled = false;
function ensureHook() {
  if (hookInstalled) return;
  // PAI-0024: enforce rel="noopener noreferrer" on every target=_blank link.
  // P001-PAI-0037: restrict inline style CSS properties to server allowlist.
  DOMPurify.addHook('afterSanitizeAttributes', (node: Element) => {
    // P001-PAI-0037: filter inline styles against ALLOWED_STYLES allowlist
    if (node.hasAttribute('style')) {
      const filtered = filterStyleString(node.tagName, node.getAttribute('style') ?? '');
      if (filtered) {
        node.setAttribute('style', filtered);
      } else {
        node.removeAttribute('style');
      }
    }

    if (node.tagName !== 'A') return;
    if (node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer');
    } else if (node.hasAttribute('rel')) {
      const rel = node.getAttribute('rel') ?? '';
      const tokens = new Set(rel.split(/\s+/).filter(Boolean));
      if (tokens.has('noopener') || tokens.has('noreferrer')) {
        tokens.add('noopener');
        tokens.add('noreferrer');
        node.setAttribute('rel', Array.from(tokens).join(' '));
      }
    }
  });
  hookInstalled = true;
}

// PAI-0025: allowlist sourced from @basepress/sanitizer so server and client
// strip the same tags/attributes/URI schemes.
export function sanitizeHtml(dirty: string): string {
  ensureHook();
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: Array.from(ALLOWED_TAGS),
    ALLOWED_ATTR: Array.from(ALLOWED_ATTRIBUTES_FLAT),
    ALLOWED_URI_REGEXP,
  });
}
