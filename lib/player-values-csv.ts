import fs from 'fs'
import path from 'path'

export interface CSVPlayerValue {
  player: string
  pos: string
  team: string
  age: number
  draftYear: number
  ecr1qb: number
  ecr2qb: number
  ecrPos: number
  value1qb: number
  value2qb: number
  scrapeDate: string
  fpId: string
}

let cachedPlayers: CSVPlayerValue[] | null = null

export function parsePlayerValuesCSV(): CSVPlayerValue[] {
  if (cachedPlayers) {
    return cachedPlayers
  }

  const csvPath = path.join(process.cwd(), 'data', 'player-values.csv')
  
  if (!fs.existsSync(csvPath)) {
    console.warn('[PLAYER-VALUES] CSV file not found at', csvPath)
    return []
  }

  const content = fs.readFileSync(csvPath, 'utf-8')
  const lines = content.split('\n').filter(line => line.trim())
  
  if (lines.length < 2) {
    return []
  }

  const players: CSVPlayerValue[] = []
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    const values = parseCSVLine(line)
    
    if (values.length >= 11) {
      players.push({
        player: values[0]?.replace(/"/g, '') || '',
        pos: values[1]?.replace(/"/g, '') || '',
        team: values[2]?.replace(/"/g, '') || '',
        age: parseFloat(values[3]) || 0,
        draftYear: parseInt(values[4]) || 0,
        ecr1qb: parseFloat(values[5]) || 999,
        ecr2qb: parseFloat(values[6]) || 999,
        ecrPos: parseFloat(values[7]) || 999,
        value1qb: parseInt(values[8]) || 0,
        value2qb: parseInt(values[9]) || 0,
        scrapeDate: values[10]?.replace(/"/g, '') || '',
        fpId: values[11]?.replace(/"/g, '') || ''
      })
    }
  }

  cachedPlayers = players
  console.log(`[PLAYER-VALUES] Loaded ${players.length} players from CSV`)
  return players
}

function parseCSVLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    
    if (char === '"' && !inQuotes) {
      inQuotes = true
    } else if (char === '"' && inQuotes) {
      inQuotes = false
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  
  values.push(current.trim())
  return values
}

export function findPlayerInCSV(name: string, is2QB: boolean = true): CSVPlayerValue | null {
  const players = parsePlayerValuesCSV()
  const normalized = name.toLowerCase().trim()
  
  const exactMatch = players.find(p => 
    p.player.toLowerCase() === normalized
  )
  if (exactMatch) return exactMatch
  
  const partialMatch = players.find(p => 
    p.player.toLowerCase().includes(normalized) ||
    normalized.includes(p.player.toLowerCase())
  )
  
  return partialMatch || null
}

export function getPlayerValue(player: CSVPlayerValue, is2QB: boolean = true): number {
  return is2QB ? player.value2qb : player.value1qb
}

export function getPlayerECR(player: CSVPlayerValue, is2QB: boolean = true): number {
  return is2QB ? player.ecr2qb : player.ecr1qb
}

