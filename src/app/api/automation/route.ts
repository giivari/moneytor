import { assessAllocation, confirmAllocation } from "@/lib/automation/allocation-service";
import { reconcileAllAutomation } from "@/lib/automation/reconcile";
import { acknowledgeAutomationActivity, AutomationReviewError } from "@/lib/automation/review-service";
import type { Storage } from "@/lib/automation/composable-facade";
import type { ReviewDecision } from "@/lib/automation/review-domain";
import { AllocationError, type AllocationStorage } from "@/lib/automation/allocation-domain";
import { NextRequest, NextResponse } from "next/server";
import { assertRequestOrigin, boundedBody } from "@/lib/auth/http";
import { currentOwnerSession } from "@/lib/auth/session";
import { AutomationError, processOccurrence, reconcileAutomation, saveRule, setRuleStatus, skipOccurrence, voidOccurrence, type RuleInput } from "@/lib/automation/service";
import { IncomeEventError, postIncomeEvent, reconcileIncomeEvents, saveIncomeEventRule, setIncomeEventRuleStatus, skipIncomeEvent, type IncomeEventRuleInput } from "@/lib/automation/income-events";
import { ComposableError, type GeneralRuleInput } from "@/lib/automation/composable-domain";
import { confirmGeneralInstance, reconcileGeneralAutomation, saveAutomationCategory, saveGeneralRule, setAutomationCategoryStatus, setGeneralRuleStatus, skipGeneralInstance } from "@/lib/automation/composable-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
function json(value: unknown, status = 200) { return NextResponse.json(value, { status, headers }); }
export async function POST(request: NextRequest) {
  try {
    assertRequestOrigin(request);
    if (!await currentOwnerSession()) return json({ error: "Sesi berakhir." },401);
    if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "Format permintaan tidak valid." },415);
    const body = JSON.parse(await boundedBody(request)) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new AutomationError("Permintaan tidak valid.");
    const id = typeof body.id === "string" ? body.id : "";
    switch (body.action) {
      case "activity-review": {
        const result=await acknowledgeAutomationActivity(body.storage as Storage,id,typeof body.revision==='string'?body.revision:'',body.decision as ReviewDecision);
        return json(result.stale?{...result,error:'Sumber atau hasil berubah. Muat ulang rincian dan tinjau revisi terbaru.'}:result,result.stale?409:200);
      }
      case "allocation-assess": return json(await assessAllocation(body.storage as AllocationStorage,id));
      case "allocation-confirm": {
        const result = await confirmAllocation(id, (body.fees ?? {}) as Parameters<typeof confirmAllocation>[1]);
        return json(result,result.stale ? 409 : result.failed ? 400 : 200);
      }
      case "general-save": return json({ id: await saveGeneralRule(body.rule as GeneralRuleInput, id || undefined,
        typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined) });
      case "general-pause": await setGeneralRuleStatus(id, "paused"); break;
      case "general-resume": case "general-restore": await setGeneralRuleStatus(id, "active"); break;
      case "general-archive": await setGeneralRuleStatus(id, "archived"); break;
      case "general-skip": await skipGeneralInstance(id); break;
      case "general-post": return json({ id: await confirmGeneralInstance(id, typeof body.amountMinor === "string" ? body.amountMinor : undefined) });
      case "general-reconcile": return json(await reconcileGeneralAutomation());
      case "category-save": return json({ id: await saveAutomationCategory(body.name as string, id || undefined) });
      case "category-archive": await setAutomationCategoryStatus(id, "archived"); break;
      case "category-restore": await setAutomationCategoryStatus(id, "active"); break;
      case "event-save": return json({id:await saveIncomeEventRule(body.rule as IncomeEventRuleInput,id || undefined,
        typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined)});
      case "event-pause": await setIncomeEventRuleStatus(id,"paused"); break;
      case "event-resume": await setIncomeEventRuleStatus(id,"active"); break;
      case "event-archive": await setIncomeEventRuleStatus(id,"archived"); break;
      case "event-restore": await setIncomeEventRuleStatus(id,"active"); break;
      case "event-skip": await skipIncomeEvent(id); break;
      case "event-post": return json({id:await postIncomeEvent(id)});
      case "event-reconcile": return json(await reconcileIncomeEvents());
      case "save": return json({ id: await saveRule(body.rule as RuleInput, id || undefined,
        typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined) });
      case "pause": await setRuleStatus(id,"paused"); break;
      case "resume": await setRuleStatus(id,"active"); break;
      case "archive": await setRuleStatus(id,"archived"); break;
      case "restore": await setRuleStatus(id,"active"); break;
      case "skip": await skipOccurrence(id); break;
      case "post": return json({ id: await processOccurrence(id,typeof body.amountMinor === "string" ? body.amountMinor : undefined) });
      case "void": await voidOccurrence(id); break;
      case "reconcile": return json(await reconcileAutomation());
      case "reconcile-all": return json(await reconcileAllAutomation());
      default: return json({ error: "Tindakan tidak tersedia." },404);
    }
    return json({ ok:true });
  } catch (error) {
    return json({ error: error instanceof AutomationReviewError || error instanceof AllocationError || error instanceof AutomationError || error instanceof IncomeEventError || error instanceof ComposableError ? error.message : "Perubahan otomatisasi gagal. Periksa data dan coba lagi." },400);
  }
}
