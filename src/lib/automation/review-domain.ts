import type { AllocationSummary } from './allocation-domain';

export type ReviewDecision = 'acknowledged' | 'declined_allocation';
export type ReviewContext = {
  ready: boolean; revision: string; assessmentId: string | null; assessmentStale: boolean;
  ruleVersion?: number;
  reviewedAt: string | null; decision: ReviewDecision | null;
  originalSourceMinor: string | null; currentSourceMinor: string | null; lastSourceMinor: string | null;
  sourceStatus: string | null; sourceCurrency: string | null; sourceExponent: number;
  financialState: string; attention: 'needs_action' | 'needs_review' | 'reviewed' | 'none';
  tab: 'attention' | 'upcoming' | 'history'; canAcknowledge: boolean; canDecline: boolean;
};
export type ActivityTimelineEvent = { id: string; at: string; kind: 'financial' | 'source' | 'assessment' | 'review'; title: string; description: string };
export type ActivityReviewDetail = { context: ReviewContext; allocation?: AllocationSummary; timeline: ActivityTimelineEvent[]; timelineNote: string };

/** Financial truth remains independent from the owner's decision to acknowledge/decline. */
export function activityClassification(item: {status: string; resultId?: string | null; allocation?: AllocationSummary; review?: ReviewContext}) {
  if (item.review) return item.review;
  const a=item.allocation;
  const pending=['due','pending_confirmation','awaiting_confirmation','failed'].includes(item.status);
  const financialState=pending?item.status:a?.sourceVoided?'source_voided':a?.conditionsMatched===false?'conditions_unmet':a?.reason?'blocked':
    a?BigInt(a.differenceMinor)>0n?'allocation_shortfall':BigInt(a.differenceMinor)<0n?'allocation_excess':'allocation_aligned':item.status;
  const attention=pending?'needs_action':a?(financialState==='allocation_aligned'?'none':BigInt(a.differenceMinor)>0n?'needs_action':'needs_review'):
    item.status==='review_required'?'needs_review':'none';
  return {financialState,attention,tab:attention!=='none'?'attention':item.status==='upcoming'?'upcoming':'history',canAcknowledge:false,canDecline:false} as const;
}
export function financialStateLabel(state: string) {
  return ({allocation_shortfall:'Kurang dialokasikan',allocation_aligned:'Alokasi sesuai',allocation_excess:'Kelebihan alokasi',
    source_voided:'Sumber dibatalkan',assessment_stale:'Perlu penilaian ulang',conditions_unmet:'Kondisi asli tidak lagi terpenuhi',blocked:'Perlu ditinjau',review_required:'Sumber / hasil berubah',
    due:'Jatuh tempo',pending_confirmation:'Perlu konfirmasi',awaiting_confirmation:'Perlu konfirmasi',failed:'Perlu diperiksa',posted:'Tercatat',
    upcoming:'Akan datang',skipped:'Dilewati',voided:'Dibatalkan',superseded:'Diganti'} as Record<string,string>)[state] ?? state;
}
