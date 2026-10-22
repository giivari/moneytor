import test from 'node:test';
import assert from 'node:assert/strict';
import {allocationDifference} from '../src/lib/automation/allocation-domain.ts';
for(const [label,source,bps,principal,voided,target,recognized,difference,state] of [
  ['basic 10% shortage','1300000',1000,['100000'],false,'130000','100000','30000','additional'],
  ['subsequent correction includes previous adjustment','1400000',1000,['100000','30000'],false,'140000','130000','10000','additional'],
  ['lower correction reports excess','900000',1000,['100000','30000','10000'],false,'90000','140000','-50000','excess'],
  ['zero difference needs no posting','1300000',1000,['100000','30000'],false,'130000','130000','0','aligned'],
  ['void source has zero target','1300000',1000,['100000'],true,'0','100000','-100000','excess'],
  ['zero source has no positive proposal','0',1000,['100000'],false,'0','100000','-100000','excess'],
  ['fractional 2.5% floors to minor unit','123',250,[],false,'3','0','3','additional'],
  ['subminor target may align without zero posting','1',1,[],false,'0','0','0','aligned'],
  ['large money stays bigint exact','9007199254740993',1000,['900719925474099'],false,'900719925474099','900719925474099','0','aligned'],
])test(label,()=>assert.deepEqual(allocationDifference(source,bps,principal,voided),{targetMinor:target,recognizedMinor:recognized,differenceMinor:difference,state}));
test('rejects invalid percentages, negative principals and bigint overflow',()=>{
  for(const bps of [0,10001,2.5])assert.throws(()=>allocationDifference('100',bps,[]));
  assert.throws(()=>allocationDifference('100',1000,['-1']));
  assert.throws(()=>allocationDifference('100',1000,['9223372036854775807','1']));
});
