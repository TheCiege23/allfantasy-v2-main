export type VoteChoice = 'yes' | 'no' | 'abstain'
export type VoteDenominator = 'votes_cast' | 'eligible_owners'
export function tallyUniverseVote(electorate: readonly string[], ballots: readonly { userId: string; choice: VoteChoice }[], denominator: VoteDenominator) {
  if (!electorate.length || new Set(electorate).size !== electorate.length || new Set(ballots.map(b => b.userId)).size !== ballots.length || ballots.some(b => !electorate.includes(b.userId) || !['yes', 'no', 'abstain'].includes(b.choice))) throw new Error('Invalid electorate or ballots')
  if (!['votes_cast', 'eligible_owners'].includes(denominator)) throw new Error('Select an explicit voting denominator')
  const yes = ballots.filter(b => b.choice === 'yes').length, no = ballots.filter(b => b.choice === 'no').length, abstain = ballots.length - yes - no
  const counted = denominator === 'votes_cast' ? yes + no : electorate.length
  return { yes, no, abstain, uncast: electorate.length - ballots.length, counted, required: Math.ceil(counted * .75), passed: counted > 0 && yes * 4 >= counted * 3 }
}
