import * as XLSX from 'xlsx'
import { weeklyActionText, weeklyBrief, type WeeklyBlueprint } from './weeklyBlueprint'
import { rivalryNarrative } from './weeklyShare'
import type { WeeklyPlayoffPath } from './weeklyPlayoffPath'

const xml = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')
/** Real editable Excel data and embedded OOXML charts; no invented earlier odds. */
export function buildWeeklyWorkbook(data: WeeklyBlueprint, path?: WeeklyPlayoffPath | null, es = false): Uint8Array {
  const wb = XLSX.utils.book_new()
  const append = (name: string, rows: unknown[][]) => {
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    sheet['!cols'] = [{wch:32},{wch:65},{wch:30},{wch:30}]
    XLSX.utils.book_append_sheet(wb,sheet,name)
    return sheet
  }
  append('Brief', [['AllFantasy · Your Week'],[es ? 'Resumen' : 'Brief',weeklyBrief(data,es)],['Rivalry',rivalryNarrative(data,es)],['Scope',data.focusLeagueId ? 'League' : 'Portfolio'],['Sports',data.sports.join(', ')],['Disclosure','Estimates are not guarantees. Only imported history and available forecasts are exported.'],['History',path?.historyUnavailable ? 'Snapshot storage unavailable' : 'Saved observed periods; missing periods are not interpolated.']])
  append('Actions', [['League','Priority','Next game (not confirmed lock)','Source'],...data.actions.map(a=>[a.leagueName,weeklyActionText(a,es),a.gameAt ?? '',a.source])])
  const you = path?.league?.you
  const valid = !!you?.modelled && path?.league?.season === path?.season && Number.isFinite(you.playoffPct) && you.playoffPct >= 0 && you.playoffPct <= 100
  const points = valid ? (path?.points ?? []).filter(p=>Number.isInteger(p.period) && p.period > 0 && Number.isFinite(p.probability) && p.probability >= 0 && p.probability <= 100).sort((a,b)=>a.period-b.period) : []
  const trend = append('Trend',[['Period','Estimated playoff probability (%)','Calculated at (UTC)'],...points.map(p=>[p.period,p.probability,p.sampledAt])])
  for (let row=2;row<=points.length+1;row++) trend[`B${row}`].z = '0.0"%"'
  if (!points.length) { trend.A2 = {t:'s',v:'Select a league with an available playoff model to export its saved probability history.'}; trend['!ref']='A1:C2' }
  const swing = valid && path?.swing && path.swing.week >= path.period ? path.swing : null
  const scenarios = swing && [swing.ifWin,swing.ifLose].every(p=>Number.isFinite(p)&&p>=0&&p<=100) ? [['If you win',swing.ifWin],['If you lose',swing.ifLose]] : []
  const scenarioSheet = append('Scenarios',[['Outcome','Estimated playoff probability (%)'],...scenarios])
  for (let row=2;row<=scenarios.length+1;row++) scenarioSheet[`B${row}`].z = '0.0"%"'
  if (!scenarios.length) { scenarioSheet.A2 = {t:'s',v:'No pending win/loss scenario is available in this export. Open a league to review its playoff path.'}; scenarioSheet['!ref']='A1:B2' }
  append('Coverage',[['League','AF current forecast','Provider current forecast','Partial'],...data.coverage.map(c=>[c.leagueName,c.af,c.provider,c.partial])])
  append('Model',[['Available',valid],['Season',path?.season ?? ''],['Period',path?.period ?? ''],['Iterations',valid ? path?.league?.assumptions.iterations : ''],['Calculated at',valid ? path?.league?.assumptions.computedAt : ''],...((valid ? path?.league?.assumptions.missing : ['Playoff model unavailable for this format or data.']) ?? []).map(m=>['Assumption',m])])
  const bytes = XLSX.write(wb,{bookType:'xlsx',type:'array'}) as ArrayBuffer
  if (!points.length && !scenarios.length) return new Uint8Array(bytes)
  const zip = XLSX.CFB.read(new Uint8Array(bytes),{type:'array'})
  const get = (name: string) => {
    const entry = XLSX.CFB.find(zip,`/${name}`)
    if (!entry?.content) throw new Error(`Workbook part missing: ${name}`)
    return new TextDecoder().decode(new Uint8Array(entry.content as Uint8Array))
  }
  const put = (name: string,value: string) => XLSX.CFB.utils.cfb_add(zip,`/${name}`,new TextEncoder().encode(value))
  let types = get('[Content_Types].xml')
  const addChart = (sheetIndex: number, sheetName: string, rows: unknown[][], kind: 'line'|'bar', title: string) => {
    const id = sheetIndex, end = rows.length + 1
    const stringPts = rows.map((r,i)=>`<c:pt idx="${i}"><c:v>${xml(String(r[0]))}</c:v></c:pt>`).join('')
    const numberPts = rows.map((r,i)=>`<c:pt idx="${i}"><c:v>${r[1]}</c:v></c:pt>`).join('')
    const textStyle = '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1100"><a:solidFill><a:srgbClr val="172B42"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>'
    const chartTitle = (value: string) => `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1400" b="1"/><a:t>${xml(value)}</a:t></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/>${textStyle}</c:title>`
    const marker = kind === 'line' ? '<c:marker><c:symbol val="circle"/><c:size val="7"/></c:marker>' : ''
    const series = `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${xml(title)}</c:v></c:tx>${marker}<c:cat><c:strRef><c:f>'${sheetName}'!$A$2:$A$${end}</c:f><c:strCache><c:ptCount val="${rows.length}"/>${stringPts}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>'${sheetName}'!$B$2:$B$${end}</c:f><c:numCache><c:formatCode>0.0&quot;%&quot;</c:formatCode><c:ptCount val="${rows.length}"/>${numberPts}</c:numCache></c:numRef></c:val></c:ser>`
    const labels = `<c:dLbls><c:numFmt formatCode="0.0&quot;%&quot;" sourceLinked="0"/>${textStyle}<c:dLblPos val="${kind === 'bar' ? 'outEnd' : 't'}"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/></c:dLbls>`
    const chart = kind === 'line' ? `<c:lineChart><c:grouping val="standard"/>${series}${labels}<c:marker val="1"/><c:axId val="100"/><c:axId val="200"/></c:lineChart>` : `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${series}${labels}<c:gapWidth val="120"/><c:axId val="100"/><c:axId val="200"/></c:barChart>`
    const axisLine = '<c:spPr><a:ln><a:solidFill><a:srgbClr val="8093A5"/></a:solidFill></a:ln></c:spPr>'
    const category = `<c:catAx><c:axId val="100"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>${chartTitle(kind === 'line' ? 'Saved period' : 'Matchup outcome')}<c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${axisLine}${textStyle}<c:crossAx val="200"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>`
    const value = `<c:valAx><c:axId val="200"/><c:scaling><c:orientation val="minMax"/><c:max val="100"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/>${chartTitle('Estimated playoff probability (%)')}<c:numFmt formatCode="0&quot;%&quot;" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${axisLine}${textStyle}<c:crossAx val="100"/><c:crosses val="autoZero"/><c:crossBetween val="between"/><c:majorUnit val="20"/></c:valAx>`
    put(`xl/charts/chart${id}.xml`,`<?xml version="1.0" encoding="UTF-8"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart>${chartTitle(title)}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${chart}${category}${value}</c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>${textStyle}</c:chartSpace>`)
    put(`xl/drawings/drawing${id}.xml`,`<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor><xdr:from><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>14</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>20</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="${xml(title)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`)
    const rel = (target: string,type: string) => `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/></Relationships>`
    put(`xl/drawings/_rels/drawing${id}.xml.rels`,rel(`../charts/chart${id}.xml`,'chart'))
    put(`xl/worksheets/_rels/sheet${sheetIndex}.xml.rels`,rel(`../drawings/drawing${id}.xml`,'drawing'))
    put(`xl/worksheets/sheet${sheetIndex}.xml`,get(`xl/worksheets/sheet${sheetIndex}.xml`).replace('</worksheet>','<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></worksheet>'))
    types = types.replace('</Types>',`<Override PartName="/xl/charts/chart${id}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/xl/drawings/drawing${id}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`)
  }
  if (points.length) addChart(3,'Trend',points.map(p=>[p.period,p.probability]),'line',points.length === 1 ? 'First saved playoff estimate (no trend yet)' : 'Saved playoff probability by period')
  if (scenarios.length) addChart(4,'Scenarios',scenarios,'bar','Win / loss scenarios (%)')
  put('[Content_Types].xml',types)
  return new Uint8Array(XLSX.CFB.write(zip,{type:'buffer',fileType:'zip'}) as Uint8Array)
}
