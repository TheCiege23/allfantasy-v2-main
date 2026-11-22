import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { messagesFor, missingMessages, type Catalog, type Messages } from '@/lib/i18n/messages'

// Every catalog under lib/core-app/messages, so a newly migrated screen is covered without a new test.
const DIR = join(process.cwd(), 'lib/core-app/messages')
const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'))

describe('every /core message catalog', () => {
  it('finds the catalogs', () => {
    expect(files.length).toBeGreaterThan(1)
  })

  it.each(files)('%s is fully translated to Spanish, with no empty strings', async (file) => {
    const mod = (await import(`@/lib/core-app/messages/${file.replace(/\.ts$/, '')}`)) as Record<string, unknown>
    const catalogs = Object.entries(mod).filter(
      (e): e is [string, Catalog<Messages>] => !!e[1] && typeof e[1] === 'object' && 'en' in (e[1] as object),
    )
    expect(catalogs.length).toBeGreaterThan(0)
    for (const [name, catalog] of catalogs) {
      expect({ name, missing: missingMessages(catalog, 'es') }).toEqual({ name, missing: [] })
      const es = messagesFor(catalog, 'es')
      for (const [key, value] of Object.entries(es)) {
        if (typeof value === 'string') expect({ name, key, empty: value.trim() === '' }).toEqual({ name, key, empty: false })
      }
    }
  })
})
