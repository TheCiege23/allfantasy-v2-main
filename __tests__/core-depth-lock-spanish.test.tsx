/**
 * The /core depth paywall — CoreDepthLock, CoreDepthGate and FreeUntilNote — in the reader's language
 * (2026-10-06), one translation shared by every gated surface (lib/core-app/coreDepthLockCopy.ts).
 *
 * Three things are held here:
 *   1. ENGLISH IS BYTE-IDENTICAL. The markup below was captured from the component before it was
 *      translated; a caller that passes no `lang` gets exactly that.
 *   2. ONLY THE WORDS CHANGE. A free reader, a pre-launch reader and a paying reader each render the
 *      same elements, attributes, link targets and children in English and in Spanish — compared with
 *      every text node and the aria-label (which is text) taken out. Who sees the lock, and where its
 *      button goes, does not read the language.
 *   3. EVERY CALLER IS CENSUSED. Each file that imports the component (any import form) passes `lang`
 *      on every tag and names its subject through a translator, or is on a short list that says why
 *      not. A new caller with a bare English `what="…"` fails here instead of shipping half Spanish.
 */
import React from 'react'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'

import { CoreDepthGate, CoreDepthLock, FreeUntilNote } from '@/components/core-app/CoreDepthLock'
import { CORE_DEPTH, decideCoreDepth, type CoreDepth, type CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import { LOCK_SUBJECT_KEYS, depthLabelText, lockSubjectText, tradingForSubject } from '@/lib/core-app/coreDepthLockCopy'
import { finderPlayerInfoCopy } from '@/lib/core-app/finderPlayerInfoCopy'

afterEach(cleanup)

const STARTS = new Date('2026-10-15T04:00:00.000Z')
const DEPTHS = Object.keys(CORE_DEPTH) as CoreDepth[]
/** The three readers, through the real decision: after launch without the plan, before launch without it, with it. */
const free = (d: CoreDepth) => decideCoreDepth(d, { live: true, startsAt: STARTS, hasPlan: false })
const preLaunch = (d: CoreDepth) => decideCoreDepth(d, { live: false, startsAt: STARTS, hasPlan: false })
const paid = (d: CoreDepth) => decideCoreDepth(d, { live: true, startsAt: STARTS, hasPlan: true })

const EN_WORDS = /\b(is|are|part of|not included|your|account|leagues|scores|basics|stay|free|Free|Upgrade|the rest|all here|See|until|then|Oct)\b/

/* ── 1. English, byte for byte ────────────────────────────────────────────────────────────────── */

describe('English is unchanged', () => {
  it('the lock, for every depth, with its own label and with a caller’s subject (singular and plural)', () => {
    const html = (a: CoreDepthAccess, what?: string, lang?: string) => {
      const { container, unmount } = render(<CoreDepthLock access={a} what={what} lang={lang} />)
      const out = container.innerHTML
      unmount()
      return out
    }
    expect(html(free('player_depth'))).toMatchInlineSnapshot(`"<section class="af-core-lock" data-testid="core-lock-player_depth" aria-label="Player deep dives — AF Pro"><p class="af-core-lock-head"><svg class="af-core-lock-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg><span data-ios-purchase="true">Player deep dives are part of AF Pro</span><span data-ios-purchase-alt="true">Player deep dives are not included with your account</span></p><p class="af-core-lock-body"><span data-ios-purchase="true">Your leagues, scores and the basics stay free. Upgrade to see the rest.</span><span data-ios-purchase-alt="true">Your leagues, scores and the basics are all here.</span></p><a class="af-core-lock-cta" href="/upgrade?plan=pro" data-ios-purchase="true">See AF Pro</a></section>"`)
    expect(html(free('trade_depth'), 'The full trade breakdown')).toMatchInlineSnapshot(`"<section class="af-core-lock" data-testid="core-lock-trade_depth" aria-label="The full trade breakdown — AF Pro"><p class="af-core-lock-head"><svg class="af-core-lock-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg><span data-ios-purchase="true">The full trade breakdown is part of AF Pro</span><span data-ios-purchase-alt="true">The full trade breakdown is not included with your account</span></p><p class="af-core-lock-body"><span data-ios-purchase="true">Your leagues, scores and the basics stay free. Upgrade to see the rest.</span><span data-ios-purchase-alt="true">Your leagues, scores and the basics are all here.</span></p><a class="af-core-lock-cta" href="/upgrade?plan=pro" data-ios-purchase="true">See AF Pro</a></section>"`)
    expect(html(free('commissioner_depth'), 'Member activity')).toMatchInlineSnapshot(`"<section class="af-core-lock" data-testid="core-lock-commissioner_depth" aria-label="Member activity — AF Commissioner"><p class="af-core-lock-head"><svg class="af-core-lock-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg><span data-ios-purchase="true">Member activity is part of AF Commissioner</span><span data-ios-purchase-alt="true">Member activity is not included with your account</span></p><p class="af-core-lock-body"><span data-ios-purchase="true">Your leagues, scores and the basics stay free. Upgrade to see the rest.</span><span data-ios-purchase-alt="true">Your leagues, scores and the basics are all here.</span></p><a class="af-core-lock-cta" href="/upgrade?plan=commissioner" data-ios-purchase="true">See AF Commissioner</a></section>"`)
    expect(html(free('competitive_edge'))).toMatchInlineSnapshot(`"<section class="af-core-lock" data-testid="core-lock-competitive_edge" aria-label="Competitive Edge — AF Pro"><p class="af-core-lock-head"><svg class="af-core-lock-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg><span data-ios-purchase="true">Competitive Edge is part of AF Pro</span><span data-ios-purchase-alt="true">Competitive Edge is not included with your account</span></p><p class="af-core-lock-body"><span data-ios-purchase="true">Your leagues, scores and the basics stay free. Upgrade to see the rest.</span><span data-ios-purchase-alt="true">Your leagues, scores and the basics are all here.</span></p><a class="af-core-lock-cta" href="/upgrade?plan=pro" data-ios-purchase="true">See AF Pro</a></section>"`)
    expect(html(free('player_depth'), 'Suggested FAAB bids')).toMatchInlineSnapshot(`"<section class="af-core-lock" data-testid="core-lock-player_depth" aria-label="Suggested FAAB bids — AF Pro"><p class="af-core-lock-head"><svg class="af-core-lock-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2M3.5 7h9a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg><span data-ios-purchase="true">Suggested FAAB bids are part of AF Pro</span><span data-ios-purchase-alt="true">Suggested FAAB bids are not included with your account</span></p><p class="af-core-lock-body"><span data-ios-purchase="true">Your leagues, scores and the basics stay free. Upgrade to see the rest.</span><span data-ios-purchase-alt="true">Your leagues, scores and the basics are all here.</span></p><a class="af-core-lock-cta" href="/upgrade?plan=pro" data-ios-purchase="true">See AF Pro</a></section>"`)
    // `lang="en"` and no `lang` are the same thing.
    for (const d of DEPTHS) {
      expect(html(free(d), undefined, 'en')).toBe(html(free(d)))
      expect(html(free(d), 'Recommended moves', 'en')).toBe(html(free(d), 'Recommended moves'))
    }
  })

  it('the "Free until" note, and the gate around a paying reader’s children', () => {
    const note = render(<FreeUntilNote access={preLaunch('player_depth')} />)
    expect(note.container.innerHTML).toMatchInlineSnapshot(`"<span class="af-core-free-until" data-testid="core-free-until-player_depth" data-ios-purchase="true">Free until Oct 15 — then AF Pro</span>"`)
    note.unmount()
    const gate = render(
      <CoreDepthGate access={preLaunch('trade_depth')} what="The trade finder">
        <p>child</p>
      </CoreDepthGate>,
    )
    expect(gate.container.innerHTML).toMatchInlineSnapshot(`"<span class="af-core-free-until" data-testid="core-free-until-trade_depth" data-ios-purchase="true">Free until Oct 15 — then AF Pro</span><p>child</p>"`)
  })
})

/* ── Spanish ──────────────────────────────────────────────────────────────────────────────────── */

describe('Spanish', () => {
  it('every depth’s lock reads Spanish whole — head, body, the alt wording and the button', () => {
    for (const d of DEPTHS) {
      const { container, unmount } = render(<CoreDepthLock access={free(d)} lang="es" />)
      const out = [container.textContent, container.querySelector('section')?.getAttribute('aria-label')].join(' | ')
      expect(out, d).not.toMatch(EN_WORDS)
      expect(container.querySelector('[data-ios-purchase].af-core-lock-cta')?.textContent, d).toBe(`Ver ${CORE_DEPTH[d].planName}`)
      expect(out, d).toContain(`${depthLabelText(d, CORE_DEPTH[d].label, 'es')}: parte de ${CORE_DEPTH[d].planName}`)
      expect(out, d).toContain('Mejora tu plan para ver el resto.')
      expect(out, d).toContain('no disponible con tu cuenta')
      unmount()
    }
  })

  it('every depth has its own Spanish label; only the product name Competitive Edge stays', () => {
    for (const d of DEPTHS) {
      const es = depthLabelText(d, CORE_DEPTH[d].label, 'es')
      if (d === 'competitive_edge') expect(es).toBe('Competitive Edge')
      else expect(es, d).not.toBe(CORE_DEPTH[d].label)
      expect(depthLabelText(d, CORE_DEPTH[d].label, 'en')).toBe(CORE_DEPTH[d].label)
    }
  })

  it('the "Free until" note names the day the way the launch countdown does', () => {
    const { container } = render(<FreeUntilNote access={preLaunch('commissioner_depth')} lang="es" />)
    expect(container.textContent).toBe('Gratis hasta el 15 de octubre — luego, AF Commissioner')
  })

  it('every fixed subject a caller names has Spanish, and the subject builders read the language', () => {
    for (const key of LOCK_SUBJECT_KEYS) {
      expect(lockSubjectText(key, 'en')).toBe(key)
      if (key !== 'Competitive Edge') expect(lockSubjectText(key, 'es'), key).not.toBe(key)
    }
    expect(tradingForSubject('Dalton Kincaid', 'en')).toBe('Trading for Dalton Kincaid')
    expect(tradingForSubject('Dalton Kincaid', 'es')).toBe('Intercambiar por Dalton Kincaid')
    expect(finderPlayerInfoCopy('en').wsLockWhat('Cook')).toBe('Which teams would start Cook')
    expect(finderPlayerInfoCopy('es').wsLockWhat('Cook')).toBe('Qué equipos pondrían de titular a Cook')
  })
})

/* ── 2. Only the words change ─────────────────────────────────────────────────────────────────── */

/** The DOM with every text node and the aria-label (text) removed: elements, classes, hrefs, data-*. */
function skeleton(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement
  const walker = clone.ownerDocument.createTreeWalker(clone, 4 /* SHOW_TEXT */)
  const texts: Node[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n)
  texts.forEach((n) => n.parentNode?.removeChild(n))
  clone.querySelectorAll('[aria-label]').forEach((n) => n.removeAttribute('aria-label'))
  return clone.innerHTML
}

describe('only the words follow the language — never who is locked, nor where the button goes', () => {
  const readers: Array<[string, (d: CoreDepth) => CoreDepthAccess]> = [
    ['free reader', free],
    ['pre-launch reader', preLaunch],
    ['paying reader', paid],
  ]

  it('the gate, every depth, every reader: the same markup in English and Spanish, text aside', () => {
    for (const d of DEPTHS) {
      for (const [who, make] of readers) {
        const a = make(d)
        const draw = (lang?: string) =>
          render(
            <CoreDepthGate access={a} what={lang === 'es' ? lockSubjectText('Recommended moves', 'es') : 'Recommended moves'} lang={lang}>
              <p className="paid-child">the paid part</p>
            </CoreDepthGate>,
          )
        const en = draw()
        const es = draw('es')
        const label = `${d} · ${who}`
        expect(skeleton(es.container), label).toBe(skeleton(en.container))
        // What each reader gets, pinned on its own — the comparison above cannot hide a shared mistake.
        for (const c of [en.container, es.container]) {
          expect(!!c.querySelector('.paid-child'), label).toBe(a.unlocked)
          expect(!!c.querySelector('.af-core-lock'), label).toBe(!a.unlocked)
          expect(!!c.querySelector('.af-core-free-until'), label).toBe(a.unlocked && a.preLaunchFree)
          if (!a.unlocked) expect(c.querySelector('a.af-core-lock-cta')?.getAttribute('href'), label).toBe(CORE_DEPTH[d].upgradePath)
        }
        // And the Spanish really is different words — the comparison is not of two English renders.
        if (!a.unlocked || a.preLaunchFree) expect(es.container.textContent, label).not.toBe(en.container.textContent)
        en.unmount()
        es.unmount()
      }
    }
  })

  it('the lock and the note on their own, every depth, every reader', () => {
    for (const d of DEPTHS) {
      for (const [who, make] of readers) {
        const a = make(d)
        for (const el of [(lang?: string) => <CoreDepthLock access={a} lang={lang} />, (lang?: string) => <FreeUntilNote access={a} lang={lang} />]) {
          const en = render(el())
          const es = render(el('es'))
          expect(skeleton(es.container), `${d} · ${who}`).toBe(skeleton(en.container))
          en.unmount()
          es.unmount()
        }
      }
    }
  })
})

/* ── 3. The census: every caller, every tag ───────────────────────────────────────────────────── */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|jsx?|mjs)$/.test(name)) out.push(p)
  }
  return out
}

