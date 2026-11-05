import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DEFAULT_CONFIG,RUNWAYS,rateDistanceNm} from '../src/maestro-engine.ts'
import {suggestedRunwayRate} from '../src/maestro-runway-rate.ts'

test('runway-pair suggestions use the requested ARR/DEP spacing, with exceptions before the 38/h default',()=>{
 const special={'26/19R':4.3,'08/19L':4.3,'01R/08':4,'26/01L':5},c=structuredClone(DEFAULT_CONFIG)
 for(const arrival of RUNWAYS.filter(r=>r.startsWith('ESSA/')))for(const departure of RUNWAYS.filter(r=>r.startsWith('ESSA/'))){
  const pair=arrival.split('/')[1]+'/'+departure.split('/')[1],distance=arrival===departure?(arrival==='ESSA/08'?8.3:6.5):special[pair]
  const seconds=suggestedRunwayRate(arrival,departure,c)
  if(distance===undefined)assert.equal(seconds,95,pair)
  else assert.ok(Math.abs(rateDistanceNm(seconds,arrival,c)-distance)<.02,pair)
 }
 assert.equal(suggestedRunwayRate('ESSA/08','ESSA/08',c),213)
 assert.equal(suggestedRunwayRate('ESSA/01R','ESSA/01R',c),167)
 assert.equal(suggestedRunwayRate('ESSA/26','ESSA/19R',c),111)
 assert.equal(suggestedRunwayRate('ESSA/26','ESSA/01L',c),129)
})

test('distance suggestions use the selected arrival runway wind and remain within the rate slider limits',()=>{
 const c={...structuredClone(DEFAULT_CONFIG),surfaceWindDirection:255.9,surfaceWindSpeed:20}
 const seconds=suggestedRunwayRate('ESSA/26','ESSA/01L',c)
 assert.equal(seconds,150);assert.equal(rateDistanceNm(seconds,'ESSA/26',c),5)
 assert.equal(suggestedRunwayRate('ESSA/19R','ESSA/26',c),95,'38/h default is a time rate')
 assert.equal(suggestedRunwayRate('ESSA/08','ESSA/08',{...c,landingSpeedKnots:50,surfaceWindDirection:75.9,surfaceWindSpeed:100}),598)
 assert.equal(suggestedRunwayRate('ESSA/01R','ESSA/08',{...c,surfaceWindDirection:190.4,surfaceWindSpeed:200}),60)
 assert.equal(suggestedRunwayRate('ESSA/19R',undefined,c),undefined)
 assert.equal(suggestedRunwayRate('ESSB/12','ESSB/12',c),undefined)
})
