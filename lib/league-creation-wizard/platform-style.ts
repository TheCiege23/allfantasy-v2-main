import type { PlatformStyleMirror } from './types'

/**
 * Maps “plays like ESPN / Yahoo / Sleeper” to an existing league variant value for the sport.
 * Falls back to the first registry variant when no label match.
 */
export function resolveVariantForPlatformStyle(
  sport: string,
  style: PlatformStyleMirror,
  variants: { value: string; label?: string }[]
): string {
  if (variants.length === 0) return 'STANDARD'
  const first = variants[0]!.value
  if (style === 'af') return first

  const labels = variants.map((x) => `${x.label ?? ''} ${x.value}`)
  const combined = variants.map((x, i) => ({ value: x.value, text: labels[i] ?? x.value }))

  const pick = (pred: (row: { value: string; text: string }) => boolean): string | undefined => {
    const row = combined.find(pred)
    return row?.value
  }

  const s = sport.toUpperCase()

  if (s === 'NFL') {
    if (style === 'espn') {
      return (
        pick((r) => /\bppr\b/i.test(r.text) && !/\bhalf\b/i.test(r.text)) ??
        pick((r) => /\bppr\b/i.test(r.text)) ??
        pick((r) => /superflex/i.test(r.text)) ??
        first
      )
    }
    if (style === 'yahoo') {
      return (
        pick((r) => /\bhalf\b/i.test(r.text) || /\.5|0\.5/i.test(r.text)) ??
        pick((r) => /\bppr\b/i.test(r.text)) ??
        first
      )
    }
    if (style === 'sleeper') {
      return pick((r) => /\bppr\b/i.test(r.text)) ?? pick((r) => /standard/i.test(r.text)) ?? first
    }
  }

  if (['NBA', 'NHL', 'MLB', 'NCAAB', 'NCAAF', 'SOCCER'].includes(s)) {
    if (style === 'espn' || style === 'sleeper') {
      return pick((r) => /points|categories|head/i.test(r.text)) ?? first
    }
    if (style === 'yahoo') {
      return pick((r) => /categories|rotisserie/i.test(r.text)) ?? first
    }
  }

  return first
}
