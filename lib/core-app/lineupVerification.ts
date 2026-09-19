export type LineupVerification = { checkedAt: string; week: number | null; source: 'Sleeper'; slots: string[] }

export function verificationAge(checkedAt: string, now: number): string {
  const age = now - Date.parse(checkedAt)
  if (!Number.isFinite(age) || age < -60000) return 'Verification time unavailable'
  const minutes = Math.max(0, Math.floor(age / 60000))
  return minutes === 0 ? 'Checked just now' : minutes < 60 ? `Checked ${minutes} min ago` : `Checked ${Math.floor(minutes / 60)} hr ago`
}

/** Static alerts use an absolute time so an open dashboard never says 'just now' forever. */
export function verificationStamp(checkedAt: string): string {
  const date = new Date(checkedAt)
  if (!Number.isFinite(date.getTime())) return 'Verification time unavailable'
  const iso = date.toISOString()
  return `Checked ${iso.slice(11, 16)} UTC · ${iso.slice(0, 10)}`
}
