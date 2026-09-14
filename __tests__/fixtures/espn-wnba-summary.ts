/**
 * A hand-cut ESPN WNBA summary for the game-view tests, every value copied from the
 * real feed: NY Liberty @ Dallas Wings, 2026-07-20 (401892393, Final/OT, 99-98).
 * Measured shape: four 10-minute quarters then OT, flat plays with shot spots
 * (the -214748340 sentinel on free throws), a single box-score group with NBA
 * labels, per-team leaders, NBA-named team stats and win probability.
 *
 * Generated from the saved summary by keeping a few real plays, two starters, one
 * bench player and a DNP per team, and three team stats.
 */

export function rawWnba() {
  return {
  "header": {
    "competitions": [
      {
        "neutralSite": false,
        "status": {
          "type": {
            "state": "post",
            "detail": "Final/OT",
            "shortDetail": "Final/OT",
            "altDetail": "OT"
          }
        },
        "competitors": [
          {
            "homeAway": "home",
            "score": "98",
            "team": {
              "id": "3",
              "abbreviation": "DAL",
              "displayName": "Dallas Wings",
              "color": "002b5c",
              "alternateColor": "c4d600"
            },
            "record": [
              {
                "type": "total",
                "summary": "17-9",
                "displayValue": "17-9"
              },
              {
                "type": "home",
                "summary": "8-4",
                "displayValue": "8-4"
              }
            ],
            "linescores": [
              {
                "displayValue": "22"
              },
              {
                "displayValue": "25"
              },
              {
                "displayValue": "21"
              },
              {
                "displayValue": "15"
              },
              {
                "displayValue": "15"
              }
            ]
          },
          {
            "homeAway": "away",
            "score": "99",
            "team": {
              "id": "9",
              "abbreviation": "NY",
              "displayName": "New York Liberty",
              "color": "86cebc",
              "alternateColor": "000000"
            },
            "record": [
              {
                "type": "total",
                "summary": "14-12",
                "displayValue": "14-12"
              },
              {
                "type": "road",
                "summary": "7-7",
                "displayValue": "7-7"
              }
            ],
            "linescores": [
              {
                "displayValue": "25"
              },
              {
                "displayValue": "25"
              },
              {
                "displayValue": "9"
              },
              {
                "displayValue": "24"
              },
              {
                "displayValue": "16"
              }
            ]
          }
        ]
      }
    ]
  },
  "leaders": [
    {
      "team": {
        "id": "3"
      },
      "leaders": [
        {
          "name": "points",
          "displayName": "Points",
          "leaders": [
            {
              "displayValue": "29",
              "value": 29,
              "mainStat": {
                "value": "29",
                "label": "PTS"
              },
              "summary": "9/24 FG, 8/8 FT",
              "athlete": {
                "id": "3904577",
                "displayName": "Arike Ogunbowale",
                "shortName": "A. Ogunbowale",
                "headshot": {
                  "href": "https://a.espncdn.com/i/headshots/wnba/players/full/3904577.png",
                  "alt": "Arike Ogunbowale"
                },
                "jersey": "24",
                "position": {
                  "abbreviation": "G"
                }
              }
            }
          ]
        },
        {
          "name": "assists",
          "displayName": "Assists",
          "leaders": [
            {
              "displayValue": "7",
              "value": 7,
              "mainStat": {
                "value": "7",
                "label": "AST"
              },
              "summary": "0 TO, 22 MIN",
              "athlete": {
                "id": "4068159",
                "displayName": "Sug Sutton",
                "shortName": "S. Sutton",
                "headshot": {
                  "href": "https://a.espncdn.com/i/headshots/wnba/players/full/4068159.png",
                  "alt": "Sug Sutton"
                },
                "jersey": "0",
                "position": {
                  "abbreviation": "G"
                }
              }
            }
          ]
        },
        {
          "name": "rebounds",
          "displayName": "Rebounds",
          "leaders": [
            {
              "displayValue": "16",
              "value": 16,
              "mainStat": {
                "value": "16",
                "label": "REB"
              },
              "summary": "12 DREB, 4 OREB",
              "athlete": {
                "id": "3906949",
                "displayName": "Jessica Shepard",
                "shortName": "J. Shepard",
                "headshot": {
                  "href": "https://a.espncdn.com/i/headshots/wnba/players/full/3906949.png",
                  "alt": "Jessica Shepard"
                },
                "jersey": "32",
                "position": {
                  "abbreviation": "F"
                }
              }
            }
          ]
        }
      ]
    },
    {
      "team": {
        "id": "9"
      },
      "leaders": [
        {
          "name": "points",
          "displayName": "Points",
          "leaders": [
            {
              "displayValue": "33",
              "value": 33,
              "mainStat": {
                "value": "33",
                "label": "PTS"
              },
              "summary": "10/19 FG, 11/12 FT",
              "athlete": {
                "id": "2998928",
                "displayName": "Breanna Stewart",
                "shortName": "B. Stewart",
                "headshot": {
                  "href": "https://a.espncdn.com/i/headshots/wnba/players/full/2998928.png",
                  "alt": "Breanna Stewart"
                },
                "jersey": "30",
                "position": {
                  "abbreviation": "F"
                }
              }
            }
          ]
        },
        {
          "name": "assists",
          "displayName": "Assists",
          "leaders": [
            {
              "displayValue": "8",
              "value": 8,
              "mainStat": {
                "value": "8",
                "label": "AST"
              },
              "summary": "1 TO, 42 MIN",
              "athlete": {
                "id": "2998928",
                "displayName": "Breanna Stewart",
                "shortName": "B. Stewart",
                "headshot": {
                  "href": "https://a.espncdn.com/i/headshots/wnba/players/full/2998928.png",
                  "alt": "Breanna Stewart"
                },
                "jersey": "30",
                "position": {
                  "abbreviation": "F"
                }
              }
            }
          ]
        },
        {
          "name": "rebounds",
          "displayName": "Rebounds",
          "leaders": [
            {
              "displayValue": "13",
              "value": 13,
              "mainStat": {
                "value": "13",
                "label": "REB"
              },
              "summary": "9 DREB, 4 OREB",
              "athlete": {
                "id": "2998928",
                "displayName": "Breanna Stewart",
                "shortName": "B. Stewart",
                "headshot": {
                  "href": "https://a.espncdn.com/i/headshots/wnba/players/full/2998928.png",
                  "alt": "Breanna Stewart"
                },
                "jersey": "30",
                "position": {
                  "abbreviation": "F"
                }
              }
            }
          ]
        }
      ]
    }
  ],
  "boxscore": {
    "teams": [
      {
        "team": {
          "id": "9"
        },
        "statistics": [
          {
            "name": "fieldGoalsMade-fieldGoalsAttempted",
            "displayValue": "35-84",
            "label": "FG"
          },
          {
            "name": "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
            "displayValue": "9-32",
            "label": "3PT"
          },
          {
            "name": "totalRebounds",
            "displayValue": "48",
            "label": "Rebounds"
          }
        ]
      },
      {
        "team": {
          "id": "3"
        },
        "statistics": [
          {
            "name": "fieldGoalsMade-fieldGoalsAttempted",
            "displayValue": "36-76",
            "label": "FG"
          },
          {
            "name": "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
            "displayValue": "11-21",
            "label": "3PT"
          },
          {
            "name": "totalRebounds",
            "displayValue": "34",
            "label": "Rebounds"
          }
        ]
      }
    ],
    "players": [
      {
        "team": {
          "id": "9"
        },
        "statistics": [
          {
            "labels": [
              "MIN",
              "PTS",
              "FG",
              "3PT",
              "FT",
              "REB",
              "AST",
              "TO",
              "STL",
              "BLK",
              "OREB",
              "DREB",
              "PF",
              "+/-"
            ],
            "totals": [
              "",
              "99",
              "35-84",
              "9-32",
              "20-23",
              "48",
              "17",
              "6",
              "3",
              "6",
              "17",
              "31",
              "17",
              ""
            ],
            "athletes": [
              {
                "active": true,
                "starter": true,
                "didNotPlay": false,
                "reason": "COACH'S DECISION",
                "ejected": false,
                "athlete": {
                  "id": "2998928",
                  "displayName": "Breanna Stewart",
                  "shortName": "B. Stewart",
                  "headshot": {
                    "href": "https://a.espncdn.com/i/headshots/wnba/players/full/2998928.png",
                    "alt": "Breanna Stewart"
                  },
                  "jersey": "30",
                  "position": {
                    "abbreviation": "F"
                  }
                },
                "stats": [
                  "42",
                  "33",
                  "10-19",
                  "2-4",
                  "11-12",
                  "13",
                  "8",
                  "1",
                  "0",
                  "2",
                  "4",
                  "9",
                  "1",
                  "+5"
                ]
              },
              {
                "active": true,
                "starter": true,
                "didNotPlay": false,
                "reason": "COACH'S DECISION",
                "ejected": false,
                "athlete": {
                  "id": "2999101",
                  "displayName": "Jonquel Jones",
                  "shortName": "J. Jones",
                  "headshot": {
                    "href": "https://a.espncdn.com/i/headshots/wnba/players/full/2999101.png",
                    "alt": "Jonquel Jones"
                  },
                  "jersey": "35",
                  "position": {
                    "abbreviation": "C"
                  }
                },
                "stats": [
                  "33",
                  "14",
                  "6-13",
                  "1-3",
                  "1-2",
                  "10",
                  "2",
                  "0",
                  "0",
                  "1",
                  "7",
                  "3",
                  "4",
                  "-4"
                ]
              },
              {
                "active": false,
                "starter": false,
                "didNotPlay": false,
                "reason": "COACH'S DECISION",
                "ejected": false,
                "athlete": {
                  "id": "4790258",
                  "displayName": "Raquel Carrera",
                  "shortName": "R. Carrera",
                  "jersey": "14",
                  "position": {
                    "abbreviation": "F"
                  }
                },
                "stats": [
                  "3",
                  "0",
                  "0-0",
                  "0-0",
                  "0-0",
                  "0",
                  "0",
                  "0",
                  "0",
                  "0",
                  "0",
                  "0",
                  "0",
                  "0"
                ]
              },
              {
                "active": false,
                "starter": false,
                "didNotPlay": true,
                "reason": "COACH'S DECISION",
                "ejected": false,
                "athlete": {
                  "id": "4281930",
                  "displayName": "Anneli Maley",
                  "shortName": "A. Maley",
                  "headshot": {
                    "href": "https://a.espncdn.com/i/headshots/wnba/players/full/4281930.png",
                    "alt": "Anneli Maley"
                  },
                  "jersey": "24",
                  "position": {
                    "abbreviation": "F"
                  }
                },
                "stats": []
              }
            ]
          }
        ]
      },
      {
        "team": {
          "id": "3"
        },
        "statistics": [
          {
            "labels": [
              "MIN",
              "PTS",
              "FG",
              "3PT",
              "FT",
              "REB",
              "AST",
              "TO",
              "STL",
              "BLK",
              "OREB",
              "DREB",
              "PF",
              "+/-"
            ],
            "totals": [
              "",
              "98",
              "36-76",
              "11-21",
              "15-19",
              "34",
              "27",
              "7",
              "1",
              "7",
              "7",
              "27",
              "26",
              ""
            ],
            "athletes": [
              {
                "active": true,
                "starter": true,
                "didNotPlay": false,
                "reason": "COACH'S DECISION",
                "ejected": false,
                "athlete": {
                  "id": "3906949",
                  "displayName": "Jessica Shepard",
                  "shortName": "J. Shepard",
                  "headshot": {
                    "href": "https://a.espncdn.com/i/headshots/wnba/players/full/3906949.png",
                    "alt": "Jessica Shepard"
                  },
                  "jersey": "32",
                  "position": {
                    "abbreviation": "F"
                  }
                },
                "stats": [
                  "38",
                  "13",
                  "4-7",
                  "0-0",
                  "5-6",
                  "16",
                  "6",
                  "2",
                  "0",
                  "0",
                  "4",
                  "12",
                  "4",
                  "-5"
                ]
              },
              {
                "active": false,
                "starter": true,
                "didNotPlay": false,
                "reason": "COACH'S DECISION",
                "ejected": false,
                "athlete": {
                  "id": "4790266",
                  "displayName": "Awak Kuier",
                  "shortName": "A. Kuier",
                  "headshot": {
                    "href": "https://a.espncdn.com/i/headshots/wnba/players/full/4790266.png",
                    "alt": "Awak Kuier"
                  },
                  "jersey": "34",
                  "position": {
                    "abbreviation": "F"
                  }
                },
                "stats": [
                  "25",
                  "10",
                  "5-8",
                  "0-1",
                  "0-1",
                  "4",
                  "2",
                  "0",
                  "0",
                  "4",
                  "0",
                  "4",
                  "6",
                  "-3"
                ]
              },
              {
                "active": false,
                "starter": false,
                "didNotPlay": false,
                "reason": "COACH'S DECISION",
                "ejected": false,
                "athlete": {
                  "id": "924",
                  "displayName": "Alysha Clark",
                  "shortName": "A. Clark",
                  "headshot": {
                    "href": "https://a.espncdn.com/i/headshots/wnba/players/full/924.png",
                    "alt": "Alysha Clark"
                  },
                  "jersey": "7",
                  "position": {
                    "abbreviation": "F"
                  }
                },
                "stats": [
                  "4",
                  "0",
                  "0-1",
                  "0-0",
                  "0-0",
                  "0",
                  "1",
                  "0",
                  "0",
                  "0",
                  "0",
                  "0",
                  "1",
                  "+2"
                ]
              },
              {
                "active": false,
                "starter": false,
                "didNotPlay": true,
                "reason": "COACH'S DECISION",
                "ejected": false,
                "athlete": {
                  "id": "4595910",
                  "displayName": "Haley Jones",
                  "shortName": "H. Jones",
                  "headshot": {
                    "href": "https://a.espncdn.com/i/headshots/wnba/players/full/4595910.png",
                    "alt": "Haley Jones"
                  },
                  "jersey": "30",
                  "position": {
                    "abbreviation": "G"
                  }
                },
                "stats": []
              }
            ]
          }
        ]
      }
    ]
  },
  "plays": [
    {
      "id": "4018923934",
      "type": {
        "id": "615",
        "text": "Jumpball"
      },
      "text": "Jonquel Jones vs. Awak Kuier (Breanna Stewart gains possession)",
      "awayScore": 0,
      "homeScore": 0,
      "period": {
        "number": 1,
        "displayValue": "1st Quarter"
      },
      "clock": {
        "displayValue": "10:00"
      },
      "scoringPlay": false,
      "scoreValue": 0,
      "team": {
        "id": "9"
      },
      "participants": [
        {
          "athlete": {
            "id": "2999101"
          }
        },
        {
          "athlete": {
            "id": "4790266"
          }
        },
        {
          "athlete": {
            "id": "2998928"
          }
        }
      ],
      "shootingPlay": false,
      "coordinate": {
        "x": -214748340,
        "y": -214748365
      },
      "pointsAttempted": 0
    },
    {
      "id": "40189239317",
      "type": {
        "id": "92",
        "text": "Jump Shot"
      },
      "text": "Pauline Astier makes 27-foot three point jumper",
      "awayScore": 5,
      "homeScore": 0,
      "period": {
        "number": 1,
        "displayValue": "1st Quarter"
      },
      "clock": {
        "displayValue": "9:00"
      },
      "scoringPlay": true,
      "scoreValue": 3,
      "team": {
        "id": "9"
      },
      "participants": [
        {
          "athlete": {
            "id": "5345320"
          }
        }
      ],
      "shootingPlay": true,
      "coordinate": {
        "x": 14,
        "y": 25
      },
      "pointsAttempted": 3
    },
    {
      "id": "40189239335",
      "type": {
        "id": "97",
        "text": "Free Throw - 1 of 1"
      },
      "text": "Arike Ogunbowale makes free throw 1 of 1",
      "awayScore": 5,
      "homeScore": 6,
      "period": {
        "number": 1,
        "displayValue": "1st Quarter"
      },
      "clock": {
        "displayValue": "7:30"
      },
      "scoringPlay": true,
      "scoreValue": 1,
      "team": {
        "id": "3"
      },
      "participants": [
        {
          "athlete": {
            "id": "3904577"
          }
        }
      ],
      "shootingPlay": true,
      "coordinate": {
        "x": -214748340,
        "y": -214748365
      },
      "pointsAttempted": 1
    },
    {
      "id": "40189239355",
      "type": {
        "id": "131",
        "text": "Pullup Jump Shot"
      },
      "text": "Arike Ogunbowale misses 15-foot pullup jump shot",
      "awayScore": 12,
      "homeScore": 8,
      "period": {
        "number": 1,
        "displayValue": "1st Quarter"
      },
      "clock": {
        "displayValue": "5:30"
      },
      "scoringPlay": false,
      "scoreValue": 0,
      "team": {
        "id": "3"
      },
      "participants": [
        {
          "athlete": {
            "id": "3904577"
          }
        }
      ],
      "shootingPlay": true,
      "coordinate": {
        "x": 13,
        "y": 10
      },
      "pointsAttempted": 2
    },
    {
      "id": "40189239359",
      "type": {
        "id": "584",
        "text": "Substitution"
      },
      "text": "Rebekah Gardner enters the game for Rebecca Allen",
      "awayScore": 12,
      "homeScore": 8,
      "period": {
        "number": 1,
        "displayValue": "1st Quarter"
      },
      "clock": {
        "displayValue": "5:20"
      },
      "scoringPlay": false,
      "scoreValue": 0,
      "team": {
        "id": "9"
      },
      "participants": [
        {
          "athlete": {
            "id": "2327695"
          }
        },
        {
          "athlete": {
            "id": "3102133"
          }
        }
      ],
      "shootingPlay": false,
      "coordinate": {
        "x": -214748340,
        "y": -214748365
      },
      "pointsAttempted": 0
    },
    {
      "id": "401892393587",
      "type": {
        "id": "131",
        "text": "Pullup Jump Shot"
      },
      "text": "Azzi Fudd makes 17-foot pullup jump shot (Jessica Shepard assists)",
      "awayScore": 83,
      "homeScore": 85,
      "period": {
        "number": 5,
        "displayValue": "OT"
      },
      "clock": {
        "displayValue": "4:39"
      },
      "scoringPlay": true,
      "scoreValue": 2,
      "team": {
        "id": "3"
      },
      "participants": [
        {
          "athlete": {
            "id": "4433790"
          }
        },
        {
          "athlete": {
            "id": "3906949"
          }
        }
      ],
      "shootingPlay": true,
      "coordinate": {
        "x": 37,
        "y": 12
      },
      "pointsAttempted": 2
    },
    {
      "id": "401892393633",
      "type": {
        "id": "412",
        "text": "End Period"
      },
      "text": "End of the 1st  Overtime",
      "awayScore": 99,
      "homeScore": 98,
      "period": {
        "number": 5,
        "displayValue": "OT"
      },
      "clock": {
        "displayValue": "0.0"
      },
      "scoringPlay": false,
      "scoreValue": 0,
      "participants": [],
      "shootingPlay": false,
      "coordinate": {
        "x": -214748340,
        "y": -214748365
      },
      "pointsAttempted": 0
    },
    {
      "id": "401892393634",
      "type": {
        "id": "402",
        "text": "End Game"
      },
      "text": "End of Game",
      "awayScore": 99,
      "homeScore": 98,
      "period": {
        "number": 5,
        "displayValue": "OT"
      },
      "clock": {
        "displayValue": "0.0"
      },
      "scoringPlay": false,
      "scoreValue": 0,
      "participants": [],
      "shootingPlay": false,
      "coordinate": {
        "x": -214748340,
        "y": -214748365
      },
      "pointsAttempted": 0
    }
  ],
  "winprobability": [
    {
      "homeWinPercentage": 0,
      "tiePercentage": 0,
      "playId": "401892393587"
    }
  ],
  "gameInfo": {
    "venue": {
      "fullName": "College Park Center",
      "address": {
        "city": "Arlington",
        "state": "TX"
      }
    },
    "attendance": 6251
  }
} as any
}

export const WNBA_OPTS = { sport: 'WNBA', gameId: '401892393', fetchedAt: '2026-09-13T20:00:00.000Z' }
