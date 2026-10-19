/** Client-safe swap copy (no Node imports), so client components can use it without bundling node:crypto. */

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve']

export function swapHeadline(movedCount: number): string {
  const word = NUMBER_WORDS[movedCount] ?? String(movedCount)
  return `${word} manager${movedCount === 1 ? '' : 's'} changed tribes`
}
