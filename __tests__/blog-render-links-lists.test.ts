/**
 * renderBlogBodyHtml — links and lists, without loosening the escaping that the security suite
 * (__tests__/security/blog-and-reset-hardening.test.ts) pins.
 *
 * The body is stored text rendered with dangerouslySetInnerHTML on the public article page, so the
 * link rule is the riskiest one this renderer has: it is the only rule that writes an attribute.
 */
import { describe, expect, it } from 'vitest'
import { renderBlogBodyHtml, safeBlogHref } from '@/lib/automated-blog/renderBlogBody'

const p = (inner: string) => `<p class="mb-3">${inner}</p>`

describe('links', () => {
  it('renders a site link without target, and an https link in a new tab with noopener', () => {
    expect(renderBlogBodyHtml('Start a [free league](/league-types/guillotine) today.')).toBe(
      p('Start a <a href="/league-types/guillotine" class="underline">free league</a> today.'),
    )
    expect(renderBlogBodyHtml('[Rules](https://example.com/rules?a=1&b=2)')).toBe(
      p('<a href="https://example.com/rules?a=1&amp;b=2" class="underline" target="_blank" rel="noopener noreferrer">Rules</a>'),
    )
  })

  it('keeps bold inside link text, and several links on one line', () => {
    expect(renderBlogBodyHtml('[**Trade** Analyzer](/trade-analyzer) or [sports](/sports/fantasy-football)')).toBe(
      p('<a href="/trade-analyzer" class="underline"><strong>Trade</strong> Analyzer</a> or <a href="/sports/fantasy-football" class="underline">sports</a>'),
    )
  })

  it.each([
    ['javascript:alert(1)'],
    ['JavaScript:alert(1)'],
    ['data:text/html;base64,PHNjcmlwdD4='],
    ['vbscript:msgbox(1)'],
    ['//evil.example.com/x'],
    ['/\\evil.example.com'],
    ['http://example.com'],
    ['https://'],
    ['relative/path'],
    ['#top'],
  ])('rejects %s and renders the plain link text', (href) => {
    // A payload holding `)` (e.g. `alert(1)`) ends the href at its first `)`, leaving a stray
    // `)` in the text. That is harmless; what matters is that no link is ever written.
    const html = renderBlogBodyHtml(`click [here](${href}) now`)
    expect(html).not.toContain('<a')
    expect(html).not.toContain('href=')
    expect(html.startsWith(p('click here').slice(0, -4))).toBe(true)
  })

  it('cannot break out of the href attribute with a quote', () => {
    for (const href of ['/x"onmouseover="alert(1)', "/x'onmouseover='alert(1)", '/x"><script>alert(1)</script>']) {
      const html = renderBlogBodyHtml(`[t](${href})`)
      expect(html, href).not.toContain('<a')
      expect(html, href).not.toContain('onmouseover="')
      expect(html, href).not.toContain('<script')
    }
  })

  it('escapes markup in link text', () => {
    const html = renderBlogBodyHtml('[<script>alert(1)</script>](/blog)')
    expect(html).toBe(p('<a href="/blog" class="underline">&lt;script&gt;alert(1)&lt;/script&gt;</a>'))
    expect(html).not.toContain('<script')
  })

  it('never lets bold reach inside an attribute', () => {
    // `*` is outside the href allowlist, so this link is refused rather than half-bolded.
    const html = renderBlogBodyHtml('[t](/a**b**c)')
    expect(html).not.toContain('href="/a<strong>')
    expect(html).toBe(p('t'))
  })

  it('safeBlogHref accepts site paths and https only', () => {
    expect(safeBlogHref('/league-types/devy')).toBe('/league-types/devy')
    expect(safeBlogHref('/players?sport=NFL&amp;q=1')).toBe('/players?sport=NFL&amp;q=1')
    expect(safeBlogHref('https://www.allfantasy.ai/blog')).toBe('https://www.allfantasy.ai/blog')
    expect(safeBlogHref('//x.com')).toBeNull()
    expect(safeBlogHref('javascript:alert(1)')).toBeNull()
  })
})

describe('lists', () => {
  it('turns consecutive bullet lines into one ul, with inline formatting', () => {
    expect(renderBlogBodyHtml('- **Floor** first\n- See [the rules](/league-types/guillotine)\n* star bullets too')).toBe(
      '<ul class="list-disc pl-6 mb-3 space-y-1">' +
        '<li><strong>Floor</strong> first</li>' +
        '<li>See <a href="/league-types/guillotine" class="underline">the rules</a></li>' +
        '<li>star bullets too</li></ul>',
    )
  })

  it('numbered lines become an ol, and a change of kind or a blank line closes the list', () => {
    const html = renderBlogBodyHtml('1. Draft\n2) Trade\n- loose\n\nAfter')
    expect(html).toBe(
      [
        '<ol class="list-decimal pl-6 mb-3 space-y-1"><li>Draft</li><li>Trade</li></ol>',
        '<ul class="list-disc pl-6 mb-3 space-y-1"><li>loose</li></ul>',
        p('After'),
      ].join('\n'),
    )
  })

  it('escapes markup in list items', () => {
    const html = renderBlogBodyHtml('- <img src=x onerror="alert(1)">')
    expect(html).not.toContain('<img')
    expect(html).toContain('<li>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</li>')
  })

  it('a bold line is a paragraph, not a bullet', () => {
    expect(renderBlogBodyHtml('**Two-for-one** works.')).toBe(p('<strong>Two-for-one</strong> works.'))
  })
})

describe('unchanged behaviour', () => {
  it('headings, paragraphs and bold render as before, CRLF included', () => {
    expect(renderBlogBodyHtml('## Week 7\r\n\r\nPlain **bold** text\r\n### Sub')).toBe(
      [
        '<h2 class="text-xl font-semibold mt-8 mb-2">Week 7</h2>',
        p('Plain <strong>bold</strong> text'),
        '<h3 class="text-lg font-semibold mt-6 mb-2">Sub</h3>',
      ].join('\n'),
    )
    expect(renderBlogBodyHtml(null)).toBe('')
  })
})
