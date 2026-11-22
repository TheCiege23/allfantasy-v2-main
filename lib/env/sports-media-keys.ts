function readTrimmedEnv(keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]
    if (!value) continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return null
}

export function getTheAudioDbApiKey(): string | null {
  return readTrimmedEnv(['THEAUDIODB_API_KEY', 'theaudiodb_api_key'])
}

export function getTheSportsDbApiKey(): string | null {
  return readTrimmedEnv([
    'THESPORTSDB_API_KEY',
    'thesportsdb_api_key',
    'THESPORTS_API_KEY',
    'thesports_api_key',
    'THEAUDIODB_API_KEY',
    'theaudiodb_api_key',
  ])
}

export function getTheSportsDbApiKeyOrFallback(fallbackKey = '3'): string {
  return getTheSportsDbApiKey() ?? fallbackKey
}

export function getTheAudioDbApiKeyOrFallback(fallbackKey = '2'): string {
  return getTheAudioDbApiKey() ?? fallbackKey
}
