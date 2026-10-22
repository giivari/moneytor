import test from 'node:test';
import assert from 'node:assert/strict';
import {reportingPeriod,previousPeriod,monthKeys,jakartaDay} from '../src/lib/analytics/periods.ts';
import {financialAmounts,periodChange,chargeBucket} from '../src/lib/analytics/domain.ts';
import {analyticsFilters} from '../src/lib/analytics/filters.ts';
const now=new Date('2026-10-10T17:00:00.000Z');
test('Jakarta midnight, month rollover and half-open boundaries',()=>{
  assert.equal(jakartaDay(now),'2026-10-11');
  assert.equal(jakartaDay(new Date('2026-09-30T16:59:59.999Z')),'2026-09-30');
  const p=reportingPeriod({kind:'current_month'},now);
  assert.equal(p.startAt,'2026-09-30T17:00:00.000Z');assert.equal(p.endAt,'2026-10-31T17:00:00.000Z');assert.equal(p.partial,true);
  assert.equal(reportingPeriod({kind:'previous_month'},now).partial,false);
  assert.equal(reportingPeriod({kind:'previous_month'},new Date('2026-01-01T00:00:00Z')).startDay,'2025-12-01');
});
test('custom inclusive end, leap day, trend zero-fill keys and year',()=>{
  const p=reportingPeriod({kind:'custom',startDay:'2024-02-29',endDay:'2024-02-29'},now);
  assert.equal(p.endDayExclusive,'2024-03-01');assert.deepEqual(monthKeys(p),['2024-02']);
  assert.equal(reportingPeriod({kind:'current_year'},now).startDay,'2026-01-01');
  assert.deepEqual(monthKeys(reportingPeriod({kind:'monthly_trend',months:3},now)),['2026-08','2026-09','2026-10']);
});
test('bounded valid days, ordering, months and filters reject malformed inputs',()=>{
  for(const [startDay,endDay] of [['2026-02-30','2026-03-01'],['2026-10-10','2026-10-01'],['2020-01-01','2026-10-10'],['0001-01-01','0001-01-02']])assert.throws(()=>reportingPeriod({kind:'custom',startDay,endDay},now));
  for(const months of [0,37,1.5,NaN])assert.throws(()=>reportingPeriod({kind:'monthly_trend',months},now));
  for(const raw of ['currency=idr','context=maybe','period=custom&start=2026-01-01','period=current_month&months=2','currency=IDR&currency=USD','unexpected=1'])assert.throws(()=>analyticsFilters(new URLSearchParams(raw)));
});
test('prior calendar periods and equal-day custom comparison',()=>{
  const input={kind:'custom',startDay:'2026-03-01',endDay:'2026-03-10'};
  assert.equal(previousPeriod(input,reportingPeriod(input,now),now).startDay,'2026-02-19');
  assert.equal(previousPeriod({kind:'current_year'},reportingPeriod({kind:'current_year'},now),now).startDay,'2025-01-01');
});
test('ordinary Income and transfers remain separate; fees are explicit spending',()=>{
  assert.deepEqual(financialAmounts('transfer','1000000','5000'),{incomeMinor:'0',expensePrincipalMinor:'0',spendingMinor:'5000',netMinor:'-5000',transferPrincipalMinor:'1000000'});
  assert.equal(financialAmounts('income','1000000','0').spendingMinor,'0');
  assert.equal(financialAmounts('expense','100','30').spendingMinor,'130');
});
test('charge semantic keys preserve unknown/custom catalog treatment',()=>{
  assert.equal(chargeBucket('tax'),'tax');for(const key of ['admin_fee','service_fee','transfer_fee'])assert.equal(chargeBucket(key),'fee');
  for(const key of [null,'new_charge','Tax'])assert.equal(chargeBucket(key),'other');
});
test('large bigint arithmetic never crosses Number; percent zero/sign handling',()=>{
  assert.equal(financialAmounts('expense','9223372036854775807','9223372036854775807').spendingMinor,'18446744073709551614');
  assert.deepEqual(periodChange('130000','100000'),{differenceMinor:'30000',percentageChangeBps:'3000'});
  assert.equal(periodChange('0','100').percentageChangeBps,'-10000');
  for(const [a,b] of [['100','0'],['0','0'],['-100','100'],['100','-100']])assert.equal(periodChange(a,b).percentageChangeBps,null);
});
