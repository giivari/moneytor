import test from "node:test";
import assert from "node:assert/strict";
import { planningPosition,goalProgress,horizonDay } from "../src/lib/domain/planning.ts";

const reserve = (amountMinor,extra={}) => ({ currency:"IDR",amountMinor,isActive:true,...extra });
const obligation = (id,amountMinor,dueOn,status="open") => ({ id,currency:"IDR",amountMinor,dueOn,status });
const today = "2026-10-04";

test("budgets and goal targets do not reduce spendable; active reserves do",() => {
  const none = planningPosition("10000000","IDR",[],[],horizonDay(today,30));
  assert.equal(none.spendableMinor,"10000000");
  const setAside = planningPosition("10000000","IDR",[reserve("2000000"),reserve("1500000")],[],horizonDay(today,30));
  assert.equal(setAside.spendableMinor,"6500000");
  assert.equal(goalProgress("laptop","IDR",[]),"0");
  assert.equal(goalProgress("laptop","IDR",[reserve("4000000",{goalId:"laptop"}),reserve("2000000",{goalId:"other"})]),"4000000");
});

test("linked reserve covers obligation once; excess remains reserved",() => {
  const bill = obligation("electricity","1500000",horizonDay(today,5));
  const covered = planningPosition("10000000","IDR",[reserve("2000000"),reserve("1000000",{obligationId:"electricity"})],[bill],horizonDay(today,30));
  assert.deepEqual(covered,{ reservedMinor:"3000000",dueMinor:"1500000",coveredMinor:"1000000",
    uncoveredMinor:"500000",spendableMinor:"7000000",availableMinor:"6500000" });
  const excess = planningPosition("10000000","IDR",[reserve("2000000",{obligationId:"electricity"})],[bill],horizonDay(today,30));
  assert.equal(excess.coveredMinor,"1500000"); assert.equal(excess.uncoveredMinor,"0");
  assert.equal(excess.spendableMinor,"8000000"); assert.equal(excess.availableMinor,"8000000");
});

test("seven, thirty and ninety day horizons include overdue and exclude resolved obligations",() => {
  const due = [obligation("overdue","100",horizonDay(today,-1)),obligation("five","200",horizonDay(today,5)),
    obligation("twenty","300",horizonDay(today,20)),obligation("sixty","400",horizonDay(today,60)),
    obligation("settled","500",horizonDay(today,5),"settled"),obligation("cancelled","600",horizonDay(today,5),"cancelled")];
  assert.equal(planningPosition("10000","IDR",[],due,horizonDay(today,7)).dueMinor,"300");
  assert.equal(planningPosition("10000","IDR",[],due,horizonDay(today,30)).dueMinor,"600");
  assert.equal(planningPosition("10000","IDR",[],due,horizonDay(today,90)).dueMinor,"1000");
});

test("negative results, exact bigint, inactive reserve and currency separation",() => {
  const result = planningPosition("9007199254740993","IDR",[reserve("9007199254740994"),reserve("100",{isActive:false})],
    [obligation("bill","20",horizonDay(today,5))],horizonDay(today,30));
  assert.equal(result.spendableMinor,"-1"); assert.equal(result.availableMinor,"-21");
  assert.throws(() => planningPosition("100","IDR",[{currency:"USD",amountMinor:"10",isActive:true}],[],horizonDay(today,30)),/Currency mismatch/);
  assert.throws(() => planningPosition("0","IDR",[reserve("-1")],[],horizonDay(today,30)),/positive/);
});
