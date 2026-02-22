// games/tests/content-renderer.test.js
// Unit tests for the lightweight Markdown → HTML renderer.

import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  sanitizeHtml,
  tokenize,
  renderInline,
  renderBlocks,
  renderMarkdown,
  renderContent,
} from '../../engine/content-renderer.js';

/* ------------------------------------------------------------------ */
/*  escapeHtml                                                        */
/* ------------------------------------------------------------------ */

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });
  it('escapes angle brackets', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
  });
  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });
  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});

/* ------------------------------------------------------------------ */
/*  sanitizeHtml                                                      */
/* ------------------------------------------------------------------ */

describe('sanitizeHtml', () => {
  it('keeps safe tags', () => {
    expect(sanitizeHtml('<p>hello</p>')).toBe('<p>hello</p>');
    expect(sanitizeHtml('<strong>bold</strong>')).toBe('<strong>bold</strong>');
  });

  it('strips unsafe tags', () => {
    const result = sanitizeHtml('<script>alert(1)</script>');
    expect(result).not.toContain('<script');
    expect(result).toContain('&lt;script&gt;');
  });

  it('keeps allowed attributes on img', () => {
    const result = sanitizeHtml('<img src="a.jpg" alt="test" width="100">');
    expect(result).toContain('src="a.jpg"');
    expect(result).toContain('alt="test"');
    expect(result).toContain('width="100"');
  });

  it('removes disallowed attributes', () => {
    const result = sanitizeHtml('<img src="a.jpg" onclick="hack()">');
    expect(result).toContain('src="a.jpg"');
    expect(result).not.toContain('onclick');
  });

  it('blocks javascript: URIs', () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain('javascript');
  });
});

/* ------------------------------------------------------------------ */
/*  tokenize                                                          */
/* ------------------------------------------------------------------ */

describe('tokenize', () => {
  it('parses headings', () => {
    const blocks = tokenize('# Title\n## Subtitle\n### Sub');
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ type: 'heading', level: 1, raw: 'Title' });
    expect(blocks[1]).toEqual({ type: 'heading', level: 2, raw: 'Subtitle' });
    expect(blocks[2]).toEqual({ type: 'heading', level: 3, raw: 'Sub' });
  });

  it('parses paragraphs separated by blank lines', () => {
    const blocks = tokenize('First paragraph.\n\nSecond paragraph.');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[1].type).toBe('paragraph');
  });

  it('parses unordered lists', () => {
    const blocks = tokenize('- item 1\n- item 2\n- item 3');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('list');
    expect(blocks[0].ordered).toBe(false);
    expect(blocks[0].items).toEqual(['item 1', 'item 2', 'item 3']);
  });

  it('parses ordered lists', () => {
    const blocks = tokenize('1. first\n2. second');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('list');
    expect(blocks[0].ordered).toBe(true);
    expect(blocks[0].items).toEqual(['first', 'second']);
  });

  it('parses blockquotes', () => {
    const blocks = tokenize('> quoted text');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('blockquote');
    expect(blocks[0].raw).toBe('quoted text');
  });

  it('parses horizontal rules', () => {
    const blocks = tokenize('---');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('hr');
  });

  it('handles mixed content', () => {
    const md = '# Title\n\nParagraph.\n\n- item 1\n- item 2\n\n---\n\n> quote';
    const blocks = tokenize(md);
    expect(blocks.map(b => b.type)).toEqual([
      'heading', 'paragraph', 'list', 'hr', 'blockquote'
    ]);
  });

  it('handles bold text at start of line without treating as list', () => {
    const blocks = tokenize('**Bold text** here.');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('paragraph');
  });
});

/* ------------------------------------------------------------------ */
/*  renderInline                                                      */
/* ------------------------------------------------------------------ */

describe('renderInline', () => {
  it('renders bold', () => {
    expect(renderInline('**bold**')).toContain('<strong>bold</strong>');
  });

  it('renders italic', () => {
    expect(renderInline('*italic*')).toContain('<em>italic</em>');
  });

  it('renders bold+italic', () => {
    const result = renderInline('***both***');
    expect(result).toContain('<strong><em>both</em></strong>');
  });

  it('renders inline code', () => {
    expect(renderInline('use `code` here')).toContain('<code>code</code>');
  });

  it('renders images', () => {
    const result = renderInline('![alt text](img.jpg)');
    expect(result).toContain('<img');
    expect(result).toContain('src="img.jpg"');
    expect(result).toContain('alt="alt text"');
  });

  it('renders links', () => {
    const result = renderInline('[click](http://example.com)');
    expect(result).toContain('<a href="http://example.com">');
    expect(result).toContain('click</a>');
  });

  it('blocks javascript: in links', () => {
    const result = renderInline('[xss](javascript:alert(1))');
    expect(result).not.toContain('javascript');
  });

  it('escapes HTML in text', () => {
    const result = renderInline('x < y & z > w');
    expect(result).toContain('&lt;');
    expect(result).toContain('&amp;');
    expect(result).toContain('&gt;');
  });
});

/* ------------------------------------------------------------------ */
/*  renderMarkdown (integration)                                      */
/* ------------------------------------------------------------------ */

describe('renderMarkdown', () => {
  it('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown(undefined)).toBe('');
  });

  it('renders a complete document', () => {
    const md = [
      '# Mise: Zachraňte reaktor',
      '',
      '## Je rok 2140.',
      '',
      'Vědecká stanice **THERMOS-7** vyrábí energii.',
      '',
      '- Ověř znalosti',
      '- Oprav chyby',
      '',
      '> Důležitá poznámka',
      '',
      '---',
    ].join('\n');

    const html = renderMarkdown(md);

    expect(html).toContain('<h1>Mise: Zachraňte reaktor</h1>');
    expect(html).toContain('<h2>Je rok 2140.</h2>');
    expect(html).toContain('<strong>THERMOS-7</strong>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<hr>');
  });

  it('handles Czech text with diacritics', () => {
    const md = '**Teplo** se šíří *vedením*, **prouděním** a záření.';
    const html = renderMarkdown(md);
    expect(html).toContain('<strong>Teplo</strong>');
    expect(html).toContain('<em>vedením</em>');
  });
});

/* ------------------------------------------------------------------ */
/*  renderContent (format dispatcher)                                 */
/* ------------------------------------------------------------------ */

describe('renderContent', () => {
  it('renders markdown format', () => {
    const result = renderContent('**bold**', 'markdown');
    expect(result).toContain('<strong>bold</strong>');
  });

  it('renders html format with sanitisation', () => {
    const result = renderContent('<p>safe</p><script>bad</script>', 'html');
    expect(result).toContain('<p>safe</p>');
    expect(result).not.toContain('<script>');
  });

  it('renders text format', () => {
    const result = renderContent('first\n\nsecond', 'text');
    expect(result).toContain('<p>first</p>');
    expect(result).toContain('<p>second</p>');
  });

  it('defaults to markdown', () => {
    const result = renderContent('## heading');
    expect(result).toContain('<h2>heading</h2>');
  });

  it('returns empty for empty input', () => {
    expect(renderContent('')).toBe('');
    expect(renderContent(null)).toBe('');
  });
});
