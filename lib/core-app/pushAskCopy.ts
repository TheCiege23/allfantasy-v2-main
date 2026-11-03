import { messagesFor } from '@/lib/i18n/messages'
import { pushAskMessages } from './messages/pushAsk'

/**
 * Words for the in-context push ask (components/core-app/player-finder/PushAsk.tsx, 2026-10-10).
 * Pure, client-safe; English and Spanish. The words live in lib/core-app/messages/pushAsk.ts.
 */

export type PushAskPlacement = 'follow' | 'finder_home'

export type PushAskCopy = {
  title: Record<PushAskPlacement, string>
  body: Record<PushAskPlacement, string>
  turnOn: string
  working: string
  notNow: string
  on: string
  iphone: string
  failed: string
}

const built = new WeakMap<object, PushAskCopy>()

export function pushAskCopy(language: string): PushAskCopy {
  // The catalog holds en and es only, so anything that is not Spanish reads English, as before.
  const m = messagesFor(pushAskMessages, language)
  let copy = built.get(m)
  if (!copy) {
    copy = {
      title: { follow: m.titleFollow, finder_home: m.titleFinderHome },
      body: { follow: m.bodyFollow, finder_home: m.bodyFinderHome },
      turnOn: m.turnOn,
      working: m.working,
      notNow: m.notNow,
      on: m.on,
      iphone: m.iphone,
      failed: m.failed,
    }
    built.set(m, copy)
  }
  return copy
}
