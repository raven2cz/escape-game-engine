/**
 * @fileoverview Lightweight Markdown-to-HTML renderer for the escape-game-engine.
 *
 * Converts a safe subset of Markdown into sanitized HTML suitable for
 * content panels, room descriptions, and narrative overlays.
 *
 * Supported syntax:
 * - Headings:       # H1, ## H2, ### H3
 * - Bold:           **text**
 * - Italic:         *text*
 * - Bold+Italic:    ***text***
 * - Inline code:    `code`
 * - Images:         ![alt](src)
 * - Unordered list: - item  /  * item
 * - Ordered list:   1. item
 * - Blockquotes:    > text
 * - Horizontal rule: ---
 * - Paragraphs:     blank-line separated
 * - Line breaks:    trailing two spaces or \n within paragraph
 *
 * @module content-renderer
 */

/* ------------------------------------------------------------------ */
/*  HTML sanitisation helpers                                         */
/* ------------------------------------------------------------------ */

/**
 * Set of HTML tags considered safe for rendered content.
 * Any tag not in this set will be escaped during sanitisation.
 *
 * @type {Set<string>}
 */
const SAFE_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr',
  'strong', 'em', 'code',
  'ul', 'ol', 'li',
  'blockquote',
  'img',
  'a',
]);

/**
 * Mapping of tag names to their allowed attribute names.
 *
 * @type {Record<string, string[]>}
 */
const SAFE_ATTRS = {
  img: ['src', 'alt', 'title', 'width', 'height'],
  a:   ['href', 'title'],
};

/**
 * Escape special HTML characters to prevent injection.
 *
 * @param {string} str - Raw string.
 * @returns {string} Escaped string safe for innerHTML.
 */
export function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Strip disallowed HTML tags and attributes from an HTML string.
 *
 * Allowed tags are kept as-is; everything else is entity-escaped.
 * Within allowed tags only whitelisted attributes are retained.
 *
 * @param {string} html - Untrusted HTML string.
 * @returns {string} Sanitised HTML.
 */
export function sanitizeHtml(html) {
  // Replace tags: keep safe ones (with filtered attrs), escape the rest.
  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (match, tag, attrs) => {
    const lower = tag.toLowerCase();
    if (!SAFE_TAGS.has(lower)) return escapeHtml(match);

    const isClosing = match.startsWith('</');
    if (isClosing) return `</${lower}>`;

    const allowed = SAFE_ATTRS[lower] || [];
    const cleanAttrs = [];
    const attrRe = /([a-zA-Z][a-zA-Z0-9-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
    let m;
    while ((m = attrRe.exec(attrs)) !== null) {
      const name = m[1].toLowerCase();
      const value = m[2] ?? m[3] ?? m[4] ?? '';
      if (allowed.includes(name)) {
        // Block javascript: URIs
        if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(value)) continue;
        cleanAttrs.push(`${name}="${escapeHtml(value)}"`);
      }
    }

    const isSelfClosing = lower === 'img' || lower === 'br' || lower === 'hr';
    const attrStr = cleanAttrs.length ? ' ' + cleanAttrs.join(' ') : '';
    return isSelfClosing ? `<${lower}${attrStr}>` : `<${lower}${attrStr}>`;
  });
}

/* ------------------------------------------------------------------ */
/*  Markdown tokeniser                                                */
/* ------------------------------------------------------------------ */

/**
 * @typedef {'heading'|'paragraph'|'list'|'blockquote'|'hr'|'blank'} BlockType
 */

/**
 * @typedef {Object} Block
 * @property {BlockType} type
 * @property {number}    [level]      - Heading level (1-3) or list nesting.
 * @property {boolean}   [ordered]    - True for ordered lists.
 * @property {string}    [raw]        - Raw text content of the block.
 * @property {string[]}  [items]      - List item strings.
 */

/**
 * Parse a Markdown string into an array of block-level tokens.
 *
 * @param {string} md - Markdown source.
 * @returns {Block[]} Ordered list of block tokens.
 */
