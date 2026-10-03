import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/**
 * TopicTip — the shared `<InfoTip>` "?" filled from lib/core-app/helpTopics.ts. InfoTip's own
 * behaviour (tap, Escape, the native popover) is tested beside it in __tests__/core-info-tip.test.tsx;
 * this pins the words: every topic exists in both languages, and the reader's language is the one shown.
 */

const lang = vi.hoisted(() => ({ language: 'en' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: lang.language }) }))

import { TopicTip } from '@/components/core-app/TopicTip'
import { HELP_TOPICS, helpTopic, type HelpTopicId } from '@/lib/core-app/helpTopics'

afterEach(() => {
  cleanup()
  lang.language = 'en'
})

describe('helpTopics', () => {
  it('every topic has a title and a body in both languages, and the Spanish is not the English', () => {
    for (const [id, t] of Object.entries(HELP_TOPICS)) {
      for (const l of ['en', 'es'] as const) {
        expect(t[l].title.trim(), `${id}.${l}.title`).not.toBe('')
        expect(t[l].body.trim().length, `${id}.${l}.body`).toBeGreaterThan(20)
      }
      expect(t.es.body, id).not.toBe(t.en.body)
    }
  })
  it('anything but Spanish reads English', () => {
    expect(helpTopic('faab', 'fr')).toBe(HELP_TOPICS.faab.en)
    expect(helpTopic('faab', 'es')).toBe(HELP_TOPICS.faab.es)
  })
})

describe('TopicTip', () => {
  it('is the shared InfoTip control, labelled for the term, carrying the topic text', () => {
    const { container } = render(<TopicTip topic="marketRates" />)
    const btn = screen.getByRole('button', { name: `What “${HELP_TOPICS.marketRates.en.title}” means` })
    expect(btn.className).toContain('af-info-tip')
    const pop = container.querySelector('.af-info-pop')!
    expect(btn.getAttribute('popovertarget')).toBe(pop.id)
    expect(pop.textContent).toContain(HELP_TOPICS.marketRates.en.title)
    expect(pop.textContent).toContain('at least 8 leagues')
    /* InfoTip's rule: a paragraph inside the tip is a span, never a <p> — it sits in inline content. */
    expect(pop.querySelector('p')).toBeNull()
    expect(pop.querySelector('.af-info-para')).not.toBeNull()
  })

  it('reads Spanish when the app is in Spanish', () => {
    lang.language = 'es'
    const { container } = render(<TopicTip topic="claimsQueued" />)
    screen.getByRole('button', { name: `Qué significa «${HELP_TOPICS.claimsQueued.es.title}»` })
    expect(container.querySelector('.af-info-pop')!.textContent).toContain(HELP_TOPICS.claimsQueued.es.body)
  })

  it('every topic id renders its own text', () => {
    for (const id of Object.keys(HELP_TOPICS) as HelpTopicId[]) {
      const { container, unmount } = render(<TopicTip topic={id} />)
      expect(container.querySelector('.af-info-pop')!.textContent).toContain(HELP_TOPICS[id].en.body)
      unmount()
    }
  })
})
