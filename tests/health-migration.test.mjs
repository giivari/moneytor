import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
test('REQUIRED_MIGRATION menunjuk migrasi terbaru di db/migrations', async () => {
  const names=(await readdir(new URL('../db/migrations/',import.meta.url))).filter(n=>/^\d{3}_.+\.sql$/.test(n)).sort();
  const source=await readFile(new URL('../src/lib/db/required-migration.ts',import.meta.url),'utf8');
  assert.equal(source.match(/REQUIRED_MIGRATION = "([^"]+)"/)?.[1],names.at(-1));
});
test('migrasi 021 memulihkan guard riwayat Planning dan kode runtime tidak lagi mengubahnya', async () => {
  assert.match(await readFile(new URL('../db/migrations/021_planning_guard_restore.sql',import.meta.url),'utf8'),/IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Planning history cannot be deleted'/);
  for (const file of ['../src/lib/planning/repository.ts','../scripts/vercel-db-setup.mjs']) {
    assert.doesNotMatch(await readFile(new URL(file,import.meta.url),'utf8'),/CREATE OR REPLACE FUNCTION (public\.)?guard_planning_record/);
  }
});
