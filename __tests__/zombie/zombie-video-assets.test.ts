import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  ZOMBIE_VIDEO_ASSETS,
  zombieClipForAnimation,
} from '@/lib/zombie/videoAssets'

const PUBLIC_DIR = path.join(process.cwd(), 'public')

function shipped(url: string): boolean {
  if (!url.startsWith('/')) return false
  return existsSync(path.join(PUBLIC_DIR, decodeURIComponent(url.split(/[?#]/)[0] ?? url)))
}

describe('zombie video assets', () => {
  it('control — the existence helper reports a missing file as missing', () => {
    expect(shipped('/zombie/videos/ambush/not-real.mp4')).toBe(false)
    expect(shipped(ZOMBIE_VIDEO_ASSETS.ambush)).toBe(true)
  })

  it('every clip in the registry ships', () => {
    const missing = Object.entries(ZOMBIE_VIDEO_ASSETS)
      .filter(([, url]) => !shipped(url))
      .map(([key, url]) => `${key}: ${url}`)
    expect(missing).toEqual([])
  })

  /*
   * 🛑 The two transition files are named for the WINNING SIDE, not the transition, so the
   * names read backwards against the directories they live in. Verified 2026-09-20 by frame
   * extraction: revival-win.mp4 opens on the AF robot cracking into an infected human and ends
   * on a green zombie; infection-win.mp4 ends on the clean silver robot.
   *
   * This test exists because the filenames invite an inversion that would play a revival when
   * a manager is infected — a swap no type, lint or build could catch.
   */
  it('infection and revival are not swapped', () => {
    expect(zombieClipForAnimation('zombie_turn')?.url).toBe(ZOMBIE_VIDEO_ASSETS.humanToZombie)
    expect(zombieClipForAnimation('zombie_turn')?.url).toContain('/human-to-zombie/')

    expect(zombieClipForAnimation('player_revived')?.url).toBe(ZOMBIE_VIDEO_ASSETS.zombieToHuman)
    expect(zombieClipForAnimation('player_revived')?.url).toContain('/zombie-to-human/')

    // The clip a turn plays must never be the one a revival plays.
    expect(zombieClipForAnimation('zombie_turn')?.url).not.toBe(
      zombieClipForAnimation('player_revived')?.url,
    )
  })

  it('maps the remaining animation types to their own clips', () => {
    expect(zombieClipForAnimation('bashing')?.url).toBe(ZOMBIE_VIDEO_ASSETS.bashing)
    expect(zombieClipForAnimation('ambush_triggered')?.url).toBe(ZOMBIE_VIDEO_ASSETS.ambush)
    for (const t of ['whisperer_selected', 'whisperer_replaced']) {
      expect(zombieClipForAnimation(t)?.url).toBe(ZOMBIE_VIDEO_ASSETS.whispererChosen)
    }
  })

  it('fails closed on an unknown animation type', () => {
    expect(zombieClipForAnimation('not_a_real_animation')).toBeNull()
    expect(zombieClipForAnimation('')).toBeNull()
  })

  it('clip paths are case-exact, because production serves from Linux', () => {
    /*
     * ⚠ `existsSync` CANNOT express this on Windows — the filesystem is case-insensitive, so a
     * lowercase path finds `Whisperer.mp4` and the assertion passes for the wrong reason. It has
     * to be a string comparison against the real directory listing, which is case-exact on every
     * platform. A wrong case here 404s only in production.
     */
    for (const url of Object.values(ZOMBIE_VIDEO_ASSETS)) {
      const rel = url.replace(/^\//, '')
      const dir = path.join(PUBLIC_DIR, path.dirname(rel))
      const want = path.basename(rel)
      expect(readdirSync(dir), url).toContain(want)
    }

    // Control: the listing really is case-sensitive, so the loop above is not vacuous.
    const whispererDir = path.join(PUBLIC_DIR, 'zombie', 'videos', 'whisperer')
    expect(readdirSync(whispererDir)).toContain('Whisperer.mp4')
    expect(readdirSync(whispererDir)).not.toContain('whisperer.mp4')
  })
})
