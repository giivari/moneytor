import test from "node:test";
import assert from "node:assert/strict";
import { addDays, occursOn, preview, scheduledAt } from "../src/lib/automation/schedule.ts";

test("Asia/Jakarta schedule is deterministic across UTC dates and month ends", () => {
  assert.equal(scheduledAt("2026-10-04","09:00"),"2026-10-04T02:00:00.000Z");
  assert.equal(addDays("2027-02-28",1),"2027-03-01");
  const base = { localTime:"09:00",startOn:"2026-01-01" };
  assert.deepEqual(preview({...base,frequency:"monthly_last_day"},"2026-02-01",2),[
    "2026-02-28T02:00:00.000Z","2026-03-31T02:00:00.000Z"]);
  assert.equal(occursOn({...base,frequency:"weekdays"},"2026-10-04"),false);
  assert.equal(occursOn({...base,frequency:"weekly",weekday:1},"2026-10-05"),true);
  assert.equal(occursOn({...base,frequency:"monthly_day",monthDay:28},"2026-02-28"),true);
  assert.equal(occursOn({...base,frequency:"daily",endOn:"2026-10-03"},"2026-10-04"),false);
  assert.throws(() => scheduledAt("2026-02-29","09:00"));
});
