import {loadEnvFile} from 'node:process';
import {spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {automationReviewQuery} from '../src/lib/automation/review-query.ts';

loadEnvFile('.env.local');
const ownerUrl=new URL(process.env.DATABASE_URL);
if(ownerUrl.hostname!=='127.0.0.1'||ownerUrl.port!=='55433'||ownerUrl.pathname!=='/moneta_p2_verify')throw Error('Unexpected owner target');
const owner=new pg.Client({connectionString:ownerUrl.toString()});await owner.connect();await owner.query('SET default_transaction_read_only=on');
async function fingerprint() {
 const output={};
 for(const {tablename} of (await owner.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows) {
  const quoted='"'+tablename.replaceAll('"','""')+'"';
  output[tablename]=(await owner.query(`SELECT count(*)::text count,md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) hash FROM public.${quoted} t`)).rows[0];
 }
 return output;
}
const installed=(await owner.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).rows;
if(installed.length!==11||installed.at(-1).name!=='011_automation_allocation.sql')throw Error('Owner must remain on migration 011');
for(const row of installed)if(createHash('sha256').update(await readFile(`db/migrations/${row.name}`)).digest('hex')!==row.checksum)throw Error('Existing migration checksum drift');
async function sessions() {
 return (await owner.query(`SELECT md5(token_hash) row_ref,md5((to_jsonb(s)-'last_seen_at')::text) stable_hash,
   created_at,last_seen_at,expires_at,revoked_at,credential_id FROM owner_sessions s ORDER BY token_hash`)).rows;
}
const before=await fingerprint(),sessionsBefore=await sessions(),stamp=new Date().toISOString().replace(/\D/g,''),name=`moneytor_composable_verify_${stamp}`;
const query=automationReviewQuery({schedule:true,income:true,general:true,allocation:true,review:false});
const ownerState=(await owner.query(`SELECT key,financial_state,attention,tab,original_source_minor,current_source_minor,last_source_minor,source_status,target_minor::text,recognized_minor::text,difference_minor::text FROM (${query}) q WHERE root_id IS NOT NULL ORDER BY event_at DESC,key DESC LIMIT 10`)).rows;
const maintenance=new URL(ownerUrl);maintenance.pathname='/postgres';
const admin=new pg.Client({connectionString:maintenance.toString()});await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);await admin.end();
const target=new URL(ownerUrl);target.pathname='/'+name;
const env={...process.env,DATABASE_URL:target.toString(),MONEYTOR_ALLOCATION_DB_TEST:name,MONEYTOR_COMPOSABLE_DB_TEST:name,MONEYTOR_AUTOMATION_DB_TEST:name,MONEYTOR_EVENT_DB_TEST:name,MONEYTOR_P3_DB_TEST:name,MONEYTOR_PRESENTATION_DB_TEST:name};
const runs=[];let passed=false,noOp=false;let registry=[];
function run(args) {
 const result=spawnSync(process.execPath,args,{env,encoding:'utf8',maxBuffer:12*1024*1024});
 process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');
 runs.push({args,exitCode:result.status});
 if(result.error||result.status!==0)throw Error('Verification command failed: '+args.join(' '));
}
try {
 console.log('Disposable target: 127.0.0.1:55433/'+name);
 run(['scripts/migrate.mjs','--apply',`--confirm-db=${name}`]);
 const db=new pg.Client({connectionString:target.toString()});await db.connect();
 registry=(await db.query('SELECT * FROM schema_migrations ORDER BY name')).rows;
 if(registry.length!==12)throw Error('Expected migrations 001–012');
 for(const row of registry)if(createHash('sha256').update(await readFile(`db/migrations/${row.name}`)).digest('hex')!==row.checksum)throw Error('Disposable checksum mismatch');
 if(Number((await db.query('SELECT count(*) FROM automation_activity_reviews')).rows[0].count)!==0)throw Error('Migration created synthetic reviews');
 run(['scripts/migrate.mjs','--apply',`--confirm-db=${name}`]);
 noOp=JSON.stringify(registry)===JSON.stringify((await db.query('SELECT * FROM schema_migrations ORDER BY name')).rows);
 await db.end();if(!noOp)throw Error('Migration rerun changed registry');
 run(['--conditions=react-server','--test','tests/allocation-db.test.mjs','tests/composable-db.test.mjs','tests/automation-db.test.mjs','tests/income-event-db.test.mjs','tests/finance-db.test.mjs','tests/presentation-db.test.mjs']);
 passed=true;
} finally {
 const after=await fingerprint(),sessionsAfter=await sessions(),changed=Object.keys(before).filter(table=>JSON.stringify(before[table])!==JSON.stringify(after[table]));
 const stableSession=(rows)=>rows.map(row=>Object.fromEntries(Object.entries(row).filter(([field])=>field!=='last_seen_at')));
 const sessionMetadataOnly=JSON.stringify(stableSession(sessionsBefore))===JSON.stringify(stableSession(sessionsAfter));
 const sessionChanges=sessionsBefore.flatMap(row=>{const next=sessionsAfter.find(next=>next.row_ref===row.row_ref);return next&&String(row.last_seen_at)!==String(next.last_seen_at)?[{row:row.row_ref,field:'last_seen_at',before:row.last_seen_at,after:next.last_seen_at}]:[];});
 await owner.end();await mkdir('.env.local-backups',{recursive:true});
 const report={verifiedAt:new Date().toISOString(),database:name,passed,noOp,ownerTarget:'127.0.0.1:55433/moneta_p2_verify',ownerMigrations:installed,ownerPreserved:changed.length===0,sessionMetadataOnly,sessionChanges,sessionsBefore,sessionsAfter,changed,ownerState,ownerBefore:before,ownerAfter:after,registry,runs};
 await writeFile(`.env.local-backups/automation-review-verification-${stamp}.json`,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({database:name,passed,noOp,ownerPreserved:changed.length===0,changed,ownerMigrationCount:installed.length}));
 if(changed.some(table=>table!=='owner_sessions')||!sessionMetadataOnly)throw Error('Owner table fingerprints changed beyond measured last_seen_at; investigate exact differences');
}
