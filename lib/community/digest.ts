/**
 * The weekly Clubhouse email. Opt-in only (`EmailPreference.weeklyDigest`, which nothing else
 * sends on), and it is skipped entirely in a week with nothing worth reading: an email that
 * says "nothing happened" teaches people to ignore the next one.
 *
 * Pure: the content and layout. `digestRunner.ts` gathers the week and sends it.
 */

export type DigestIdea = { id: string; title: string; hook: string; upvotes: number; author: string }
export type DigestMove = { id: string; title: string; status: 'building' | 'shipped'; author: string }
export type DigestThread = { id: string; title: string; replies: number; channelLabel: string }

export type DigestWeek = {
  weekLabel: string
  newIdeas: DigestIdea[]
  moves: DigestMove[]
  topThreads: DigestThread[]
  memberPosts: number
}

/** Worth an email: something moved, an idea arrived, or a thread got going. */
export function digestHasNews(w: DigestWeek): boolean {
  return w.newIdeas.length > 0 || w.moves.length > 0 || w.topThreads.some((t) => t.replies > 0)
}

export function digestWeekKey(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dow = (d.getUTCDay() + 6) % 7 // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

/** Monday, from 15:00 UTC (late morning US East), through Tuesday: one window, retried until done. */
export function inDigestWindow(now: Date): boolean {
  const dow = now.getUTCDay()
  if (dow === 1) return now.getUTCHours() >= 15
  return dow === 2
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function buildDigestEmail(w: DigestWeek, opts: { origin: string; unsubscribeUrl: string }): {
  subject: string
  html: string
  text: string
} {
  const url = (path: string) => `${opts.origin}${path}`
  const post = (id: string) => url(`/clubhouse/post/${encodeURIComponent(id)}`)
  const shipped = w.moves.filter((m) => m.status === 'shipped')
  const subject = shipped.length
    ? `Shipped from League Lab: ${shipped[0]!.title}`
    : w.newIdeas.length
      ? `${w.newIdeas.length} new league idea${w.newIdeas.length === 1 ? '' : 's'} in the Clubhouse`
      : 'This week in the Clubhouse'

  const h3 = (t: string) => `<h3 style="margin:22px 0 8px;font-size:15px">${esc(t)}</h3>`
  const link = (href: string, t: string) => `<a href="${esc(href)}" style="color:#0b7bd6;font-weight:600;text-decoration:none">${esc(t)}</a>`
  const moves = w.moves.length
    ? h3('Moving forward') +
      w.moves.map((m) => `<p style="margin:4px 0">${m.status === 'shipped' ? '🚀 Shipped' : '🛠️ Building'}: ${link(post(m.id), m.title)} <span style="color:#666">pitched by ${esc(m.author)}</span></p>`).join('')
    : ''
  const ideas = w.newIdeas.length
    ? h3('New in League Lab') +
      w.newIdeas.map((i) => `<p style="margin:6px 0">${link(post(i.id), i.title)} <span style="color:#666">by ${esc(i.author)} · ▲ ${i.upvotes}</span><br><span style="color:#333">${esc(i.hook)}</span></p>`).join('')
    : ''
  const threads = w.topThreads.filter((t) => t.replies > 0)
  const talk = threads.length
    ? h3('Busiest threads') +
      threads.map((t) => `<p style="margin:4px 0">${link(post(t.id), t.title)} <span style="color:#666">${esc(t.channelLabel)} · ${t.replies} repl${t.replies === 1 ? 'y' : 'ies'}</span></p>`).join('')
    : ''

  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111;line-height:1.5">
<p style="margin:0;color:#666;font-size:13px">The Clubhouse · week of ${esc(w.weekLabel)}</p>
<h2 style="margin:4px 0 12px">This week in the Clubhouse</h2>
${moves}${ideas}${talk}
<p style="margin:26px 0 0"><a href="${esc(url('/clubhouse/league-lab'))}" style="display:inline-block;background:#111;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">Upvote ideas in League Lab</a></p>
<p style="margin:28px 0 0;color:#888;font-size:12px">You get this because you turned on the weekly Clubhouse email. <a href="${esc(opts.unsubscribeUrl)}" style="color:#888">Unsubscribe</a></p>
</div>`

  const lines = (title: string, items: string[]) => (items.length ? ['', title, ...items] : [])
  const text = [
    `This week in the Clubhouse (week of ${w.weekLabel})`,
    ...lines('Moving forward', w.moves.map((m) => `- ${m.status === 'shipped' ? 'Shipped' : 'Building'}: ${m.title} (pitched by ${m.author}) ${post(m.id)}`)),
    ...lines('New in League Lab', w.newIdeas.map((i) => `- ${i.title} by ${i.author}: ${i.hook} ${post(i.id)}`)),
    ...lines('Busiest threads', threads.map((t) => `- ${t.title} (${t.replies} replies) ${post(t.id)}`)),
    '',
    `Upvote ideas: ${url('/clubhouse/league-lab')}`,
    `Unsubscribe: ${opts.unsubscribeUrl}`,
  ].join('\n')
  return { subject, html, text }
}
