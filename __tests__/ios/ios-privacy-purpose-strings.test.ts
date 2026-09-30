// @vitest-environment node
/**
 * The iOS app declares a purpose string for every privacy-sensitive thing the site can ask for
 * (2026-09-29).
 *
 * 🛑 A MISSING PURPOSE STRING IS A CRASH, NOT A DENIED PROMPT. The app is a WKWebView over
 * allfantasy.ai, so every web feature ships inside it: an `<input type="file" accept="image/*">`
 * offers "Take Photo", Chimmy's voice input uses speech recognition and the microphone, and a
 * long-press on an image offers "Save to Photos". iOS terminates an app that reaches the camera,
 * microphone, speech recognizer or photo library without the matching Info.plist key. Until this
 * change Info.plist declared none — a reviewer tapping "Take Photo" on the profile picture, or the
 * mic in Chimmy, would have crashed the app (guideline 2.1).
 *
 * The census below scans the web source for each trigger, so a new feature that needs a key the
 * plist lacks fails here rather than on a reviewer's device.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const PLIST = 'ios-app/ios/App/App/Info.plist'

function plistStrings(xml: string): Record<string, string> {
  const doc = new XMLParser({ preserveOrder: true }).parse(xml) as Array<Record<string, unknown>>
  const plist = doc.find((n) => 'plist' in n)!.plist as Array<Record<string, unknown>>
  const dict = plist.find((n) => 'dict' in n)!.dict as Array<Record<string, Array<{ '#text'?: unknown }>>>
  const out: Record<string, string> = {}
  for (let i = 0; i < dict.length - 1; i++) {
    if (!('key' in dict[i]) || !('string' in dict[i + 1])) continue
    const key = String(dict[i].key[0]?.['#text'] ?? '')
    out[key] = String(dict[i + 1].string[0]?.['#text'] ?? '')
  }
  return out
}

/**
 * Tracked web files matching a trigger, via `git grep` (the index) — walking ~15k files on disk
 * takes longer than a test timeout on this repo's drives. Tests and specs are excluded.
 */
function filesMatching(pattern: RegExp): string[] {
  try {
    const out = execFileSync(
      'git',
      ['grep', '-l', '-E', pattern.source, '--', 'app', 'components', 'hooks', 'lib', ':!*.test.*', ':!*.spec.*', ':!**/__tests__/**'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    )
    return out.split('\n').filter(Boolean)
  } catch (err) {
    // git grep exits 1 for "no match"; anything else is not an answer.
    if ((err as { status?: number }).status === 1) return []
    throw err
  }
}

const TRIGGERS: Array<{ what: string; pattern: RegExp; keys: string[] }> = [
  {
    what: 'an image file input (iOS offers Take Photo and Photo Library)',
    pattern: /accept=["{][^>]*image\//,
    keys: ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription'],
  },
  {
    what: 'a video file input (iOS offers Record Video)',
    pattern: /accept=["{][^>]*video\//,
    keys: ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription'],
  },
  {
    what: 'getUserMedia',
    pattern: /getUserMedia\(/,
    keys: ['NSMicrophoneUsageDescription'],
  },
  {
    what: 'the Web Speech recognizer',
    pattern: /new SpeechRecognition\(|webkitSpeechRecognition/,
    keys: ['NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription'],
  },
]

describe('iOS Info.plist purpose strings', () => {
  const strings = plistStrings(fs.readFileSync(path.join(ROOT, PLIST), 'utf8'))

  it('parses, and still carries the keys it had before', () => {
    expect(strings.CFBundleDisplayName).toBe('AllFantasy')
    expect(strings.UILaunchStoryboardName).toBe('LaunchScreen')
  })

  it.each([
    'NSCameraUsageDescription',
    'NSMicrophoneUsageDescription',
    'NSPhotoLibraryUsageDescription',
    'NSPhotoLibraryAddUsageDescription',
    'NSSpeechRecognitionUsageDescription',
  ])('%s is a specific sentence that names AllFantasy or Chimmy', (key) => {
    const s = strings[key]
    expect(s, `${key} missing from ${PLIST}`).toBeTruthy()
    // Apple rejects generic strings ("This app needs the camera"): say what it is used for.
    expect(s.length).toBeGreaterThanOrEqual(60)
    expect(s).toMatch(/AllFantasy|Chimmy/)
    expect(s).toMatch(/only when you|when you ask|when you choose/i)
  })

  it('declares every key the web source can trigger inside the app', () => {
    for (const t of TRIGGERS) {
      const hits = filesMatching(t.pattern)
      if (hits.length === 0) continue
      for (const key of t.keys) {
        expect(strings[key], `${hits[0]} uses ${t.what}, which needs ${key} in ${PLIST}`).toBeTruthy()
      }
    }
  })

  it('the census finds the triggers that exist today (positive control)', () => {
    const found = (re: RegExp) => filesMatching(re).length > 0
    expect(found(TRIGGERS[0].pattern)).toBe(true) // profile picture, Chimmy attachments
    expect(found(TRIGGERS[3].pattern)).toBe(true) // Chimmy voice input
    expect(found(TRIGGERS[2].pattern)).toBe(true) // chat voice messages
  })
})
