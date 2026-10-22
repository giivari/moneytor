/** One projection feeds current tabs, bounded history queries, and stale-safe review commands. */
export function automationReviewQuery(ready: {schedule:boolean;income:boolean;general:boolean;allocation:boolean;review:boolean}) {
  const records:string[]=[];
  if(ready.schedule) records.push(`SELECT 'schedule'::text storage,o.id,o.status,o.activity_id result_id,NULL::uuid root_id,o.failure_reason failure,o.rule_version,
    o.scheduled_at event_at,'time'::text trigger_source,NULL::uuid category_id FROM recurring_transaction_occurrences o`);
  if(ready.income) records.push(`SELECT 'income_event',i.id,i.status,i.result_activity_id,i.root_activity_id,i.failure_reason,i.rule_version,
    COALESCE(s.eligible_at,i.created_at),'transaction_posted',NULL::uuid FROM income_event_instances i LEFT JOIN income_automation_sources s ON s.root_activity_id=i.root_activity_id`);
  if(ready.general) records.push(`SELECT 'general',i.id,i.status,i.result_activity_id,i.root_activity_id,i.failure_reason,i.version_no,i.eligible_at,i.trigger_namespace,r.category_id
    FROM automation_instances i JOIN automation_rules r ON r.id=i.rule_id WHERE i.status<>'not_matched'`);
  if(!records.length) return null;
  const assessment=ready.allocation?`SELECT a.id,a.state,a.reason,a.difference_minor,a.target_minor,a.recognized_minor,a.effective_activity_id,a.source_snapshot,a.result_snapshot,a.percentage_bps,
    (a.rule_snapshot->'evaluatedConditions'->>'matched')::boolean conditions_matched
    FROM automation_allocation_assessments a WHERE (i.storage='general' AND a.general_instance_id=i.id) OR (i.storage='income_event' AND a.legacy_instance_id=i.id)
    ORDER BY a.assessed_at DESC,a.id DESC LIMIT 1`:`SELECT NULL::uuid id,NULL::text state,NULL::text reason,NULL::bigint difference_minor,NULL::bigint target_minor,NULL::bigint recognized_minor,
    NULL::uuid effective_activity_id,NULL::jsonb source_snapshot,NULL::jsonb result_snapshot,NULL::int percentage_bps,NULL::boolean conditions_matched`;
  const resultRoots=ready.allocation?`UNION SELECT p.result_activity_id FROM automation_allocation_adjustments p JOIN automation_allocation_assessments a ON a.id=p.assessment_id
    WHERE p.status='posted' AND ((i.storage='general' AND a.general_instance_id=i.id) OR (i.storage='income_event' AND a.legacy_instance_id=i.id))`:'';
  const review=ready.review?`SELECT v.decision,v.reviewed_at FROM automation_activity_reviews v WHERE v.revision=b.revision AND
    ((b.storage='schedule' AND v.schedule_instance_id=b.id) OR (b.storage='income_event' AND v.legacy_instance_id=b.id) OR (b.storage='general' AND v.general_instance_id=b.id))`:
    `SELECT NULL::text decision,NULL::timestamptz reviewed_at`;
  return `WITH records AS (${records.join(' UNION ALL ')}), facts AS (
    SELECT i.*,i.storage||':'||i.id AS key,a.id assessment_id,a.state allocation_state,a.reason,a.difference_minor,a.target_minor,a.recognized_minor,a.conditions_matched,a.percentage_bps,
      original.base_amount_minor::text original_source_minor,src.base_amount_minor::text last_source_minor,
      CASE WHEN src.status='posted' THEN src.base_amount_minor ELSE 0 END::text current_source_minor,src.status source_status,src.currency_code source_currency,
      COALESCE(c.minor_unit_exponent,0) source_exponent,
      (a.id IS NOT NULL AND (a.effective_activity_id IS DISTINCT FROM src.id OR a.source_snapshot->>'status' IS DISTINCT FROM src.status OR
        EXISTS(SELECT 1 FROM jsonb_array_elements(a.result_snapshot) snap WHERE NOT EXISTS(
          SELECT 1 FROM jsonb_array_elements(results.facts) actual WHERE actual->>'id'=snap->>'id' AND actual->>'status'=snap->>'status')))) assessment_stale,
      encode(sha256(convert_to(jsonb_build_object('instance',i.id,'ruleVersion',i.rule_version,'status',i.status,'failure',i.failure,'assessment',a.id,'source',to_jsonb(src),'results',results.facts)::text,'UTF8')),'hex') revision
    FROM records i
    LEFT JOIN financial_activities original ON original.id=i.root_id
    LEFT JOIN LATERAL (WITH RECURSIVE chain AS (
      SELECT f.id,f.status,f.base_amount_minor,f.currency_code,f.kind,f.source_asset_id,f.destination_asset_id,f.category_id,0 depth FROM financial_activities f WHERE f.id=i.root_id
      UNION ALL SELECT f.id,f.status,f.base_amount_minor,f.currency_code,f.kind,f.source_asset_id,f.destination_asset_id,f.category_id,chain.depth+1
      FROM financial_activities f JOIN chain ON f.replaces_activity_id=chain.id WHERE chain.depth<100)
      SELECT * FROM chain ORDER BY depth DESC LIMIT 1) src ON TRUE
    LEFT JOIN currencies c ON c.code=src.currency_code
    LEFT JOIN LATERAL (${assessment}) a ON TRUE
    LEFT JOIN LATERAL (WITH RECURSIVE roots AS (SELECT i.result_id root_id WHERE i.result_id IS NOT NULL ${resultRoots}), chain AS (
      SELECT f.id,f.status,f.base_amount_minor,f.kind,f.currency_code,f.source_asset_id,f.destination_asset_id,f.category_id,r.root_id,0 depth
        FROM roots r JOIN financial_activities f ON f.id=r.root_id
      UNION ALL SELECT f.id,f.status,f.base_amount_minor,f.kind,f.currency_code,f.source_asset_id,f.destination_asset_id,f.category_id,chain.root_id,chain.depth+1
        FROM financial_activities f JOIN chain ON f.replaces_activity_id=chain.id WHERE chain.depth<100), latest AS (
      SELECT DISTINCT ON (root_id) * FROM chain ORDER BY root_id,depth DESC)
      SELECT COALESCE(jsonb_agg(to_jsonb(latest) ORDER BY root_id),'[]'::jsonb) facts FROM latest) results ON TRUE
  ), basis AS (SELECT facts.*,
    CASE WHEN status IN ('due','pending_confirmation','awaiting_confirmation','failed') THEN status
      WHEN source_status='voided' AND (assessment_id IS NOT NULL OR status='review_required') THEN 'source_voided'
      WHEN assessment_stale THEN 'assessment_stale'
      WHEN conditions_matched=FALSE THEN 'conditions_unmet' WHEN reason IS NOT NULL THEN 'blocked'
      WHEN assessment_id IS NOT NULL THEN CASE WHEN difference_minor>0 THEN 'allocation_shortfall' WHEN difference_minor<0 THEN 'allocation_excess' ELSE 'allocation_aligned' END
      ELSE status END financial_state FROM facts), decisions AS (
    SELECT b.*,v.decision,v.reviewed_at,${ready.review} review_ready,
      (status NOT IN ('upcoming','due','pending_confirmation','awaiting_confirmation','failed','skipped','superseded') AND result_id IS NOT NULL AND
        (status='review_required' OR assessment_stale OR (assessment_id IS NOT NULL AND financial_state<>'allocation_aligned'))) review_eligible
    FROM basis b LEFT JOIN LATERAL (${review}) v ON TRUE
  ), attention AS (SELECT decisions.*,
    CASE WHEN status IN ('due','pending_confirmation','awaiting_confirmation','failed') THEN 'needs_action'
      WHEN financial_state='allocation_aligned' AND NOT assessment_stale THEN 'none'
      WHEN review_eligible THEN CASE WHEN decision='declined_allocation' AND difference_minor>0 THEN 'reviewed'
        WHEN decision='acknowledged' AND COALESCE(difference_minor,0)<=0 THEN 'reviewed'
        WHEN difference_minor>0 THEN 'needs_action' ELSE 'needs_review' END
      ELSE 'none' END attention FROM decisions)
    SELECT *,CASE WHEN attention IN ('needs_action','needs_review') THEN 'attention' WHEN status='upcoming' THEN 'upcoming' ELSE 'history' END tab FROM attention`;
}
