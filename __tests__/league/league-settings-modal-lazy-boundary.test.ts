/**
 * The league page must not die because the settings window's code failed to download.
 *
 * 🛑 MEASURED 2026-09-26, in Chrome against a local server: the `LeagueSettingsModal` chunk was
 * requested at page load (second 19) with nobody opening settings, took 136 s — past webpack's
 * 120 s chunk timeout — and the ChunkLoadError from its `next/dynamic` loader had no boundary
 * nearer than the page, so the WHOLE league page became "League temporarily unavailable".
 *
 * `LeagueShell` is too large to render in a unit test, so these read its source for the three
 * properties that matter, the same way the Chimmy route-wiring suite does.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SHELL = fs.readFileSync(path.join(process.cwd(), 'app', 'league', '[leagueId]', 'LeagueShell.tsx'), 'utf8')
const at = SHELL.indexOf('<LeagueSettingsModal')
/* The JSX from the portal guard to the modal element. */
const MOUNT = SHELL.slice(SHELL.lastIndexOf('{portalMounted', at), at + 40)

describe('the league settings modal', () => {
  it('is still loaded lazily', () => {
    expect(SHELL).toMatch(/const LeagueSettingsModal = dynamic\(/)
  })

  /* Mounting it with open={false} is what fetched its code on every league page view. */
  it('mounts only once settings has been opened', () => {
    expect(SHELL).toMatch(/if \(settingsOpen\) settingsEverOpened\.current = true/)
    expect(MOUNT).toMatch(/portalMounted && settingsEverOpened\.current && !settingsLoadFailed/)
  })

  it('sits inside its own error boundary, so a failed load cannot reach the page', () => {
    expect(MOUNT).toMatch(/<ErrorBoundary fallback=\{null\} onError=\{onSettingsLoadError\}>/)
    const closeTag = SHELL.indexOf('</ErrorBoundary>', at)
    expect(closeTag).toBeGreaterThan(at)
    expect(SHELL.slice(at, closeTag)).not.toMatch(/<LeagueSettingsModal[\s\S]*<LeagueSettingsModal/)
  })

  /* A Settings button that silently does nothing is the other failure; each open must say why. */
  it('tells the user when settings could not load, on the failure and on every later open', () => {
    const handler = SHELL.slice(SHELL.indexOf('const onSettingsLoadError'), SHELL.indexOf('const onSettingsLoadError') + 400)
    expect(handler).toMatch(/setSettingsLoadFailed\(true\)/)
    expect(handler).toMatch(/closeLeagueSettingsModal\(\)/)
    expect(handler).toMatch(/toast\.error\(/)
    expect(SHELL).toMatch(/if \(!settingsOpen \|\| !settingsLoadFailed\) return/)
  })
})
