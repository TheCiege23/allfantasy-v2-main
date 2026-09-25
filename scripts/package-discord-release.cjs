const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', 'tmp', 'discord-release-patch')
const files = [
  'components/core-app/AfCoreShell.tsx', 'components/core-app/af-core-shell.css',
  'components/core-app/useLiveRailScores.ts', 'lib/core-app/railMatchups.ts',
  'lib/core-app/liveRailScores.ts', 'lib/core-app/sleeperRailFeed.ts',
  'lib/discord/oauth-config.ts', 'lib/discord/guild-access.ts', 'lib/discord/bot.ts',
  'app/api/core/rail-scores/route.ts', 'app/api/auth/discord/route.ts',
  'app/api/discord/bot-install/route.ts', 'app/api/discord/bot-callback/route.ts',
  'app/settings/components/sections/ConnectedAccountsSettingsSection.tsx',
  '__tests__/live-rail-scores.test.ts', '__tests__/live-rail-route.test.ts',
  '__tests__/live-rail-refresh.test.tsx', '__tests__/discord-bot-install-state.test.ts',
  '__tests__/discord-bot-callback-link.test.ts', '__tests__/discord-guild-access.test.ts',
]
const tree = files.map(file => {
  const content = fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')
  if (content.includes('\0') || /(?:sk_live_|sk-proj-|ghp_|AKIA)[A-Za-z0-9]{12,}/.test(content)) {
    throw new Error(`Release content check failed: ${file}`)
  }
  return { path: file, mode: '100644', type: 'blob', content }
})
const output = path.resolve(root, '..', 'discord-release-tree.json')
fs.writeFileSync(output, JSON.stringify({ base_tree: '853c211cd235486ed9a08be1dc9976822b7718af', tree }))
console.log(JSON.stringify({ files: tree.length, bytes: fs.statSync(output).size, output }))
