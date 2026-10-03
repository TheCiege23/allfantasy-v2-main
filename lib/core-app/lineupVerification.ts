export type LineupVerification = { checkedAt: string; week: number | null; source: 'Sleeper'; slots: string[] }

export function verificationAge(checkedAt: string, now: number, language: 'en' | 'es' = 'en'): string {
  const es = language === 'es'
  const age = now - Date.parse(checkedAt)
  if (!Number.isFinite(age) || age < -60000) return es ? 'Hora de verificación no disponible' : 'Verification time unavailable'
  const minutes = Math.max(0, Math.floor(age / 60000))
  if (es) return minutes === 0 ? 'Revisada ahora mismo' : minutes < 60 ? `Revisada hace ${minutes} min` : `Revisada hace ${Math.floor(minutes / 60)} h`
  return minutes === 0 ? 'Checked just now' : minutes < 60 ? `Checked ${minutes} min ago` : `Checked ${Math.floor(minutes / 60)} hr ago`
}

/** Static alerts use an absolute time so an open dashboard never says 'just now' forever. */
export function verificationStamp(checkedAt: string): string {
  const date = new Date(checkedAt)
  if (!Number.isFinite(date.getTime())) return 'Verification time unavailable'
  const iso = date.toISOString()
  return `Checked ${iso.slice(11, 16)} UTC · ${iso.slice(0, 10)}`
}
