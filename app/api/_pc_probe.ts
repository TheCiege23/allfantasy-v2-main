export async function probe(){const r=await fetch("https://www.thesportsdb.com/api/v1/json/3/all_leagues.php");return r.json()}
