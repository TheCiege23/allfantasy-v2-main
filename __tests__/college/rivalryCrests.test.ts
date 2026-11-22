import { describe, expect, it } from "vitest"
import { collegeRivalry } from "@/lib/college/rivalryCrests"

describe("collegeRivalry", () => {
  it("names each rivalry from ESPN's college display names, either way round", () => {
    expect(collegeRivalry("NCAAF", "Auburn Tigers", "Alabama Crimson Tide")).toBe("iron")
    expect(collegeRivalry("NCAAF", "Michigan Wolverines", "Ohio State Buckeyes")).toBe("game")
    expect(collegeRivalry("NCAAF", "Texas Longhorns", "Oklahoma Sooners")).toBe("river")
    expect(collegeRivalry("NCAAF", "Mississippi State Bulldogs", "Ole Miss Rebels")).toBe("egg")
    expect(collegeRivalry("NCAAF", "Navy Midshipmen", "Army Black Knights")).toBe("service")
    expect(collegeRivalry("NCAAF", "Washington State Cougars", "Washington Huskies")).toBe("apple")
    expect(collegeRivalry("NCAAF", "Utah Utes", "BYU Cougars")).toBe("holy")
    expect(collegeRivalry("NCAAF", "West Virginia Mountaineers", "Pittsburgh Panthers")).toBe("brawl")
  })

  it("names the second eight, either way round", () => {
    expect(collegeRivalry("NCAAF", "Georgia Bulldogs", "Florida Gators")).toBe("flga")
    expect(collegeRivalry("NCAAF", "Georgia Tech Yellow Jackets", "Georgia Bulldogs")).toBe("hate")
    expect(collegeRivalry("NCAAF", "South Carolina Gamecocks", "Clemson Tigers")).toBe("palmetto")
    expect(collegeRivalry("NCAAF", "Florida State Seminoles", "Florida Gators")).toBe("sunshine")
    expect(collegeRivalry("NCAAF", "Texas A&M Aggies", "Texas Longhorns")).toBe("lonestar")
    expect(collegeRivalry("NCAAF", "Arizona State Sun Devils", "Arizona Wildcats")).toBe("territorial")
    expect(collegeRivalry("NCAAF", "Stanford Cardinal", "California Golden Bears")).toBe("biggame")
    expect(collegeRivalry("NCAAF", "USC Trojans", "Notre Dame Fighting Irish")).toBe("coast")
  })

  it("tells a school in two rivalries apart by its opponent", () => {
    // Georgia plays both Florida and Georgia Tech; Texas plays both Oklahoma and Texas A&M; Florida both Georgia and FSU.
    expect(collegeRivalry("NCAAF", "Georgia Bulldogs", "Florida Gators")).toBe("flga")
    expect(collegeRivalry("NCAAF", "Georgia Bulldogs", "Georgia Tech Yellow Jackets")).toBe("hate")
    expect(collegeRivalry("NCAAF", "Texas Longhorns", "Oklahoma Sooners")).toBe("river")
    expect(collegeRivalry("NCAAF", "Texas Longhorns", "Texas A&M Aggies")).toBe("lonestar")
    expect(collegeRivalry("NCAAF", "Florida Gators", "Florida State Seminoles")).toBe("sunshine")
  })

  it("names batch 7, either way round", () => {
    expect(collegeRivalry("NCAAF", "Tennessee Volunteers", "Alabama Crimson Tide")).toBe("october")
    expect(collegeRivalry("NCAAF", "Georgia Bulldogs", "Auburn Tigers")).toBe("oak")
    expect(collegeRivalry("NCAAF", "Michigan State Spartans", "Michigan Wolverines")).toBe("mitten")
    expect(collegeRivalry("NCAAF", "Kansas State Wildcats", "Kansas Jayhawks")).toBe("sunflower")
    expect(collegeRivalry("NCAAF", "Iowa State Cyclones", "Iowa Hawkeyes")).toBe("cyhawk")
    expect(collegeRivalry("NCAAF", "Louisville Cardinals", "Kentucky Wildcats")).toBe("governor")
    expect(collegeRivalry("NCAAF", "Virginia Tech Hokies", "Virginia Cavaliers")).toBe("ridge")
    expect(collegeRivalry("NCAAF", "Florida State Seminoles", "Miami Hurricanes")).toBe("storm")
  })

  it("keeps three-rivalry schools straight", () => {
    // Alabama: Auburn and Tennessee. Auburn: Alabama and Georgia. Georgia: Florida, Georgia Tech and Auburn.
    // Michigan: Ohio State and Michigan State. Florida State: Florida and Miami.
    expect(collegeRivalry("NCAAF", "Alabama Crimson Tide", "Auburn Tigers")).toBe("iron")
    expect(collegeRivalry("NCAAF", "Alabama Crimson Tide", "Tennessee Volunteers")).toBe("october")
    expect(collegeRivalry("NCAAF", "Auburn Tigers", "Georgia Bulldogs")).toBe("oak")
    expect(collegeRivalry("NCAAF", "Michigan Wolverines", "Ohio State Buckeyes")).toBe("game")
    expect(collegeRivalry("NCAAF", "Michigan Wolverines", "Michigan State Spartans")).toBe("mitten")
    expect(collegeRivalry("NCAAF", "Florida State Seminoles", "Miami Hurricanes")).toBe("storm")
  })

  it("names batch 8, either way round", () => {
    expect(collegeRivalry("NCAAF", "Oregon State Beavers", "Oregon Ducks")).toBe("valley")
    expect(collegeRivalry("NCAAF", "Minnesota Golden Gophers", "Wisconsin Badgers")).toBe("northwoods")
    expect(collegeRivalry("NCAAF", "Purdue Boilermakers", "Indiana Hoosiers")).toBe("oaken")
    expect(collegeRivalry("NCAAF", "Minnesota Golden Gophers", "Iowa Hawkeyes")).toBe("barn")
    expect(collegeRivalry("NCAAF", "North Carolina Tar Heels", "Duke Blue Devils")).toBe("road")
    expect(collegeRivalry("NCAAF", "Ole Miss Rebels", "LSU Tigers")).toBe("magnolia")
    expect(collegeRivalry("NCAAF", "Alabama Crimson Tide", "LSU Tigers")).toBe("lights")
    expect(collegeRivalry("NCAAF", "Navy Midshipmen", "Air Force Falcons")).toBe("wings")
  })

  it("keeps batch 8's shared schools straight", () => {
    // Minnesota: Wisconsin and Iowa. LSU: Ole Miss and Alabama. Navy: Army and Air Force.
    // Alabama now sits in three (Auburn, Tennessee, LSU); Iowa in two (Iowa State, Minnesota).
    expect(collegeRivalry("NCAAF", "Minnesota Golden Gophers", "Wisconsin Badgers")).toBe("northwoods")
    expect(collegeRivalry("NCAAF", "Minnesota Golden Gophers", "Iowa Hawkeyes")).toBe("barn")
    expect(collegeRivalry("NCAAF", "LSU Tigers", "Ole Miss Rebels")).toBe("magnolia")
    expect(collegeRivalry("NCAAF", "LSU Tigers", "Alabama Crimson Tide")).toBe("lights")
    expect(collegeRivalry("NCAAF", "Navy Midshipmen", "Army Black Knights")).toBe("service")
    expect(collegeRivalry("NCAAF", "Navy Midshipmen", "Air Force Falcons")).toBe("wings")
    expect(collegeRivalry("NCAAF", "Iowa Hawkeyes", "Iowa State Cyclones")).toBe("cyhawk")
  })

  it("keeps look-alikes off batch 8", () => {
    expect(collegeRivalry("NCAAF", "NC State Wolfpack", "Duke Blue Devils")).toBeNull()
    expect(collegeRivalry("NCAAF", "Indiana State Sycamores", "Purdue Boilermakers")).toBeNull()
    expect(collegeRivalry("NCAAF", "Portland State Vikings", "Oregon State Beavers")).toBeNull()
    expect(collegeRivalry("NCAAF", "Auburn Tigers", "LSU Tigers")).toBeNull()
  })

  it("keeps Miami (OH) and other look-alikes off batch 7", () => {
    expect(collegeRivalry("NCAAF", "Miami (OH) RedHawks", "Florida State Seminoles")).toBeNull()
    expect(collegeRivalry("NCAAF", "Kentucky Wildcats", "Kansas State Wildcats")).toBeNull()
    expect(collegeRivalry("NCAAF", "Northern Iowa Panthers", "Iowa State Cyclones")).toBeNull()
    expect(collegeRivalry("NCAAF", "East Tennessee State Buccaneers", "Alabama Crimson Tide")).toBeNull()
    expect(collegeRivalry("NCAAF", "Western Michigan Broncos", "Michigan State Spartans")).toBeNull()
  })

  it("accepts a bare school name", () => {
    expect(collegeRivalry("ncaaf", "Alabama", "Auburn")).toBe("iron")
  })

  it("never mistakes a same-state school for the rival", () => {
    expect(collegeRivalry("NCAAF", "Ohio State Buckeyes", "Michigan State Spartans")).toBeNull()
    expect(collegeRivalry("NCAAF", "Washington Huskies", "Washington State")).toBe("apple")
    expect(collegeRivalry("NCAAF", "BYU Cougars", "Utah State Aggies")).toBeNull()
    expect(collegeRivalry("NCAAF", "Texas A&M Aggies", "Oklahoma Sooners")).toBeNull()
    expect(collegeRivalry("NCAAF", "Oklahoma State Cowboys", "Texas Longhorns")).toBeNull()
    expect(collegeRivalry("NCAAF", "Florida Atlantic Owls", "Florida State Seminoles")).toBeNull()
    expect(collegeRivalry("NCAAF", "Georgia State Panthers", "Georgia Tech Yellow Jackets")).toBeNull()
    expect(collegeRivalry("NCAAF", "Georgia Southern Eagles", "Georgia Bulldogs")).toBeNull()
    expect(collegeRivalry("NCAAF", "South Carolina State Bulldogs", "Clemson Tigers")).toBeNull()
    expect(collegeRivalry("NCAAF", "Northern Arizona Lumberjacks", "Arizona State Sun Devils")).toBeNull()
    expect(collegeRivalry("NCAAF", "Texas State Bobcats", "Texas A&M Aggies")).toBeNull()
  })

  it("is college football only, and needs both teams", () => {
    expect(collegeRivalry("NCAAB", "Alabama Crimson Tide", "Auburn Tigers")).toBeNull()
    expect(collegeRivalry("NFL", "Pittsburgh Steelers", "West Virginia Mountaineers")).toBeNull()
    expect(collegeRivalry("NCAAF", "Alabama Crimson Tide", "Georgia Bulldogs")).toBeNull()
    expect(collegeRivalry("NCAAF", "Alabama Crimson Tide", null)).toBeNull()
  })
})
