import { loadEnvFile } from 'node:process';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';

loadEnvFile('.env.local');
const ownerUrl = new URL(process.env.DATABASE_URL);
if (ownerUrl.hostname !== '127.0.0.1' || ownerUrl.port !== '55433' || ownerUrl.pathname !== '/moneta_p2_verify') throw Error('Unexpected owner target');
const owner = new pg.Client({connectionString:ownerUrl.toString()}); await owner.connect();
await owner.query('SET default_transaction_read_only=on');
const installed = (await owner.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).rows;
if (installed.length !== 10 || installed.at(-1).name !== '010_composable_automation.sql') throw Error('Owner must remain on 010');
for (const row of installed) if (createHash('sha256').update(await readFile(`db/migrations/${row.name}`,'utf8')).digest('hex') !== row.checksum) throw Error(`Checksum mismatch: ${row.name}`);
async function fingerprint() {
  const result = {};
  for (const {tablename} of (await owner.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows) {
    const quoted = '"'+tablename.replaceAll('"','""')+'"';
    result[tablename] = (await owner.query(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS hash FROM public.${quoted} t`)).rows[0];
  }
  return result;
}
async function sessionFingerprint() {
  return (await owner.query(`SELECT count(*)::text AS count,
    md5(COALESCE(string_agg(md5((to_jsonb(s)-'last_seen_at')::text),'' ORDER BY md5((to_jsonb(s)-'last_seen_at')::text)),'')) AS securityHash,
    max(last_seen_at)::text AS latestSeen FROM owner_sessions s`)).rows[0];
}
await mkdir('.env.local-backups',{recursive:true});
const before = await fingerprint();
const sessionBefore=await sessionFingerprint();
const verifiedFiles=['db/migrations/011_automation_allocation.sql','src/lib/automation/allocation-domain.ts','src/lib/automation/allocation-service.ts',
  'src/lib/automation/composable-service.ts','src/lib/automation/income-events.ts','src/lib/automation/composable-facade.ts','src/lib/finance/service.ts',
  'src/lib/finance/types.ts','src/app/api/automation/route.ts','src/app/transactions/automation/page.tsx','src/components/automation-workspace.tsx',
  'src/components/allocation-review.tsx','src/components/allocation-summary.tsx','src/components/transactions-view.tsx',
  'tests/allocation-domain.test.mjs','tests/allocation-db.test.mjs','tests/allocation-presentation.test.mjs'];
const sourceHashes={};for(const file of verifiedFiles)sourceHashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
const targetLabel = '127.0.0.1:55433/moneta_p2_verify';
if (process.argv.includes('--preflight')) {
  await writeFile('.env.local-backups/allocation-preflight.json',JSON.stringify({target:targetLabel,installed,before},null,2));
  console.log(JSON.stringify({target:targetLabel,available:true,checksums:'001–010 match',tables:Object.keys(before).length}));
  await owner.end(); process.exit(0);
}
const stamp = new Date().toISOString().replace(/\D/g,'');
const name = `moneytor_composable_verify_${stamp}`;
const maintenance = new URL(ownerUrl); maintenance.pathname='/postgres';
const admin = new pg.Client({connectionString:maintenance.toString()}); await admin.connect();
await admin.query(`CREATE DATABASE "${name}"`); await admin.end();
const target = new URL(ownerUrl); target.pathname=`/${name}`;
const env = {...process.env,DATABASE_URL:target.toString(),MONEYTOR_COMPOSABLE_DB_TEST:name,MONEYTOR_ALLOCATION_DB_TEST:name,
  MONEYTOR_P3_DB_TEST:name,MONEYTOR_AUTOMATION_DB_TEST:name,MONEYTOR_EVENT_DB_TEST:name};
const runs=[];
function run(args) {
  const result=spawnSync(process.execPath,args,{env,encoding:'utf8',maxBuffer:8*1024*1024});
  process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');
  const stats={};for(const key of ['tests','pass','fail','skipped']){const match=result.stdout?.match(new RegExp(`(?:# |ℹ )${key} (\\d+)`));if(match)stats[key]=Number(match[1]);}
  runs.push({args,exitCode:result.status,...stats});
  if(result.error || result.status!==0)throw Error(`Failed: ${args.join(' ')}`);
}
let schemaObjects,initialCounts;
let passed=false,replay=false;
try {
  console.log(`Disposable: 127.0.0.1:55433/${name}`);
  run(['scripts/migrate.mjs','--apply',`--confirm-db=${name}`]);
  const db = new pg.Client({connectionString:target.toString()}); await db.connect();
  const migrations=(await db.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
  if(migrations.length!==11)throw Error('Expected migrations 001–011');
  for(const row of migrations)if(createHash('sha256').update(await readFile(`db/migrations/${row.name}`,'utf8')).digest('hex')!==row.checksum)throw Error('Disposable checksum mismatch');
  run(['scripts/migrate.mjs','--apply',`--confirm-db=${name}`]);
  replay=JSON.stringify(migrations)===JSON.stringify((await db.query('SELECT * FROM schema_migrations ORDER BY name')).rows);
  if(!replay)throw Error('Migration replay changed bookkeeping'); await db.end();
  const inspection=new pg.Client({connectionString:target.toString()});await inspection.connect();
  initialCounts={};
  for(const table of ['automation_allocation_assessments','automation_allocation_adjustments','automation_allocation_audit']){
    initialCounts[table]=Number((await inspection.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
    if(initialCounts[table]!==0)throw Error('Allocation migration must not copy historical rows');
  }
  schemaObjects={
    constraints:(await inspection.query("SELECT conrelid::regclass::text AS table_name,conname,contype,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid::regclass::text LIKE 'automation_allocation_%' ORDER BY table_name,conname")).rows,
    indexes:(await inspection.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename LIKE 'automation_allocation_%' ORDER BY tablename,indexname")).rows,
    triggers:(await inspection.query("SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname LIKE 'automation_allocation_%' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname")).rows};
  await inspection.end();
  run(['--test','tests/allocation-domain.test.mjs','tests/composable-domain.test.mjs','tests/income-event-domain.test.mjs','tests/automation-domain.test.mjs','tests/domain.test.mjs']);
  run(['--test','tests/allocation-presentation.test.mjs','tests/list-order.test.mjs','tests/presentation-order.test.mjs','tests/mobile-presentation.test.mjs']);
  run(['--conditions=react-server','--test','tests/allocation-db.test.mjs','tests/finance-db.test.mjs','tests/automation-db.test.mjs','tests/income-event-db.test.mjs','tests/composable-db.test.mjs']);
  passed=true;
} finally {
  const after=await fingerprint();const sessionAfter=await sessionFingerprint();await owner.end();
  const changed=Object.keys(before).filter(key=>JSON.stringify(before[key])!==JSON.stringify(after[key]));
  const operationalSessionOnly=changed.length===1 && changed[0]==='owner_sessions' && sessionBefore.count===sessionAfter.count && sessionBefore.securityhash===sessionAfter.securityhash;
  const preserved=changed.length===0 || operationalSessionOnly;
  const report={database:name,passed,migrationReplayNoOp:replay,runs,initialCounts,schemaObjects,sourceHashes,ownerTarget:targetLabel,ownerMigrationCount:installed.length,
    ownerChangedTables:changed,ownerDataPreserved:preserved,operationalSessionOnly,sessionBefore,sessionAfter,before,after};
  await writeFile(`.env.local-backups/allocation-verification-${stamp}.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({database:name,passed,replay,ownerChangedTables:changed,ownerDataPreserved:preserved,operationalSessionOnly,ownerMigrations:installed.length}));
  if(!preserved)throw Error('Owner fingerprint changed beyond operational session activity; investigate');
}
