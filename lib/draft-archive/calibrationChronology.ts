/** Full-season calibration cannot use forecasts captured after that season already began. */
export function preSeasonCalibration(start:string,opening:Date|null,season:number,now=new Date()){
 const drafted=Date.parse(start),opened=opening?.getTime()??NaN;
 return Number.isInteger(season)&&Number.isFinite(drafted)&&Number.isFinite(opened)&&opening!.getUTCFullYear()===season&&opened<=now.getTime()&&drafted<opened;
}
