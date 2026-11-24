/**
 * The share-image looks a commissioner can pick (canvas: "Make your share image").
 * Shared by the picker UI and the server-rendered image, so they always match.
 */
export type ShareLook = {
  label: string
  bg: string
  accent: string
  text: string
  sub: string
  pillBg: string
  pillText: string
  /** Yard lines on Gridiron. */
  stripes: boolean
}

export const SHARE_LOOKS = {
  midnight: { label: 'Midnight', bg: '#12163e', accent: '#c084fc', text: '#ffffff', sub: '#d6d9f0', pillBg: '#a855f7', pillText: '#ffffff', stripes: false },
  gridiron: { label: 'Gridiron', bg: '#0f3d2a', accent: '#fde047', text: '#ffffff', sub: '#d1fae5', pillBg: '#fde047', pillText: '#0f3d2a', stripes: true },
  trophy: { label: 'Trophy', bg: '#121212', accent: '#fbbf24', text: '#ffffff', sub: '#e5e5e5', pillBg: '#fbbf24', pillText: '#121212', stripes: false },
  clean: { label: 'Clean', bg: '#f5f3ff', accent: '#6d28d9', text: '#1e1b4b', sub: '#3f3a70', pillBg: '#1e1b4b', pillText: '#ffffff', stripes: false },
} satisfies Record<string, ShareLook>

export type ShareLookKey = keyof typeof SHARE_LOOKS

export const SHARE_LOGOS = ['af', 'initials', 'upload'] as const

export const SHARE_FORMATS = {
  story: { label: 'Story 9:16', width: 1080, height: 1920 },
  square: { label: 'Square post', width: 1080, height: 1080 },
  banner: { label: 'Chat banner', width: 1200, height: 514 },
} as const

export type ShareFormatKey = keyof typeof SHARE_FORMATS

export function isShareLook(v: string): v is ShareLookKey {
  return v in SHARE_LOOKS
}

export function isShareFormat(v: string): v is ShareFormatKey {
  return v in SHARE_FORMATS
}

/** The disclosure that rides every share: the law requires saying you earn from the code. */
export const SHARE_DISCLOSURE = 'I get rewards when you join with my code.'

export function shareMessage(code: string, url: string, discountPercent: number, discountMonths: number): string {
  return `Join me on AllFantasy. Use my code ${code} for ${discountPercent}% off your first ${discountMonths} months: ${url}\n${SHARE_DISCLOSURE}`
}
