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

test("schedule catch-up covers months of absence in one bounded pass", async () => {
  const { catchUpWindow, maximumCatchUpDays } = await import("../src/lib/automation/schedule.ts");
  // App unopened since Aug 1: one visit on Nov 5 materializes everything up to the 30-day horizon.
  assert.deepEqual(catchUpWindow("2026-08-02", "2026-12-05"), { start: "2026-08-02", end: "2026-12-05" });
  // Still bounded: a backlog beyond the cap is finished on the next visit.
  assert.equal(maximumCatchUpDays >= 93, true);
  assert.deepEqual(catchUpWindow("2026-01-01", "2026-12-05", 31), { start: "2026-01-01", end: "2026-01-31" });
  assert.equal(catchUpWindow("2026-12-06", "2026-12-05"), null);
  assert.deepEqual(catchUpWindow("2026-12-05", "2026-12-05"), { start: "2026-12-05", end: "2026-12-05" });
});

test("imported CSV/XLSX activity is excluded from automation discovery", async () => {
  const { importDiscoveryFilter, importedSourceExclusion } = await import("../src/lib/automation/import-filter.ts");
  assert.match(importedSourceExclusion, /^AND NOT EXISTS\(SELECT 1 FROM import_batch_rows imported WHERE imported\.activity_id=s\.root_activity_id\)$/);
  const client = (ready) => ({ queries: [], async query(text) { this.queries.push(text); return { rows: [{ ready }] }; } });
  const migrated = client(true), legacy = client(false);
  assert.equal(await importDiscoveryFilter(migrated), importedSourceExclusion);
  assert.match(migrated.queries[0], /to_regclass\('import_batch_rows'\)/);
  assert.equal(await importDiscoveryFilter(legacy), "");
  const { readFileSync } = await import("node:fs");
  for (const file of ["income-events.ts", "composable-service.ts"]) {
    const source = readFileSync(new URL(`../src/lib/automation/${file}`, import.meta.url), "utf8");
    assert.match(source, /importFilter = await importDiscoveryFilter\(/, file);
    // The predicate sits inside the discovery query that aliases the receipt table as `s`.
    assert.match(source, /(income_automation_sources|automation_source_receipts) s[\s\S]*\$\{allocationFilter\}\s*\$\{importFilter\}\s*ORDER BY s\.eligible_at/, file);
  }
});
