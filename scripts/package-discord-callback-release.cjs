const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const files = [
  'app/api/auth/discord/callback/route.ts',
  'app/settings/components/sections/ConnectedAccountsSettingsSection.tsx',
  '__tests__/discord-account-callback.test.ts',
  '__tests__/auth-provider-oauth-route-contract.test.ts',
  'components/core-app/comms/CommsDrawer.tsx',
]
const tree = files.map(file => ({ path: file, mode: '100644', type: 'blob',
  content: fs.readFileSync(path.join(root, file.startsWith('components/core-app/comms/') ? 'tmp/huddle-release' : '', file), 'utf8').replace(/\r\n/g, '\n') }))
fs.writeFileSync(path.join(root, 'tmp/discord-callback-tree.json'), JSON.stringify({
  base_tree: 'c2baab889f4b0028efe7d0ffd92691c0573b772d', tree,
}))
console.log(JSON.stringify({ files: files.length }))
