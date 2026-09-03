/**
 * HTML sanitisation for incoming articles.
 *
 * The webhook is HMAC-signed, so the sender is authenticated. That is not the
 * same as the content being safe: the article body is authored upstream, often
 * by a generator, and it is rendered into our origin with
 * `dangerouslySetInnerHTML`. A single `<script>` or `onerror=` reaching the
 * page would run with the privileges of the site, so the body is filtered to
 * an allowlist before it is ever stored.
 *
 * Filtering happens on write rather than on read: the stored row is then safe
 * by construction, and no future rendering path can forget to sanitise.
 */

import sanitizeHtml from 'sanitize-html'

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr', 'blockquote', 'pre', 'code',
    'ul', 'ol', 'li',
    'strong', 'b', 'em', 'i', 'u', 's', 'mark', 'sup', 'sub',
    'a', 'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
    'span', 'div',
  ],

  allowedAttributes: {
    // target and rel are added by transformTags below, so they have to be
    // allowed here or the allowlist would strip them straight back off.
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    th: ['colspan', 'rowspan', 'scope'],
    td: ['colspan', 'rowspan'],
    code: ['class'],
    span: ['class'],
    div: ['class'],
  },

  // Anything not listed here (javascript:, data:, vbscript:) is dropped.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,

  // Style attributes are a known XSS surface and the design system already
  // governs typography, so inline styles are discarded entirely.
  allowedStyles: {},

  transformTags: {
    // Outbound links open in a new tab and cannot reach back into this
    // window via `window.opener`.
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' },
    }),
    // The page supplies its own <h1>, so a body heading would produce two.
    h1: 'h2',
    img: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, loading: 'lazy' },
    }),
  },

  // Drop the content of anything removed, rather than leaking script source
  // as visible text.
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'iframe'],
}

export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS)
}

/** Plain text, used for excerpts and reading time. */
export function htmlToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim()
}

/** Average adult reading speed, rounded up to at least a minute. */
const WORDS_PER_MINUTE = 220

export function readingMinutes(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE))
}

/**
 * URL-safe slug.
 *
 * Used only when the payload does not carry one; the sender's slug is
 * preferred so links stay stable on their side.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    // Strip diacritics so "événement" becomes "evenement" rather than losing
    // the letters entirely.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}
