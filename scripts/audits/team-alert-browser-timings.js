// Run in DevTools on a signed-in, league-selected AllFantasy My Team page.
// Five sequential GETs only. Results stay in the local console; no private payload is printed.
(async () => {
  if (location.origin !== 'https://www.allfantasy.ai') throw new Error('Open the production AllFantasy site first.')
  const league = new URL(location.href).searchParams.get('league')
  if (!league) throw new Error('Select a league first.')
  const known = new Set(['auth', 'access', 'alerts', 'delivery', 'total'])
  const rows = []
  for (let sample = 1; sample <= 5; sample++) {
    const start = performance.now()
    const response = await fetch('/api/core/team-alerts?' + new URLSearchParams({ league }), { cache: 'no-store', credentials: 'same-origin' })
    const phases = {}
    for (const metric of (response.headers.get('Server-Timing') || '').split(',')) {
      const match = /^\s*([a-z]+);dur=(\d+(?:\.\d+)?)\s*$/.exec(metric)
      if (match && known.has(match[1])) phases[match[1] + 'Ms'] = Number(match[2])
    }
    await response.arrayBuffer() // Consume and discard; do not print or retain roster/receipt data.
    rows.push({ sample, status: response.status, requestMs: Math.round(performance.now() - start), ...phases })
    if (!response.ok) break
  }
  console.table(rows)
  console.info('Phase times overlap. Five samples diagnose requests; they do not establish production p95. Share only this table and device/browser.')
})().catch(() => console.error('Timing check stopped. Use a signed-in league-selected production page; inspect status in Network without sharing private request details.'))
