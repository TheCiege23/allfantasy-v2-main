// Renders single-image AllFantasy posts (1080x1350) from a JSON spec.
// Usage: node marketing/social/render-daily.mjs marketing/social/posts/2026-10-15.json   -> out/daily/2026-10-15/post-N.png
// Spec: { date, posts: [{ kind: 'hero'|'shipped'|'poll'|'list', accent, eyebrow, title, lead, big, bullets, options, art, cta, caption }] }
// In `title`, wrap words in [brackets] to color them with the accent.
const { chromium } = await import('playwright').catch(() => import('/opt/node22/lib/node_modules/playwright/index.mjs'))
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const DIR = path.dirname(new URL(import.meta.url).pathname)
const A = (p) => pathToFileURL(path.join(DIR, '..', '..', 'public', p)).href
const ACCENTS = { cyan: '#3BC4FF', orange: '#FF8A3D', ice: '#9FE7FF', green: '#38E08F', red: '#FF5A6E', gold: '#FFC94D', purple: '#B48CFF' }
const esc = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const hl = (s = '') => esc(s).replace(/\[([^\]]+)\]/g, '<span class="ac">$1</span>').replace(/\n/g, '<br/>')

const CSS = (ac) => `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800;900&display=block');
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;height:1350px;overflow:hidden}
body{font-family:Inter,'Noto Color Emoji',sans-serif;color:#EAF4FF;background:#030817;position:relative;--ac:${ac}}
.bg{position:absolute;inset:0;background:
  radial-gradient(900px 700px at 85% -10%, color-mix(in srgb,var(--ac) 42%,transparent), transparent 60%),
  radial-gradient(800px 700px at -10% 110%, rgba(1,41,103,.9), transparent 65%),
  linear-gradient(180deg,#041029 0%,#030817 100%)}
.grid{position:absolute;inset:0;opacity:.07;background-image:linear-gradient(#5cc8ff 1px,transparent 1px),linear-gradient(90deg,#5cc8ff 1px,transparent 1px);background-size:60px 60px;mask-image:linear-gradient(180deg,transparent,#000 30%,#000 70%,transparent)}
.wrap{position:absolute;inset:0;padding:96px 84px 180px;display:flex;flex-direction:column;justify-content:center}
.eyebrow{font-weight:800;letter-spacing:.22em;text-transform:uppercase;font-size:24px;color:var(--ac);display:flex;align-items:center;gap:14px}
.eyebrow:before{content:'';width:40px;height:4px;background:var(--ac);border-radius:2px}
.pill{align-self:flex-start;font-weight:900;letter-spacing:.16em;font-size:24px;text-transform:uppercase;background:var(--ac);color:#03122b;padding:12px 22px;border-radius:999px}
h1{font-family:Anton,Impact,sans-serif;font-weight:400;text-transform:uppercase;line-height:.95;font-size:112px;margin-top:26px}
h1.xl{font-size:140px}
.ac{color:var(--ac)}
.big{margin-top:44px;font-family:Anton,'Noto Color Emoji';font-size:340px;line-height:.85;color:var(--ac)}
.emoji{margin-top:30px;font-family:'Noto Color Emoji';font-size:190px;line-height:1}
p.lead{font-size:38px;line-height:1.35;color:#C6D6EA;font-weight:500;margin-top:34px;max-width:900px}
.card{background:linear-gradient(180deg,rgba(18,40,78,.92),rgba(8,20,44,.92));border:2px solid color-mix(in srgb,var(--ac) 30%,transparent);border-radius:30px}
.list{display:flex;flex-direction:column;gap:18px;margin-top:46px}
.li{display:flex;gap:22px;align-items:flex-start;padding:26px 30px;font-size:33px;line-height:1.3;font-weight:600}
.li b{flex:none;width:46px;height:46px;border-radius:50%;background:var(--ac);color:#03122b;display:grid;place-items:center;font-size:26px;font-weight:900}
.li small{display:block;font-size:25px;color:#8FA6C4;font-weight:500;margin-top:6px}
.opt{display:flex;align-items:center;gap:22px;padding:22px 30px;font-size:38px;font-weight:800}
.opt span{font-family:'Noto Color Emoji';font-size:46px}
.opt i{margin-left:auto;font-style:normal;font-family:Anton;font-size:40px;color:var(--ac)}
.foot{position:absolute;left:84px;right:84px;bottom:58px;display:flex;align-items:center;justify-content:space-between;font-weight:800;font-size:26px;color:#9FB6D3}
.brand{display:flex;align-items:center;gap:14px;color:#EAF4FF}.brand img{height:54px}
.cta{color:var(--ac);letter-spacing:.06em}
`
const ART = (f) => `<div style="position:absolute;inset:0;background:url('${A(f)}') center 30%/cover"></div>
<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(3,8,23,.2),rgba(3,8,23,.1) 30%,rgba(3,8,23,.9) 62%,#030817 80%)"></div>`

