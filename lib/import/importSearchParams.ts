export type LegacyPlatformTab = 'sleeper' | 'yahoo' | 'mfl' | 'fantrax' | 'espn'

/** Maps ?provider= from /import URL to a platform tab. */
export function normalizeIncomingImportProvider(
  raw: string | undefined
): LegacyPlatformTab | undefined {
  if (!raw) return undefined
  const x = raw.trim().toLowerCase()
  if (x === 'sleeper' || x === 'yahoo' || x === 'mfl' || x === 'fantrax' || x === 'espn') return x
  return undefined
}
