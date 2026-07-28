/**
 * safeChimmyLinks — the guard that stops Chimmy message content (LLM output / cached prior turns) from
 * rendering arbitrary or external URLs as live links. Only internal app routes are renderable; every
 * external / protocol-relative / backslash-open-redirect / non-http scheme is untrusted.
 */
import { describe, it, expect } from 'vitest'
import { isInternalAppHref, isRenderableChimmyContentHref } from '@/lib/chimmy-chat/safeChimmyLinks'

describe('safeChimmyLinks', () => {
  it('accepts internal app routes', () => {
    for (const h of ['/league/abc', '/league/abc?tab=team', '/dashboard', '/', '/players?q=x#y']) {
      expect(isInternalAppHref(h)).toBe(true)
      expect(isRenderableChimmyContentHref(h)).toBe(true)
    }
  })

  it('rejects external URLs, protocol-relative, backslash open-redirects, and non-http schemes', () => {
    for (const h of [
      'https://sleeper.com/leagues/1/league',
      'http://evil.example',
      'https://evil.example/steal',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      'data:text/html,<script>x</script>',
      'mailto:x@y.z',
      'ftp://host/file',
      'league/abc', // relative, not app-absolute
    ]) {
      expect(isRenderableChimmyContentHref(h)).toBe(false)
    }
  })

  it('handles null / undefined / whitespace safely and trims', () => {
    expect(isRenderableChimmyContentHref(null)).toBe(false)
    expect(isRenderableChimmyContentHref(undefined)).toBe(false)
    expect(isRenderableChimmyContentHref('   ')).toBe(false)
    expect(isRenderableChimmyContentHref('  /league/x  ')).toBe(true)
  })
})