function body(p) {
  const head = `${p.pill ? `<div class="pill">${esc(p.pill)}</div>` : ''}${p.eyebrow ? `<div class="eyebrow" style="${p.pill ? 'margin-top:30px' : ''}">${esc(p.eyebrow)}</div>` : ''}`
  const lead = p.lead ? `<p class="lead">${hl(p.lead)}</p>` : ''
  const bullets = p.bullets ? `<div class="list">${p.bullets.map((b, i) => {
    const [t, s] = Array.isArray(b) ? b : [b]
    return `<div class="card li"><b>${p.kind === 'shipped' ? '✓' : i + 1}</b><div>${esc(t)}${s ? `<small>${esc(s)}</small>` : ''}</div></div>`
  }).join('')}</div>` : ''
  const options = p.options ? `<div class="list" style="gap:14px">${p.options.map(([e, t], i) => `<div class="card opt"><span>${e}</span>${esc(t)}<i>${'ABCDEFG'[i]}</i></div>`).join('')}</div>` : ''
  const big = p.big ? `<div class="${/^[\p{Extended_Pictographic}]/u.test(p.big) ? 'emoji' : 'big'}">${esc(p.big)}</div>` : ''
  const top = p.art ? '<div style="margin-top:auto"></div>' : ''
  return `${top}${head}${big}<h1 class="${p.titleSize === 'xl' ? 'xl' : ''}">${hl(p.title)}</h1>${lead}${bullets}${options}`
}

const html = (p) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS(ACCENTS[p.accent] || p.accent || ACCENTS.cyan)}</style></head><body>
<div class="bg"></div>${p.art ? ART(p.art) : ''}<div class="grid"></div>
<div class="wrap">${body(p)}</div>
<div class="foot"><div class="brand"><img src="${A('af-crest.svg')}"/>ALLFANTASY.AI</div><div class="cta">${esc(p.cta || 'LINK IN BIO →')}</div></div></body></html>`

const specPath = process.argv[2]
const spec = JSON.parse(readFileSync(specPath, 'utf8'))
const outDir = path.join(DIR, 'out', 'daily', spec.date)
mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch()
const pg = await browser.newPage({ viewport: { width: 1080, height: 1350 } })
let captions = `# AllFantasy posts for ${spec.date}\n\n`
for (const [i, p] of spec.posts.entries()) {
  const f = path.join(outDir, `_tmp.html`)
  writeFileSync(f, html(p))
  await pg.goto(pathToFileURL(f).href, { waitUntil: 'networkidle' })
  await pg.evaluate(() => document.fonts.ready)
  await pg.screenshot({ path: path.join(outDir, `post-${i + 1}.png`) })
  captions += `## Post ${i + 1}${p.slot ? ` · ${p.slot}` : ''}\n\n${p.caption || ''}\n\n---\n\n`
}
rmSync(path.join(outDir, '_tmp.html'), { force: true })
writeFileSync(path.join(outDir, 'CAPTIONS.md'), captions)
await browser.close()
console.log('rendered', spec.posts.length, '->', outDir)
