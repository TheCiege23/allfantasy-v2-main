import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COLOR_HEX_DARK,
  DEFAULT_COLOR_HEX_LIGHT,
  resolveColorTokenHex,
  resolveThemedColorTokenHex,
  resolveWidgetChromeHex,
} from '../../../sdk-runtime/react/src/tokens'
import { resolveSDKTheme } from '../../../lib/decision-os/sdk/theme'
import type { SDKTheme } from '../../../lib/decision-os/sdk/types'

function makePartnerTheme(colorTokenMap: SDKTheme['tokens']['colorTokenMap'] = {}, mode: SDKTheme['mode'] = 'partner_override'): SDKTheme {
  const base = resolveSDKTheme(mode, {}, 'partner_acme')
  return { ...base, tokens: { ...base.tokens, colorTokenMap } }
}

describe('resolveColorTokenHex — unchanged Phase 7.8 behavior', () => {
  it('always returns the dark default palette, regardless of any theme concept', () => {
    for (const token of Object.keys(DEFAULT_COLOR_HEX_DARK) as (keyof typeof DEFAULT_COLOR_HEX_DARK)[]) {
      expect(resolveColorTokenHex(token)).toBe(DEFAULT_COLOR_HEX_DARK[token])
    }
  })
})

describe('resolveThemedColorTokenHex — default theme (no theme argument)', () => {
  it('matches resolveColorTokenHex exactly when theme is omitted', () => {
    expect(resolveThemedColorTokenHex('accent')).toBe(resolveColorTokenHex('accent'))
    expect(resolveThemedColorTokenHex('danger')).toBe(resolveColorTokenHex('danger'))
  })

  it('matches resolveColorTokenHex exactly when theme is explicitly null', () => {
    expect(resolveThemedColorTokenHex('success', null)).toBe(resolveColorTokenHex('success'))
  })

  it('matches resolveColorTokenHex exactly when theme is undefined', () => {
    expect(resolveThemedColorTokenHex('warning', undefined)).toBe(resolveColorTokenHex('warning'))
  })
})

describe('resolveThemedColorTokenHex — dark theme', () => {
  it('resolves to the dark palette (same values as the default) for mode "dark"', () => {
    const theme = resolveSDKTheme('dark')
    for (const token of Object.keys(DEFAULT_COLOR_HEX_DARK) as (keyof typeof DEFAULT_COLOR_HEX_DARK)[]) {
      expect(resolveThemedColorTokenHex(token, theme)).toBe(DEFAULT_COLOR_HEX_DARK[token])
    }
  })

  it('resolves to the dark palette for mode "auto" (no real system-preference signal in a pure function)', () => {
    const theme = resolveSDKTheme('auto')
    expect(resolveThemedColorTokenHex('accent', theme)).toBe(DEFAULT_COLOR_HEX_DARK.accent)
  })
})

describe('resolveThemedColorTokenHex — light theme', () => {
  it('resolves to a genuinely different palette than dark/default for mode "light"', () => {
    const theme = resolveSDKTheme('light')
    for (const token of Object.keys(DEFAULT_COLOR_HEX_LIGHT) as (keyof typeof DEFAULT_COLOR_HEX_LIGHT)[]) {
      expect(resolveThemedColorTokenHex(token, theme)).toBe(DEFAULT_COLOR_HEX_LIGHT[token])
      expect(resolveThemedColorTokenHex(token, theme)).not.toBe(DEFAULT_COLOR_HEX_DARK[token])
    }
  })
})

describe('resolveThemedColorTokenHex — partner_override', () => {
  it('uses the partner\'s override value for a token present in colorTokenMap', () => {
    const theme = makePartnerTheme({ accent: '#ff00aa' })
    expect(resolveThemedColorTokenHex('accent', theme)).toBe('#ff00aa')
  })

  it('falls back to the default palette for a token NOT present in colorTokenMap', () => {
    const theme = makePartnerTheme({ accent: '#ff00aa' })
    expect(resolveThemedColorTokenHex('danger', theme)).toBe(DEFAULT_COLOR_HEX_DARK.danger)
  })

  it('overrides multiple tokens independently', () => {
    const theme = makePartnerTheme({ accent: '#111111', surface: '#222222', danger: '#e00000' })
    expect(resolveThemedColorTokenHex('accent', theme)).toBe('#111111')
    expect(resolveThemedColorTokenHex('surface', theme)).toBe('#222222')
    expect(resolveThemedColorTokenHex('danger', theme)).toBe('#e00000')
    expect(resolveThemedColorTokenHex('warning', theme)).toBe(DEFAULT_COLOR_HEX_DARK.warning)
  })
})

describe('resolveThemedColorTokenHex — enterprise_branding', () => {
  it('behaves identically to partner_override for override eligibility', () => {
    const theme = makePartnerTheme({ accent: '#00ff88' }, 'enterprise_branding')
    expect(resolveThemedColorTokenHex('accent', theme)).toBe('#00ff88')
    expect(resolveThemedColorTokenHex('muted', theme)).toBe(DEFAULT_COLOR_HEX_DARK.muted)
  })
})