export function tokenize(md) {
  const lines = md.split('\n');
  /** @type {Block[]} */
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Horizontal rule (--- or ___ or ***)
    if (/^(\s*[-*_]\s*){3,}$/.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Heading: # H1 .. ### H3
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        raw: headingMatch[2].trim(),
      });
      i++;
      continue;
    }

    // Unordered list: - item  or  * item (but not **bold**)
    if (/^[\t ]*[-*]\s+/.test(line) && !/^\*\*/.test(line.trim())) {
      const items = [];
      while (i < lines.length && /^[\t ]*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[\t ]*[-*]\s+/, '').trim());
        i++;
      }
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }

    // Ordered list: 1. item
    if (/^[\t ]*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[\t ]*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[\t ]*\d+\.\s+/, '').trim());
        i++;
      }
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }

    // Blockquote: > text
    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', raw: quoteLines.join('\n') });
      continue;
    }

    // Paragraph: collect consecutive non-empty, non-special lines
    {
      const paraLines = [];
      while (
        i < lines.length &&
        !/^\s*$/.test(lines[i]) &&
        !/^#{1,3}\s/.test(lines[i]) &&
        !/^(\s*[-*_]\s*){3,}$/.test(lines[i]) &&
        !/^>\s?/.test(lines[i]) &&
        !(/^[\t ]*[-*]\s+/.test(lines[i]) && !/^\*\*/.test(lines[i].trim())) &&
        !/^[\t ]*\d+\.\s+/.test(lines[i])
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      if (paraLines.length) {
        blocks.push({ type: 'paragraph', raw: paraLines.join('\n') });
      }
    }
  }

  return blocks;
}

/* ------------------------------------------------------------------ */
/*  Inline formatting                                                 */
/* ------------------------------------------------------------------ */

/**
 * Render inline Markdown formatting to HTML.
 *
 * Handles: bold+italic, bold, italic, inline code, images, links.
 *
 * @param {string} text - Inline Markdown text.
 * @returns {string} HTML string.
 */
export function renderInline(text) {
  let html = escapeHtml(text);

  // Images: ![alt](src)  — must come before links
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`;
  });

  // Links: [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    if (/^\s*javascript:/i.test(href)) return escapeHtml(label);
    return `<a href="${escapeHtml(href)}">${label}</a>`;
  });

  // Inline code: `code` — escape early so code content is not further processed
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    return `<code>${code}</code>`;
  });

  // Bold + Italic: ***text***
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');

  // Bold: **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic: *text*  (but not within words like file*name)
  html = html.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, '<em>$1</em>');

  // Line break: two trailing spaces or explicit \n
  html = html.replace(/ {2,}\n/g, '<br>');

  return html;
}

/* ------------------------------------------------------------------ */
/*  Block rendering                                                   */
/* ------------------------------------------------------------------ */

/**
 * Render an array of block tokens into an HTML string.
 *
 * @param {Block[]} blocks - Tokenised block array.
 * @returns {string} Complete HTML output.
 */
export function renderBlocks(blocks) {
  return blocks.map(block => {
    switch (block.type) {
      case 'heading':
        return `<h${block.level}>${renderInline(block.raw)}</h${block.level}>`;

      case 'paragraph':
        return `<p>${renderInline(block.raw)}</p>`;

      case 'list': {
        const tag = block.ordered ? 'ol' : 'ul';
        const items = block.items
          .map(item => `<li>${renderInline(item)}</li>`)
          .join('');
        return `<${tag}>${items}</${tag}>`;
      }

      case 'blockquote':
        return `<blockquote>${renderInline(block.raw)}</blockquote>`;

      case 'hr':
        return '<hr>';

      default:
        return '';
    }
  }).join('\n');
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

/**
 * Render a Markdown string to sanitised HTML.
 *
 * @param {string} md - Markdown source text.
 * @returns {string} Rendered HTML string.
 *
 * @example
 * renderMarkdown('## Hello\n\nA **bold** world.');
 * // '<h2>Hello</h2>\n<p>A <strong>bold</strong> world.</p>'
 */
export function renderMarkdown(md) {
  if (!md) return '';
  const blocks = tokenize(md);
  return renderBlocks(blocks);
}

/**
 * Render content according to the specified format.
 *
 * Supported formats:
 * - `"markdown"` — Parsed and rendered via {@link renderMarkdown}.
 * - `"html"`     — Passed through {@link sanitizeHtml} for safety.
 * - `"text"`     — Escaped and wrapped in `<p>` tags.
 *
 * @param {string} content - Raw content string.
 * @param {'markdown'|'html'|'text'} [format='markdown'] - Content format.
 * @returns {string} Safe HTML string ready for innerHTML.
 */
export function renderContent(content, format = 'markdown') {
  if (!content) return '';

  switch (format) {
    case 'markdown':
      return renderMarkdown(content);

    case 'html':
      return sanitizeHtml(content);

    case 'text':
      return content
        .split(/\n\n+/)
        .map(para => `<p>${escapeHtml(para.trim())}</p>`)
        .join('\n');

    default:
      return renderMarkdown(content);
  }
}
