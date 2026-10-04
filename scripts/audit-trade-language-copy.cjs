// Read-only audit: visible copy arguments on the trade builder's supporting panels.
const fs = require('node:fs')
const ts = require('typescript')
const files = ['TradeEvaluationReceipt','TradeFinderPanel','TradeCompetitiveEdge','TradePartnerSuggestions','TradeAssetPicker','TradeAssetSheet','TradeLeagueStrip']
const dictionary = fs.readFileSync('lib/core-app/tradeVisualCopy.ts','utf8') + fs.readFileSync('lib/core-app/coreUiCopy.ts','utf8')
for (const name of files) {
  const file = `components/core-app/screens/${name}.tsx`
  const src = fs.readFileSync(file,'utf8')
  const ast = ts.createSourceFile(file,src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
  const text = new Set()
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast)==='copy') {
      function literals(n) {
        if (ts.isStringLiteral(n) && /[a-zA-Z]{3}/.test(n.text) && !dictionary.includes(n.text.trim().replaceAll("'","\\'"))) text.add(n.text.trim())
        ts.forEachChild(n,literals)
      }
      node.arguments.forEach(literals)
    }
    ts.forEachChild(node,visit)
  }
  visit(ast)
  console.log(name,JSON.stringify([...text]))
}
