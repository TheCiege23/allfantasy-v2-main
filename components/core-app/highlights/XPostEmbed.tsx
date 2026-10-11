'use client'

import { useEffect, useRef, useState } from 'react'
import type { XPost } from '@/lib/highlights/x-types'

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

export default function XPostEmbed({ post, es = false }: { post: XPost; es?: boolean }) {
  const [requested, setRequested] = useState(false)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const target = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!requested || !target.current || !/^\d{10,25}$/.test(post.id)) return
    let active = true
    const element = target.current
    // Use a detached mount per request so late embed completion cannot affect another clip.
    const mount = document.createElement('div')
    element.replaceChildren(mount)
    setState('loading')
    loadWidgets().then(widgets => {
      if (!active) return
      return widgets.createTweet(post.id, mount, { theme: 'dark', dnt: true, conversation: 'none', align: 'center' })
    }).then(result => { if (active) setState(result ? 'ready' : 'error') })
      .catch(() => { if (active) setState('error') })
    return () => { active = false; mount.remove() }
  }, [requested, post.id])
  const url = 'https://x.com/' + encodeURIComponent(post.account) + '/status/' + post.id
  return <div className="af-x-embed">
    {!requested ? <button type="button" onClick={() => setRequested(true)}>{es ? 'Cargar publicación de X' : 'Load X post'}</button> : null}
    <div ref={target} />
    <div role="status" aria-live="polite">
      {state === 'loading' ? <p>{es ? 'Cargando publicación…' : 'Loading post…'}</p> : null}
      {state === 'error' ? <p>{es ? 'Esta publicación no se puede mostrar aquí.' : 'This post could not be displayed here.'}</p> : null}
    </div>
    <a href={url} target="_blank" rel="noopener noreferrer">{es ? 'Ver en X' : 'Watch on X'} ↗</a>
  </div>
}

