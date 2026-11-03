export type ZombieExperienceMode = 'simple' | 'enhanced'

export function isZombieExperienceMode(value: unknown): value is ZombieExperienceMode {
  return value === 'simple' || value === 'enhanced'
}

/** The same weekly engine runs both experiences; Simple removes optional powers and automates revival. */
export function zombieExperienceDefaults(mode: ZombieExperienceMode) {
  return mode === 'simple'
    ? {
        serumReviveCount: 1,
        autoSerumRevive: true,
        serumAwardHighScore: true,
        serumAwardOnBashMaul: false,
        weaponTopTwoActive: false,
        ambushCountPerWeek: 0,
        ambushRemapMatchup: false,
      }
    : {
        serumReviveCount: 2,
        autoSerumRevive: false,
        serumAwardHighScore: true,
        serumAwardOnBashMaul: true,
        weaponTopTwoActive: true,
        ambushCountPerWeek: 1,
        ambushRemapMatchup: true,
      }
}
