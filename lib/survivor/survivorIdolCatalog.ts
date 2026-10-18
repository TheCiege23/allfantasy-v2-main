import catalog from './idols/catalog.json'

const aliases: Record<string, string> = {
  vote_shield: 'immunity', protect_self: 'immunity', triple_steal: 'steal-three',
  island_raid: 'steal-three', vote_nullifier: 'idol-nullifier',
}
const actions: Record<string, string> = {
  vote_shield: 'play-idol', extra_vote: 'play-extra-vote', skip_tribal: 'play-skip-tribal', vote_steal: 'play-vote-steal',
}
export function idolDefinition(power: string) {
  const entry = catalog.find(item => item.id === (aliases[power] ?? power.replace(/_/g, '-')))
  // Council Pass is a legacy server power, distinct from the scoring Safety net.
  const fallback = power === 'skip_tribal'
    ? { id: 'safety-net', name: 'Council Pass', power: 'You are safe from being voted out at this council.', when: 'Before votes close', target: 'Yourself', glow: '#38bdf8' }
    : { id: '', name: power.replace(/_/g, ' '), power: 'This advantage is not playable yet.', when: 'Not available yet', target: 'Not available yet', glow: '#cbd5e1' }
  const definition = entry ?? fallback
  return { ...definition, action: actions[power] ?? null, needsTarget: /^(One |Another )/i.test(definition.target) }
}

export type IdolPlayPreview = {
  deadline: string | null
  playable: boolean
  reason: string | null
  targets: Array<{ userId: string; name: string; disabled: boolean; reason: string | null }>
}
