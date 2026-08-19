export function getLegacyFeedbackToolLabel(activeTab: string): string | undefined {
  if (activeTab === 'overview') return 'Career Stats / History'
  if (activeTab === 'trade') return 'Trade Hub'
  if (activeTab === 'finder') return 'Trade Finder'
  if (activeTab === 'player-finder') return 'Player Finder'
  if (activeTab === 'waiver') return 'Waiver AI'
  if (activeTab === 'rankings') return 'League Rankings'
  if (activeTab === 'pulse') return 'Social Pulse'
  if (activeTab === 'compare') return 'Rankings / Percentiles'
  if (activeTab === 'chat') return 'Chimmy Chat'
  if (activeTab === 'mock-draft') return 'Mock Draft Room'
  if (activeTab === 'share') return 'Share / Social Cards'
  if (activeTab === 'transfer') return 'League Transfer'
  if (activeTab === 'strategy') return 'Season Strategy'
  if (activeTab === 'shop') return 'AF Merch Shop'
  if (activeTab === 'ideas') return 'Submit League Ideas'
  return undefined
}
