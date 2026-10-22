import test from 'node:test';
import assert from 'node:assert/strict';
import {activityClassification,financialStateLabel} from '../src/lib/automation/review-domain.ts';
const allocation={state:'aligned',differenceMinor:'0',sourceVoided:false,reason:null};
test('zero difference with no other required action moves review-required instance to history',()=>{
 const p=activityClassification({status:'review_required',resultId:'result',allocation});
 assert.equal(p.tab,'history');assert.equal(p.financialState,'allocation_aligned');assert.equal(p.attention,'none');
});
test('unreviewed excess, void and conditions failure retain distinct financial meanings',()=>{
 for(const [patch,expected] of [[{state:'excess',differenceMinor:'-30000'},'allocation_excess'],[{state:'excess',differenceMinor:'-140000',sourceVoided:true},'source_voided'],[{state:'blocked',differenceMinor:'-10000',conditionsMatched:false,reason:'Conditions changed'},'conditions_unmet']]) {
  const p=activityClassification({status:'review_required',allocation:{...allocation,...patch}});assert.equal(p.tab,'attention');assert.equal(p.financialState,expected);
 }
});
test('pending confirmations and recoverable failures cannot be dismissed by aligned allocation fallback',()=>{
 for(const status of ['awaiting_confirmation','pending_confirmation','due','failed'])assert.equal(activityClassification({status,allocation}).attention,'needs_action');
});
test('reviewed discrepancy stays financially unresolved; source generation does not influence projection',()=>{
 for(const storage of ['schedule','income_event','general']) {
  const review={financialState:'allocation_excess',attention:'reviewed',tab:'history',decision:'acknowledged'};
  assert.equal(activityClassification({storage,status:'review_required',allocation:{...allocation,state:'excess',differenceMinor:'-30000'},review}).financialState,'allocation_excess');
  assert.notEqual(financialStateLabel(review.financialState),'Alokasi sesuai');
 }
});
test('upcoming and terminal states remain exclusive, and unknown stale amounts are labelled for reassessment',()=>{
 assert.equal(activityClassification({status:'upcoming'}).tab,'upcoming');
 for(const status of ['posted','skipped','superseded','voided'])assert.equal(activityClassification({status}).tab,'history');
 assert.equal(financialStateLabel('assessment_stale'),'Perlu penilaian ulang');
});
