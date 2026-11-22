/** One line for the popup: what each Transaction History file did, in the words of the result AllFantasy returned. */
export function transactionSummary(saved){
 const parts=[]
 const t=saved?.trades,c=saved?.claimDrops
 if(t)parts.push(t.ok?`${t.imported} trades saved${t.refused?.length?`, ${t.refused.length} not placed`:''}`:`Trades not saved: ${t.error}`)
 if(c)parts.push(c.ok?`${c.claims} claims and ${c.drops} drops saved${c.refused?.length?`, ${c.refused.length} not placed`:''}`:`Claims and drops not saved: ${c.error}`)
 return parts.length?`${parts.join('. ')}.`:'Nothing was downloaded.'
}
