'use client'

import { useEffect, useRef, useState } from 'react'
import type { HighlightAction } from '@/lib/analytics/highlights'
import type { XPost } from '@/lib/highlights/x-types'
import { messagesFor } from '@/lib/i18n/messages'
import { coreWidgetsMessages } from '@/lib/core-app/messages/coreWidgets'
import { langFromFlag } from '@/lib/core-app/messages/coreLocale'

type Widgets = { createTweet(id: string, target: HTMLElement, options: Record<string, unknown>): Promise<HTMLElement | undefined> }
let loader: Promise<Widgets> | null = null
function loadWidgets(): Promise<Widgets> {
  const getWidgets = () => (window as unknown as { twttr?: { widgets?: Widgets } }).twttr?.widgets
  const existing = getWidgets()
  if (existing) return Promise.resolve(existing)
  if (loader) return loader
  loader = new Promise<Widgets>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://platform.twitter.com/widgets.js'
    script.async = true
    const timeout = window.setTimeout(() => { script.remove(); reject(new Error('X embed timed out')) }, 12000)
    script.onload = () => {
      window.clearTimeout(timeout)
      const widgets = getWidgets()
      if (widgets) resolve(widgets)
      else { script.remove(); reject(new Error('X embed unavailable')) }
    }
    script.onerror = () => { window.clearTimeout(timeout); script.remove(); reject(new Error('X embed unavailable')) }
    document.head.appendChild(script)
  }).catch(error => { loader = null; throw error })
  return loader
}

export default function XPostEmbed({ post, es = false, onEvent }: { post: XPost; es?: boolean; onEvent?: (action: HighlightAction, post: XPost) => void }) {
  const m = messagesFor(coreWidgetsMessages, langFromFlag(es))
  const [requested, setRequested] = useState(false)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const target = useRef<HTMLDivElement>(null)
  const eventHandler = useRef(onEvent)
  eventHandler.current = onEvent
  const postRef = useRef(post)
  postRef.current = post
  useEffect(() => {
    const currentPost = postRef.current
    if (!requested || !target.current || !/^\d{10,25}$/.test(currentPost.id)) return
    let active = true
    const element = target.current
    // Use a detached mount per request so late embed completion cannot affect another clip.
    const mount = document.createElement('div')
    element.replaceChildren(mount)
    setState('loading')
    loadWidgets().then(widgets => {
      if (!active) return
      return widgets.createTweet(currentPost.id, mount, { theme: 'dark', dnt: true, conversation: 'none', align: 'center' })
    }).then(result => {
      if (active) { setState(result ? 'ready' : 'error'); eventHandler.current?.(result ? 'embed_ready' : 'embed_error', currentPost) }
    }).catch(() => { if (active) { setState('error'); eventHandler.current?.('embed_error', currentPost) } })
    return () => { active = false; mount.remove() }
  }, [requested, post.id])
  const url = 'https://x.com/' + encodeURIComponent(post.account) + '/status/' + post.id
  return <div className="af-x-embed">
    {!requested ? <button type="button" onClick={() => { onEvent?.('load_requested', post); setRequested(true) }}>{m.xPostLoad}</button> : null}
    <div ref={target} />
    <div role="status" aria-live="polite">
      {state === 'loading' ? <p>{m.xPostLoading}</p> : null}
      {state === 'error' ? <p>{m.xPostError}</p> : null}
    </div>
    <a href={url} onClick={() => onEvent?.('source_open', post)} target="_blank" rel="noopener noreferrer">{m.xPostWatch} ↗</a>
  </div>
}