describe('resolveThemedColorTokenHex — invalid/missing override values (graceful fallback)', () => {
  it('falls back to default when the override is an empty string', () => {
    const theme = makePartnerTheme({ accent: '' })
    expect(resolveThemedColorTokenHex('accent', theme)).toBe(DEFAULT_COLOR_HEX_DARK.accent)
  })

  it('falls back to default when the override is a whitespace-only string', () => {
    const theme = makePartnerTheme({ accent: '   ' })
    expect(resolveThemedColorTokenHex('accent', theme)).toBe(DEFAULT_COLOR_HEX_DARK.accent)
  })

  it('falls back to default when colorTokenMap is entirely empty', () => {
    const theme = makePartnerTheme({})
    expect(resolveThemedColorTokenHex('accent', theme)).toBe(DEFAULT_COLOR_HEX_DARK.accent)
  })

  it('a "light"-mode theme never applies colorTokenMap overrides (only partner_override/enterprise_branding do)', () => {
    const base = resolveSDKTheme('light')
    const theme: SDKTheme = { ...base, tokens: { ...base.tokens, colorTokenMap: { accent: '#should-not-apply' } } }
    expect(resolveThemedColorTokenHex('accent', theme)).toBe(DEFAULT_COLOR_HEX_LIGHT.accent)
  })

  it('never throws for a malformed theme-like object missing tokens.colorTokenMap entries', () => {
    const theme = makePartnerTheme({})
    expect(() => resolveThemedColorTokenHex('critical', theme)).not.toThrow()
  })
})

describe('resolveWidgetChromeHex', () => {
  it('resolves every chrome slot to a real ColorToken-backed hex when no theme is given', () => {
    const chrome = resolveWidgetChromeHex()
    expect(chrome.primary).toBe(DEFAULT_COLOR_HEX_DARK.accent)
    expect(chrome.accent).toBe(DEFAULT_COLOR_HEX_DARK.accent)
    expect(chrome.background).toBe(DEFAULT_COLOR_HEX_DARK.surface)
    expect(chrome.surface).toBe(DEFAULT_COLOR_HEX_DARK.surface_elevated)
    expect(chrome.text).toBe(DEFAULT_COLOR_HEX_DARK.neutral)
    expect(chrome.textMuted).toBe(DEFAULT_COLOR_HEX_DARK.muted)
    expect(chrome.border).toBe(DEFAULT_COLOR_HEX_DARK.muted)
    expect(chrome.danger).toBe(DEFAULT_COLOR_HEX_DARK.danger)
    expect(chrome.warning).toBe(DEFAULT_COLOR_HEX_DARK.warning)
    expect(chrome.success).toBe(DEFAULT_COLOR_HEX_DARK.success)
  })

  it('every chrome slot picks up a partner override on its backing ColorToken', () => {
    const theme = makePartnerTheme({
      accent: '#111111',
      surface: '#222222',
      surface_elevated: '#333333',
      neutral: '#444444',
      muted: '#555555',
      danger: '#d10000',
      warning: '#f5a300',
      success: '#00c853',
    })
    const chrome = resolveWidgetChromeHex(theme)
    expect(chrome.primary).toBe('#111111')
    expect(chrome.accent).toBe('#111111')
    expect(chrome.background).toBe('#222222')
    expect(chrome.surface).toBe('#333333')
    expect(chrome.text).toBe('#444444')
    expect(chrome.textMuted).toBe('#555555')
    expect(chrome.border).toBe('#555555')
    expect(chrome.danger).toBe('#d10000')
    expect(chrome.warning).toBe('#f5a300')
    expect(chrome.success).toBe('#00c853')
  })

  it('a partial partner override leaves the untouched slots at their default', () => {
    const theme = makePartnerTheme({ accent: '#0a84ff' })
    const chrome = resolveWidgetChromeHex(theme)
    expect(chrome.primary).toBe('#0a84ff')
    expect(chrome.background).toBe(DEFAULT_COLOR_HEX_DARK.surface)
    expect(chrome.text).toBe(DEFAULT_COLOR_HEX_DARK.neutral)
  })
})

describe('theming — no internal leakage', () => {
  it('an override value is returned byte-for-byte, never mutated, parsed, or wrapped', () => {
    const raw = '#AbCdEf'
    const theme = makePartnerTheme({ accent: raw })
    expect(resolveThemedColorTokenHex('accent', theme)).toBe(raw)
  })

  it('resolveWidgetChromeHex never includes internal Decision OS terminology in its output keys or resolved values', () => {
    const theme = makePartnerTheme({ accent: '#0a84ff' })
    const chrome = resolveWidgetChromeHex(theme)
    const serialized = JSON.stringify(chrome)
    expect(serialized).not.toMatch(/decision-os/i)
    expect(serialized).not.toContain('Canonical World')
    expect(serialized).not.toContain('behavioralIntelligence')
  })
})
