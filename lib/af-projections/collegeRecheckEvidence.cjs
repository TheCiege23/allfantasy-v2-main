const { prisma } = require('../prisma')
const { riFetchRows } = require('../workers/providers/rollingInsightsRest')
const { getFantraxPlayerIds } = require('../league-import/fantrax/fantraxApi')
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
async function readSource(load) {
  try { return await load() }
  catch (err) {
    if (err.name !== 'TimeoutError' && err.name !== 'AbortError' && err.name !== 'TypeError' && !/HTTP 5\d\d/.test(err.message)) throw err
    await new Promise(resolve => setTimeout(resolve, 1500))
    return load()
  }
}

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(25000) })
  if (!r.ok) throw Error('ESPN HTTP ' + r.status)
  return r.json()
}

async function sources(group, season, warnings) {
  const { sport, players } = group
  const [feed, directory] = await Promise.allSettled([
    riFetchRows('player_stats', { sport, season }),
    getFantraxPlayerIds(sport === 'NCAAF' ? 'CFB' : 'NCAAB')
  ])
  const ri = feed.status === 'fulfilled' && !feed.value.error && feed.value.rows?.length ? feed.value.rows : null
  const refs = directory.status === 'fulfilled' && directory.value.ok ? Object.values(directory.value.data) : null
  if (!ri) warnings.push(sport + ': season-stat feed unavailable')
  if (!refs) warnings.push(sport + ': player directory unavailable')
  const evidence = {}
  await Promise.all(players.map(async ([id, name, riId, espnId]) => {
    const candidates = (ri ?? []).filter(r => String(r.player_id) === riId || normalize(r.player) === normalize(name))
    const ref = refs?.find(r => r.fantraxId === id)
    const e = evidence[id] = {
      directory: ref ? { name: ref.name, team: ref.team, position: ref.position } : null,
      seasonLines: candidates.map(r => ({ id: String(r.player_id), name: r.player, team: r.team, totals: r.regular_season })),
    }
    if (espnId) {
      const url = 'https://site.web.api.espn.com/apis/common/v3/sports/football/college-football/athletes/' + espnId + '/gamelog?season=' + season
      try {
        const log = await readSource(() => getJson(url))
        e.gameLog = { url, events: Object.values(log.events ?? {}).map(g => ({ id: g.id, date: g.gameDate, team: g.team?.abbreviation })) }
      } catch (err) { warnings.push(name + ': ' + err.message) }
    }
  }))
  return evidence
}

const footballSchools = {
  '076fw':'goblueraiders.com', '063i6':'ballstatesports.com', '07814':'gotigersgo.com', '076ox':'ragincajuns.com',
  '077fz':'uhcougars.com', '076vy':'broncosports.com', '076oo':'ohiobobcats.com', '076l6':'okstate.com',
  '076hz':'nmstatesports.com', '074o5':'goheels.com',
}
async function schoolStats(id, name, season) {
  const url = 'https://' + footballSchools[id] + '/sports/football/stats/' + season
  const res = await fetch(url, { signal: AbortSignal.timeout(25000) })
  if (!res.ok) throw Error('HTTP ' + res.status)
  const html = await res.text()
  const payload = html.match(/id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!payload) {
    const { parse } = await import('parse5')
    const lines = []
    let tables = 0
    const children = (node, tag) => (node?.childNodes ?? []).filter(n => n.tagName === tag)
    function text(node) {
      return node.value ?? (node.childNodes ?? []).map(text).join('')
    }
    function visit(node) {
      if (node.tagName === 'table') {
        const headerRow = children(children(node, 'thead')[0], 'tr').at(-1)
        const header = children(headerRow, 'th').map(n => text(n).trim())
        const gp = header.indexOf('GP'), player = header.indexOf('Player')
        if (gp >= 0 && player >= 0) {
          tables++
          for (const body of children(node, 'tbody')) for (const row of children(body, 'tr')) {
            const cells = row.childNodes.filter(n => ['th','td'].includes(n.tagName)).map(n => text(n).trim())
            const label = cells[player] ?? ''
            const spelling = label.includes(',') ? label.split(',').reverse().map(w => w.trim()).join(' ') : label
            if (normalize(spelling) === normalize(name) && /^\d+$/.test(cells[gp])) {
              lines.push({ ...Object.fromEntries(header.map((k,i) => [k,cells[i]])), gamesPlayed: cells[gp], playerName: label })
            }
          }
        }
      }
      for (const child of node.childNodes ?? []) visit(child)
    }
    visit(parse(html))
    return { url, status: tables ? 'read' : 'manual_source', lines }
  }
  const values = JSON.parse(payload[1])
  const lines = []
  for (const record of values) {
    const label = values[record?.playerName]
    if (typeof label !== 'string') continue
    const spelling = label.includes(',') ? label.split(',').reverse().map(w => w.trim()).join(' ') : label
    if (normalize(spelling) !== normalize(name)) continue
    const fields = {}
    for (const [key, ix] of Object.entries(record)) {
      if (key === 'playerName' || key === 'gamesPlayed' || key === 'playerRosterBioId' ||
          (!key.startsWith('player') && key !== 'nameFromStats' && key !== 'isAFooterStat')) {
        if (Number.isInteger(ix) && ix >= 0 && ['string','number'].includes(typeof values[ix])) fields[key] = values[ix]
      }
    }
    if (fields.gamesPlayed) lines.push(fields)
  }
  return { url, status: 'read', lines }
}

async function databaseEvidence(group, season, evidence) {
  if (group.sport === 'NCAAF') {
    const names = group.players.flatMap(p => [p[1], p[4]].filter(Boolean))
    const lines = await prisma.fantasyStatLine.findMany({
      where: { sport:'NCAAF', season:String(season), source:'cfbd', week:0,
        OR:names.flatMap(name => ['name','riPlayerName'].map(key => ({ stats: { path:[key], equals:name } }))) },
      select:{playerId:true,team:true,stats:true},
    })
    for (const [id,name,,,alias] of group.players) {
      evidence[id].cfbd = lines.filter(l => [normalize(name), normalize(alias ?? name)].includes(normalize(l.stats?.riPlayerName ?? l.stats?.name)))
        .map(l => ({playerId:l.playerId,team:l.team,position:l.stats.position,totals:l.stats.regular_season}))
    }
  } else {
    const identities = await prisma.playerIdentityMap.findMany({where:{sport:'NCAAB',OR:group.players.flatMap(([id,name]) => [
      {fantraxId:id},{canonicalName:{equals:name,mode:'insensitive'}}])},select:{id:true,fantraxId:true,canonicalName:true,currentTeam:true}})
    const appearances = await prisma.playerGameStat.groupBy({by:['playerId','team'],
      where:{sportType:'NCAAB',season,source:'rolling_insights_live',playerId:{in:identities.map(i => i.id)},
        gameDate:{lt:new Date(new Date().toISOString().slice(0,10))},
        AND:[{normalizedStatMap:{path:['seasonType'],equals:'regular'}},{normalizedStatMap:{path:['stats','minutes'],gt:0}}]},_count:{_all:true}})
    for (const [id,name] of group.players) evidence[id].collegeBoxes = appearances.flatMap(a => {
      const row = identities.find(i => i.id === a.playerId && (i.fantraxId === id || normalize(i.canonicalName) === normalize(name)))
      return row ? [{playerId:row.id,team:a.team,games:a._count._all}] : []
    })
  }
}

module.exports = { normalize, sources, databaseEvidence, readSource, schoolStats }
