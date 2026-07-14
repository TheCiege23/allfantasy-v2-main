Set-Location "F:\allfantasy-v2-main"

Write-Host ""
Write-Host "=== GIT STATUS ==="
git status --short

Write-Host ""
Write-Host "=== LIKELY LEAGUE CREATION ROUTES ==="

Get-ChildItem -Path "app\api" -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object {
    $_.FullName -match "league|redraft|draft|waiver"
  } |
  Select-Object FullName |
  Format-Table -AutoSize

Write-Host ""
Write-Host "=== LIKELY REDRAFT LIB FILES ==="

Get-ChildItem -Path "lib" -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object {
    $_.FullName -match "redraft|league|draft|waiver|roster|scoring|ncaaf|nfl"
  } |
  Select-Object FullName |
  Format-Table -AutoSize

Write-Host ""
Write-Host "=== LIKELY TEST FILES ==="

Get-ChildItem -Path "__tests__" -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object {
    $_.FullName -match "redraft|league|draft|waiver|roster|scoring|ncaaf|nfl"
  } |
  Select-Object FullName |
  Format-Table -AutoSize

Write-Host ""
Write-Host "=== KEYWORD SEARCH ==="

$patterns = @(
  "createLeague",
  "redraft",
  "draftConfig",
  "waiverConfig",
  "tradeConfig",
  "playoffConfig",
  "commissioner",
  "getRedraftDefaultContract",
  "ncaaf_half_ppr"
)

foreach ($pattern in $patterns) {
  Write-Host ""
  Write-Host "----- $pattern -----"

  Get-ChildItem -Path "app","lib","server","prisma","__tests__" -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Extension -in ".ts", ".tsx", ".js", ".jsx", ".prisma", ".sql", ".json"
    } |
    Select-String -Pattern $pattern -SimpleMatch |
    Select-Object Path, LineNumber, Line |
    Format-Table -AutoSize
}

Write-Host ""
Write-Host "=== DONE ==="