/**
 * Callers that draw the lock in English on purpose, and why. Each is a whole surface with no Spanish
 * of its own yet, so a Spanish lock there would be the only Spanish on the screen.
 */
const ENGLISH_ON_PURPOSE: Record<string, string> = {
}
/*
 * The Commissioner OS pages are server components and cannot read the reader's language. The lock
 * itself is drawn by CommissionerDepthLocked, a client component that passes `lang` (2026-10-06);
 * a page's own FreeUntilNote moves to CommissionerFreeUntilNote as each page's group translates it —
 * Mission Control's already has.
 */
const SERVER_PAGES_ENGLISH = /^app\/commissioner-os\//

describe('every caller passes the reader’s language and a translated subject', () => {
  const ROOT = process.cwd()
  const files = ['app', 'components', 'lib']
    .flatMap((d) => walk(join(ROOT, d)))
    .map((p) => p.slice(ROOT.length + 1).replace(/\\/g, '/'))
    .filter((p) => p !== 'components/core-app/CoreDepthLock.tsx')
  // Any import form: alias, relative, dynamic, require, re-export.
  const IMPORTS = /(from\s+['"][^'"]*\/CoreDepthLock['"]|import\(\s*['"][^'"]*\/CoreDepthLock['"]|require\(\s*['"][^'"]*\/CoreDepthLock['"])/
  const callers = files.filter((p) => IMPORTS.test(readFileSync(join(ROOT, p), 'utf8')))

  it('the census found the callers it should (positive control)', () => {
    for (const known of [
      'components/core-app/screens/PlayerFinder.tsx',
      'components/core-app/player-card/PlayerCardSheet.tsx', // a RELATIVE import ('../CoreDepthLock')
      'components/core-app/screens/CommissionerHub.tsx',
      'components/commissioner-os/shell/CommissionerDepthLocked.tsx',
      'components/commissioner-os/shell/CommissionerFreeUntilNote.tsx',
    ]) {
      expect(callers, known).toContain(known)
    }
    /*
     * A floor, not a count. Commissioner OS pages stop importing CoreDepthLock as they move to the
     * shell's language-following CommissionerFreeUntilNote (#2099): 20 direct callers before, 18 once
     * analytics and reports moved, 15 once League Health, Managers and Recommendations moved too, and
     * ~12 when the rest follow. 10 still catches a census
     * that finds nothing.
     */
    expect(callers.length).toBeGreaterThanOrEqual(10)
  })

  it('no re-export hides a caller from this census', () => {
    for (const p of callers) expect(readFileSync(join(ROOT, p), 'utf8'), p).not.toMatch(/export\s*(\*|\{[^}]*\b(CoreDepthLock|CoreDepthGate|FreeUntilNote)\b)/)
  })

  it('each tag passes `lang`, and no subject is a bare English literal', () => {
    const problems: string[] = []
    for (const p of callers) {
      if (ENGLISH_ON_PURPOSE[p] || SERVER_PAGES_ENGLISH.test(p)) continue
      const src = readFileSync(join(ROOT, p), 'utf8')
      const tags = src.match(/<(CoreDepthLock|CoreDepthGate|FreeUntilNote)\b[^>]*>/g) ?? []
      expect(tags.length, p).toBeGreaterThan(0)
      for (const tag of tags) {
        if (!/\blang=\{/.test(tag)) problems.push(`${p}: no lang — ${tag}`)
        if (/\bwhat="/.test(tag)) problems.push(`${p}: an English literal subject — ${tag}`)
      }
    }
    expect(problems).toEqual([])
  })

  it('every subject named through `lockSubjectText` is one it translates', () => {
    for (const p of callers) {
      const src = readFileSync(join(ROOT, p), 'utf8')
      for (const m of src.matchAll(/lockSubjectText\('([^']+)'/g)) expect(LOCK_SUBJECT_KEYS, `${p}: ${m[1]}`).toContain(m[1])
    }
  })

  it('the English-on-purpose list names only real callers', () => {
    for (const p of Object.keys(ENGLISH_ON_PURPOSE)) expect(callers, p).toContain(p)
  })
})
