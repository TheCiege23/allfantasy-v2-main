import { describe, expect, it } from 'vitest'
import { readImportedPlayerMetadata, snapshotImportedPlayerMetadata, fantraxSnapshotPlayerMap } from '@/lib/league-import/importedPlayerMetadata'
describe('source roster metadata', () => {
 it('preserves source names, primary positions and schools even without an identity match', () => {
  const map = snapshotImportedPlayerMetadata(['fx1','fx2'], { fx1: { name:'Jane Smith', position:'WR', team:'Florida', external_ids:{sleeper_id:'wrong'} }, fx2:{name:'Unknown player (fx2)',position:'N/A'} })
  expect(map).toEqual({fx1:{name:'Jane Smith',position:'WR',team:'Florida'}})
  const blob = { source_provider:'fantrax', players:['fx1'], player_metadata:map }
  expect(readImportedPlayerMetadata(blob,'fantrax','fx1')).toEqual(map.fx1)
  expect(readImportedPlayerMetadata(blob,'espn','fx1')).toBeNull()
  expect(readImportedPlayerMetadata({...blob,players:[]},'fantrax','fx1')).toBeNull()
 })
})

 it('reads saved source metadata without treating a flex/bench slot as an athlete position', () => {
  const map = fantraxSnapshotPlayerMap([{ fantraxId:'fx1', name:'Jane Smith', primaryPosition:'WR', position:'RWT', team:'Florida' }, { fantraxId:'fx2', name:'Joe Smith', position:'BENCH', team:'Florida' }])
  expect(map.fx1.position).toBe('WR')
  expect(map.fx2.position).toBeNull()
  expect(fantraxSnapshotPlayerMap([{ fantraxId:'fx1', name:'Jane Smith' }, { fantraxId:'fx1', name:'Other Person' }])).toEqual({})
})

 it('refuses occupied roster slots passed through an old normalized import map', () => {
  for (const slot of ['BENCH', 'RWT', 'SFX', 'FLEX', 'IR', 'UTIL']) {
   expect(snapshotImportedPlayerMetadata(['fx1'], {fx1:{name:'Jane Smith',position:slot,team:'Florida'}}).fx1).toEqual({name:'Jane Smith',position:null,team:'Florida'})
  }
  expect(snapshotImportedPlayerMetadata(['fx1'], {fx1:{name:'Jane Smith',position:'WR'}}).fx1.position).toBe('WR')
 })
