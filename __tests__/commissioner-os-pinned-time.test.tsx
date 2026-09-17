import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { AutomationCatalogCard } from "@/components/commissioner-os/automations/AutomationCatalogCard"
import { count, dateTime, longDate, mediumDate, resolvedFormats, shortDate } from "@/components/commissioner-os/primitives/pinnedTime"
import type { AutomationCatalogEntry } from "@/lib/commissioner-ui/automations/decision-os-client"

/*
 * Commissioner OS screens are server-rendered and hydrated, so any date or number formatted with
 * the VISITOR's locale or time zone renders differently on the two sides — React error #425, and a
 * screen that can blank. #681 pinned one of these on the analytics sheet; `primitives/pinnedTime.ts`
 * is that rule in one place.
 *
 * 🛑 THE LOAD-BEARING CASE IS THE INSTANT THAT FALLS ON DIFFERENT DAYS IN DIFFERENT ZONES. A test
 * whose instant is mid-afternoon UTC passes with the zone unpinned, because UTC and Eastern agree
 * on the day. 03:30Z is 11:30 PM the PREVIOUS day in Eastern, so it fails the moment the zone
 * stops being pinned — whatever zone the machine running the test is in.
 */

/** 2026-09-10 03:30 UTC = 2026-09-09 23:30 America/New_York. */
const CROSSES_MIDNIGHT = '2026-09-10T03:30:00.000Z'

describe('pinnedTime — the zone and locale are pinned', () => {
  it('formats the instant in Eastern, not in the runtime zone', () => {
    expect(shortDate(CROSSES_MIDNIGHT)).toBe('Sep 9')
    expect(mediumDate(CROSSES_MIDNIGHT)).toBe('Sep 9, 2026')
    expect(longDate(CROSSES_MIDNIGHT)).toBe('September 9, 2026')
  })

  it('names the zone on a time, so a reader cannot take it for their own clock', () => {
    const out = dateTime(CROSSES_MIDNIGHT)
    expect(out).toContain('Sep 9, 2026')
    expect(out).toMatch(/\b(EDT|EST|GMT-[45])\b/)
  })

  /*
   * 🛑 THE ASSERTION THAT HOLDS ON ANY MACHINE. Every check below reads a formatted STRING, and a
   * box already on Eastern time with an en-US locale renders the right string even when nothing is
   * pinned — so those alone would pass on the machine most likely to run them. These read what the
   * formatters resolved to.
   */
  it('every formatter resolved to the pinned zone and locale', () => {
    const formats = resolvedFormats()
    expect(Object.keys(formats).sort()).toEqual(['count', 'dateTime', 'longDate', 'mediumDate', 'shortDate'])
    for (const [name, opts] of Object.entries(formats)) {
      expect(opts.locale, `${name} locale`).toBe('en-US')
      if (name !== 'count') expect(opts.timeZone, `${name} zone`).toBe('America/New_York')
    }
  })

  it('formats counts in en-US, not the visitor locale', () => {
    expect(count(1234567)).toBe('1,234,567')
  })

  it('renders an em dash rather than "Invalid Date" for missing or unparseable input', () => {
    for (const bad of [null, undefined, '', 'not a date']) {
      expect(shortDate(bad as never)).toBe('—')
      expect(dateTime(bad as never)).toBe('—')
    }
    expect(count(null)).toBe('—')
    expect(count(Number.NaN)).toBe('—')
  })

  it('is stable across calls, so server and client agree', () => {
    expect(shortDate(CROSSES_MIDNIGHT)).toBe(shortDate(new Date(CROSSES_MIDNIGHT)))
    expect(shortDate(CROSSES_MIDNIGHT)).toBe(shortDate(Date.parse(CROSSES_MIDNIGHT)))
  })
})

describe('the automation card uses it', () => {
  it('renders the pinned day, not the runtime zone\'s day', () => {
    const automation: AutomationCatalogEntry = {
      id: 'auto-1',
      name: 'Test automation',
      description: 'A test automation.',
      category: 'communications',
      status: 'enabled',
      health: 'positive',
      schedule: { triggerType: 'manual', description: 'Manual only.' },
      totalRunsCount: 4,
      successRatePercent: 100,
      runOutcomes: { succeeded: 4, failed: 0, skipped: 0 },
      relatedLinks: [],
      lastRunAt: CROSSES_MIDNIGHT,
    }

    render(<AutomationCatalogCard automation={automation} enabled onToggle={() => {}} onViewHistory={() => {}} />)

    expect(screen.getByText(/Last ran Sep 9/)).toBeTruthy()
  })
})

/*
 * ⚠ THE GUARD IS WHY THIS DOES NOT COME BACK. Eight call sites had the same bug; the ninth would
 * too. A new `toLocaleDateString(undefined, …)` anywhere under components/commissioner-os fails
 * here, naming the file.
 */
describe('no Commissioner OS component formats with the visitor locale', () => {
  const ROOT = resolve(__dirname, '../components/commissioner-os')

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry)
      return statSync(full).isDirectory() ? walk(full) : full.endsWith('.tsx') || full.endsWith('.ts') ? [full] : []
    })
  }

  /*
   * ⚠ AND THE HELPER ITSELF IS CHECKED AT THE SOURCE, because this one cannot be caught by output.
   * The risk is the VISITOR's locale, not the test machine's: a de-DE browser renders 1.234 where
   * the en-US server rendered 1,234. Every machine that runs this suite is en-US, so
   * `new Intl.NumberFormat()` formats identically here however wrong it is.
   */
  it('constructs no formatter without the pinned locale', () => {
    const src = readFileSync(join(ROOT, 'primitives/pinnedTime.ts'), 'utf8')
    const constructions = [...src.matchAll(/new Intl\.(?:DateTimeFormat|NumberFormat)\(([^,)]*)/g)].map((m) => m[1].trim())
    expect(constructions.length).toBeGreaterThanOrEqual(5)
    expect(constructions.filter((arg) => arg !== 'LOCALE')).toEqual([])
  })

  it('has no toLocaleDateString / toLocaleTimeString / bare toLocaleString', () => {
    const files = walk(ROOT).filter((f) => !f.endsWith('pinnedTime.ts'))
    expect(files.length).toBeGreaterThan(20)
    const offenders = files.filter((f) => /toLocale(Date|Time)?String\s*\(/.test(readFileSync(f, 'utf8')))
    expect(offenders.map((f) => f.slice(ROOT.length + 1))).toEqual([])
  })
})
