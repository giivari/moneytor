"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "@phosphor-icons/react";
import { CompactChoice } from "./compact-choice";
import { ResponsiveDisclosure } from "./responsive-disclosure";
import { actionRegistry, amountRegistry, bpsToPercent, capabilities, conditionRegistry, normalizeGeneralRule, percentToBps,
  type AmountStrategy, type AssetReference, type Condition, type ConditionField, type FinancialAction, type GeneralRuleInput, type Operator, type Trigger } from "@/lib/automation/composable-domain";
import { jakartaToday } from "@/lib/automation/schedule";
import { formatMinor, inputToMinor, minorToInput } from "@/lib/finance/format";
import { requestJson, type FinanceOptions } from "@/lib/finance/client";
import { useFinanceOptions, FinanceOptionsStatus } from "./finance-form-hooks";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { LoadingIndicator } from "./loading-indicator";
import { OptionalChargesEditor } from "./optional-charges-editor";
import { OptionalFormSection } from "./optional-form-section";
import { CompactFormSection } from "./compact-form-section";
import { useMobileViewport } from "./use-mobile-viewport";
import type { GeneralView } from "@/lib/automation/composable-service";
import { builderCapabilities, legacyRulePayload, type Storage } from "@/lib/automation/composable-facade";

export function automationMutation(action: string, body: Record<string, unknown> = {}) {
  return requestJson<{ id?: string }>("/api/automation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...body }), cache: "no-store" });
}
type BuilderSection = "basics" | "trigger" | "conditions" | "action" | "amount" | "execution" | "optional";
const referenceLabels = { configured_asset: "Pilih aset", trigger_source_asset: "Aset sumber transaksi pemicu", trigger_destination_asset: "Aset penerima transaksi pemicu" };
const operatorLabels: Record<Operator, string> = { equals: "Sama dengan", not_equals: "Tidak sama dengan", greater_than: "Lebih dari", greater_or_equal: "Minimal",
  less_than: "Kurang dari", less_or_equal: "Maksimal", between: "Di antara" };
function initialRule(): GeneralRuleInput {
  return { title: "", trigger: { namespace: "time", schedule: { frequency: "monthly_day", monthDay: 1, startOn: jakartaToday(), localTime: "09:00" } },
    conditions: [], conditionMode: "ALL", actions: [{ kind: "expense", source: { strategy: "configured_asset", assetId: "" }, amount: { strategy: "fixed", amountMinor: "", currency: "IDR" }, charges: [] }], execution: "confirm_before_execute" };
}
function AssetField({ label, value, onChange, allowed, options, disabled }: { label: string; value?: AssetReference; onChange: (ref: AssetReference) => void;
  allowed: AssetReference["strategy"][]; options: FinanceOptions; disabled: boolean }) {
  return <div className="automation-asset-reference">
    {allowed.length > 1 && <label className="field"><span>{label}: referensi</span><select disabled={disabled} value={value?.strategy ?? "configured_asset"}
      onChange={(event) => onChange(event.target.value === "configured_asset" ? { strategy: "configured_asset", assetId: "" } : { strategy: event.target.value as "trigger_source_asset" | "trigger_destination_asset" })}>
      {allowed.map((strategy) => <option key={strategy} value={strategy}>{referenceLabels[strategy]}</option>)}</select></label>}
    {(!value || value.strategy === "configured_asset") ? <label className="field"><span>{label}</span><select required disabled={disabled} value={value?.strategy === "configured_asset" ? value.assetId : ""}
      onChange={(event) => onChange({ strategy: "configured_asset", assetId: event.target.value })}><option value="">Pilih aset</option>
      {options.assets.filter((asset) => asset.isActive).map((asset) => <option key={asset.id} value={asset.id}>{asset.displayName} · {asset.currency}</option>)}</select></label>
      : <p className="finance-hint">{referenceLabels[value.strategy]}</p>}
  </div>;
}
export function AutomationBuilder({ editing, categories }: { editing?: { id: string; input: GeneralRuleInput; storage: Storage }; categories: GeneralView["categories"] }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const categoryCreation = useRef<HTMLDetailsElement>(null);
  const [dirty, setDirty] = useState(false);
  const leaving = useRef(false);
  const [optionalVisited, setOptionalVisited] = useState(false);
  const { options, optionsError, retry } = useFinanceOptions();
  const { refresh, notify } = useFinanceFeedback();
  const { pending, begin, finish } = useMutationPending();
  const [draft, setDraft] = useState<GeneralRuleInput>(() => editing ? structuredClone(editing.input) : initialRule());
  const originalDraft = useRef(JSON.stringify(draft));
  useEffect(() => { if (JSON.stringify(draft) !== originalDraft.current) setDirty(true); }, [draft]);
  const [triggerChosen, setTriggerChosen] = useState(Boolean(editing));
  const [actionChosen, setActionChosen] = useState(Boolean(editing));
  const [error, setError] = useState("");
  const [percentage, setPercentage] = useState(editing?.input.actions[0].amount.strategy === "percentage_of_trigger" ? bpsToPercent(editing.input.actions[0].amount.percentageBps) : "10");
  const [moneyInput, setMoneyInput] = useState<string | null>(null);
  const [feeInput, setFeeInput] = useState<string | null>(null);
  const [localCategories, setLocalCategories] = useState(categories);
  const [newCategory, setNewCategory] = useState("");
  const [chargesEnabled, setChargesEnabled] = useState(Boolean(editing?.input.actions[0].charges.length));
  const [chargeRows,setChargeRows]=useState<{typeId:string;amount:string}[]|null>(null);
  const [feeEnabled, setFeeEnabled] = useState(Boolean(editing?.input.actions[0].transferFeeMinor));
  const requestKey = useRef(crypto.randomUUID());
  const mobile = useMobileViewport();
  const [openSections, setOpenSections] = useState<BuilderSection[]>(editing ? ["basics"] : ["basics", "trigger"]);
  const [sectionErrors, setSectionErrors] = useState<BuilderSection[]>([]);
  const invalidFocus = useRef<HTMLElement | null>(null);
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error && !invalidFocus.current) feedback.current?.scrollIntoView({ block: "nearest" }); }, [error]);
  const storage=editing?.storage ?? "general";
  const action = draft.actions[0], meta = builderCapabilities(draft,storage);
  const changeAction = (patch: Partial<FinancialAction>) => setDraft((value) => ({ ...value, actions: [{ ...value.actions[0], ...patch }] }));
  const exponentFor = (currency: string) => options?.currencies.find((item) => item.code === currency)?.exponent ?? 0;
  const configured = [action.source, action.destination].find((ref) => ref?.strategy === "configured_asset" && ref.assetId);
  const currency = action.amount.strategy === "fixed" ? action.amount.currency : configured?.strategy === "configured_asset" ? options?.assets.find((asset) => asset.id === configured.assetId)?.currency : storage==="income_event"?"unit terkecil":undefined;
  const exponent = exponentFor(currency ?? "IDR");
  const assetSummary = (ref?: AssetReference) => !ref ? "Pilih aset" : ref.strategy === "configured_asset"
    ? options?.assets.find((item) => item.id === ref.assetId)?.displayName ?? "Pilih aset" : referenceLabels[ref.strategy];
  const schedule = draft.trigger.namespace === "time" ? draft.trigger.schedule : undefined;
  const weekday = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
  const frequencySummary = schedule ? schedule.frequency === "monthly_day" ? `Tgl ${schedule.monthDay ?? 1} setiap bulan`
    : schedule.frequency === "weekly" ? `Setiap ${weekday[(schedule.weekday ?? 1) - 1]}` : schedule.frequency === "monthly_last_day" ? "Hari terakhir setiap bulan"
    : schedule.frequency === "daily" ? "Setiap hari" : schedule.frequency === "weekdays" ? "Senin–Jumat" : schedule.startOn || "Pilih tanggal" : "";
  let amountSummary = "Pilih nominal";
  try {
    if (action.amount.strategy === "fixed") {
      const minor = moneyInput !== null ? inputToMinor(moneyInput, exponent) : action.amount.amountMinor;
      amountSummary = minor ? `${formatMinor(minor, action.amount.currency, exponent)} tetap` : "Isi nominal tetap";
    } else if (action.amount.strategy === "percentage_of_trigger") amountSummary = `${bpsToPercent(percentToBps(percentage))}% dari transaksi pemicu`;
    else amountSummary = action.amount.strategy === "trigger_amount" ? "Sama dengan transaksi pemicu" : "Diisi saat konfirmasi";
  } catch { amountSummary = "Periksa nominal"; }
  const categoryName = options?.catalogs.transactionCategories.find((item) => item.id === action.categoryId)?.displayName;
  const chargeCount = chargesEnabled ? (chargeRows ?? action.charges).length : 0;
  const summaries: Record<BuilderSection, string> = {
    basics: [draft.title.trim() || "Beri nama otomatisasi", localCategories.find((item) => item.id === draft.automationCategoryId)?.name].filter(Boolean).join(" · "),
    trigger: !triggerChosen ? "Pilih pemicu" : schedule ? `Waktu tertentu · ${frequencySummary} · ${schedule.localTime || "Pilih waktu"} WIB`
      : `Transaksi terjadi · ${draft.trigger.namespace === "transaction_posted" && draft.trigger.activityKind ? actionRegistry[draft.trigger.activityKind].label : "Semua jenis"}`,
    conditions: draft.conditions.length ? `${draft.conditions.length} kondisi · ${draft.conditionMode === "ALL" ? "Semua harus cocok" : "Salah satu cukup"}` : "Tanpa kondisi",
    action: !actionChosen ? "Pilih tindakan" : `${actionRegistry[action.kind].label} · ${action.kind === "income" ? assetSummary(action.destination)
      : action.kind === "transfer" ? `${assetSummary(action.source)} → ${assetSummary(action.destination)}` : assetSummary(action.source)}`,
    amount: amountSummary,
    execution: meta.executions.length === 1 ? "Konfirmasi diperlukan" : draft.execution === "automatic" ? "Jalankan otomatis" : "Minta konfirmasi",
    optional: [categoryName ? `Kategori: ${categoryName}` : action.kind !== "transfer" ? "Tanpa kategori" : "",
      chargeCount ? `${chargeCount} biaya tambahan` : action.kind === "transfer" && feeEnabled ? "Dengan biaya transfer" : "Tanpa biaya", action.note?.trim() ? "Dengan catatan" : ""].filter(Boolean).join(" · "),
  };
  function completeSection(id: BuilderSection) {
    if (id === "basics" && !draft.title.trim() || id === "trigger" && !triggerChosen || id === "action" && !actionChosen) return false;
    if (id === "amount" && ["Pilih nominal", "Isi nominal tetap", "Periksa nominal"].includes(amountSummary)) return false;
    const node = form.current?.querySelector(`[data-builder-section="${id}"]`);
    return !sectionErrors.includes(id) && Array.from(node?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea") ?? []).every((control) => control.disabled || control.validity.valid);
  }
  function openSection(id: BuilderSection) {
    if (id === "optional") setOptionalVisited(true);
    setOpenSections((previous) => mobile ? [...previous.filter((item) => item !== id && !completeSection(item)), id] : [...new Set([...previous, id])]);
  }
  function sectionProps(id: BuilderSection, label: string) {
    const noConditionRows = id === "conditions" && draft.conditions.length === 0;
    const singlePolicy = id === "execution" && meta.executions.length === 1;
    return { id, label, summary: summaries[id], disabled: pending, invalid: sectionErrors.includes(id),
      expanded: noConditionRows || (!mobile && id !== "optional") || (!singlePolicy && openSections.includes(id)),
      collapsible: !noConditionRows && !singlePolicy && (mobile || id === "optional"),
      onExpandedChange: (expanded: boolean) => expanded ? openSection(id) : setOpenSections((previous) => previous.filter((item) => item !== id)) };
  }
  function revealError(id: BuilderSection) {
    if (id === "optional") setOptionalVisited(true);
    setSectionErrors((previous) => [...new Set([...previous, id])]);
    setOpenSections((previous) => [...new Set([...previous, id])]);
  }
  function resetTrigger(namespace: Trigger["namespace"], activityKind?: "income" | "expense" | "transfer") {
    const trigger: Trigger = namespace === "time" ? initialRule().trigger : { namespace, ...(activityKind ? { activityKind } : {}) };
    const next = { ...draft, trigger, conditions: [], execution: "confirm_before_execute" as const };
    const compatible = capabilities(next);
    const cleanRef = (ref: AssetReference | undefined) => ref && !compatible.references.includes(ref.strategy) ? { strategy: "configured_asset" as const, assetId: "" } : ref;
    next.actions = [{ ...action, source: cleanRef(action.source), destination: cleanRef(action.destination),
      amount: compatible.amountStrategies.includes(action.amount.strategy) ? action.amount : { strategy: "fixed", amountMinor: "", currency: "IDR" } }];
    setDraft(next); setTriggerChosen(true); setMoneyInput(null);
  }
  function updateCondition(index: number, patch: Partial<Condition>) {
    setDraft((value) => {
      const next = { ...value, conditions: value.conditions.map((condition, i) => i === index ? { ...condition, ...patch } : condition) };
      const allowed = capabilities(next).references;
      next.actions = next.actions.map((item) => ({ ...item,
        source: item.source && !allowed.includes(item.source.strategy) ? { strategy: "configured_asset", assetId: "" } : item.source,
        destination: item.destination && !allowed.includes(item.destination.strategy) ? { strategy: "configured_asset", assetId: "" } : item.destination }));
      return next;
    });
  }
  async function createCategory() {
    if (!begin()) return;
    setError("");
    try {
      const result = await automationMutation("category-save", { name: newCategory });
      setLocalCategories((items) => [...items.filter((item) => item.id !== result.id), { id: result.id!, name: newCategory.trim(), status: "active" }]);
      setDraft((value) => ({ ...value, automationCategoryId: result.id })); setNewCategory(""); if (categoryCreation.current) categoryCreation.current.open = false; refresh();
    } catch (cause) { revealError("basics"); setError(cause instanceof Error ? cause.message : "Kategori gagal disimpan."); } finally { finish(); }
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!triggerChosen || !actionChosen) { revealError(!triggerChosen ? "trigger" : "action"); setError("Pilih pemicu dan tindakan."); return; }
    if (!begin()) return;
    setError("");
    let conversionSection: BuilderSection | undefined = "amount";
    try {
      let amount: AmountStrategy = action.amount;
      if (amount.strategy === "fixed" && moneyInput !== null) amount = { ...amount, amountMinor: inputToMinor(moneyInput, exponent) };
      if (amount.strategy === "percentage_of_trigger") amount = { ...amount, percentageBps: percentToBps(percentage) };
      conversionSection = "optional";
      const submitted = { ...draft, actions: [{ ...action, amount,
        charges: action.kind === "expense" && chargesEnabled && currency ? chargeRows===null?action.charges:chargeRows.map((item)=>({typeId:item.typeId,amountMinor:inputToMinor(item.amount,exponent)})) : [],
        transferFeeMinor: action.kind === "transfer" && feeEnabled && currency ? feeInput === null ? action.transferFeeMinor : inputToMinor(feeInput, exponent) : undefined }] };
      conversionSection = undefined;
      await automationMutation(storage==="general"?"general-save":storage==="schedule"?"save":"event-save", {
        id: editing?.id, rule: storage==="general"?normalizeGeneralRule(submitted):legacyRulePayload(storage,submitted), idempotencyKey: requestKey.current });
      notify("Otomatisasi disimpan."); leaving.current = true; router.replace("/transactions/automation"); refresh();
    } catch (cause) { if (conversionSection) revealError(conversionSection); setError(cause instanceof Error ? cause.message : "Otomatisasi gagal disimpan."); } finally { finish(); }
  }
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { if (!leaving.current) event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  function leave() {
    if (pending || dirty && !window.confirm("Perubahan belum disimpan. Kembali ke Otomatisasi?")) return;
    leaving.current = true; router.push("/transactions/automation");
  }
  const summary = <RuleSummary summaries={summaries} conditions={draft.conditions} options={options} />;
  return <div className="page automation-editor">
    <div className="automation-editor-toolbar">
      <button type="button" className="row-action automation-editor-back" disabled={pending} onClick={leave}><ArrowLeft size={18} aria-hidden="true" /> <span>Otomatisasi</span></button>
      <aside className="automation-editor-context" aria-label="Kontrol dan ringkasan otomatisasi">
      <div className="automation-editor-actions">
        <button type="button" className="finance-secondary automation-editor-cancel" disabled={pending} onClick={leave}>Batal</button>
        <button type="submit" form="automation-editor-form" className="button-primary" disabled={pending || !options}>
          {pending ? <LoadingIndicator>Menyimpan…</LoadingIndicator> : <><span className="automation-editor-save-long">Simpan otomatisasi</span><span className="automation-editor-save-short">Simpan</span></>}
        </button>
      </div>
      <div className="automation-editor-summary" tabIndex={0} role="region" aria-labelledby="automation-rule-summary-title"><h2 id="automation-rule-summary-title">Ringkasan aturan</h2>{summary}</div>
      </aside>
    </div>
    <header className="automation-editor-heading"><h1>{editing ? "Ubah otomatisasi" : "Buat otomatisasi"}</h1>
      <p>Tentukan kapan aturan berjalan, syaratnya, dan tindakan yang dilakukan.</p></header>
    {error && <div ref={feedback} className="automation-builder-feedback"><p role="alert" className="finance-error">{error}</p>
      <button type="button" className="row-action" onClick={() => { setOptionalVisited(true); setOpenSections(["basics", "trigger", "conditions", "action", "amount", "execution", "optional"]); }}>Tinjau isian</button></div>}
    <div className="automation-editor-summary-inline"><ResponsiveDisclosure label="Ringkasan aturan">{summary}</ResponsiveDisclosure></div>
    {!options ? <FinanceOptionsStatus error={optionsError} retry={retry} /> : <div className="automation-editor-layout">
    <form ref={form} id="automation-editor-form" className="automation-form" onSubmit={save} aria-busy={pending}
      onInputCapture={() => setDirty(true)}
      onInvalidCapture={(event) => {
        event.preventDefault();
        const control = event.target as HTMLInputElement;
        const section = control.closest<HTMLElement>("[data-builder-section]")?.dataset.builderSection as BuilderSection | undefined;
        if (section) revealError(section);
        setError("Periksa isian pada bagian yang ditandai.");
        if (!invalidFocus.current) {
          invalidFocus.current = control;
          requestAnimationFrame(() => { const target = invalidFocus.current; invalidFocus.current = null; target?.focus(); target?.scrollIntoView({ block: "center" }); });
        }
      }}
      onChangeCapture={(event) => {
        setDirty(true);
        const section = (event.target as HTMLElement).closest<HTMLElement>("[data-builder-section]")?.dataset.builderSection;
        if (section) setSectionErrors((previous) => previous.filter((id) => id !== section));
      }}>
      <div className="automation-builder-body">
      <CompactFormSection {...sectionProps("basics", "Dasar")}>
        <label className="field"><span>Nama otomatisasi</span><input autoFocus required maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        {storage==="general" && <><label className="field"><span>Kategori otomatisasi (opsional)</span><select value={draft.automationCategoryId ?? ""} onChange={(event) => { setDraft({ ...draft, automationCategoryId: event.target.value || undefined }); if (categoryCreation.current) categoryCreation.current.open = false; }}>
          <option value="">Tanpa kategori</option>{localCategories.filter((item) => item.status === "active" || item.id === draft.automationCategoryId).map((item) => <option key={item.id} value={item.id}>{item.name}{item.status === "archived" ? " (diarsipkan)" : ""}</option>)}</select></label>
        <details ref={categoryCreation} className="history-detail"><summary>Buat kategori</summary><div className="inline-field-action">
          <label className="field"><span>Nama kategori</span><input maxLength={80} value={newCategory} onChange={(event) => setNewCategory(event.target.value)} /></label>
          <button type="button" className="finance-secondary" disabled={pending || !newCategory.trim()} onClick={createCategory}>Tambah kategori</button></div></details></>}
      </CompactFormSection>
      <CompactFormSection {...sectionProps("trigger", "Kapan")}>
        {meta.triggers.length===1 ? <p className="finance-hint">{draft.trigger.namespace==="time"?"Waktu tertentu":"Transaksi pemasukan dicatat"}</p> : <CompactChoice label="Pemicu" required value={triggerChosen ? draft.trigger.namespace : undefined} options={meta.triggers.map((value) => ({ value, label: value === "time" ? "Waktu tertentu" : "Transaksi terjadi" }))} onChange={(value) => resetTrigger(value)} />}
        {storage==="general" && triggerChosen && draft.trigger.namespace === "transaction_posted" && <label className="field"><span>Transaksi yang dicatat</span><select value={draft.trigger.activityKind ?? ""} onChange={(event) => resetTrigger("transaction_posted", event.target.value as "income" | "expense" | "transfer" || undefined)}>
          <option value="">Semua jenis</option>{Object.entries(actionRegistry).map(([kind, value]) => <option key={kind} value={kind}>{value.label}</option>)}</select></label>}
        {triggerChosen && draft.trigger.namespace === "time" && <TimeFields frequencies={meta.timeFrequencies} trigger={draft.trigger} onChange={(trigger) => setDraft({ ...draft, trigger })} />}
      </CompactFormSection>
      {triggerChosen && meta.conditionFields.length > 0 && <CompactFormSection {...sectionProps("conditions", "Hanya jika (opsional)")} action={<button type="button" className="row-action" disabled={draft.conditions.length >= 20} onClick={() => { openSection("conditions"); setDraft({ ...draft, conditions: [...draft.conditions, { field: "transaction_type", operator: "equals", value: "income" }] }); }}>+ Tambah kondisi</button>}>
        {draft.conditions.length > 0 && <CompactChoice<"ALL" | "ANY"> label="Pencocokan" value={draft.conditionMode} options={[{ value: "ALL", label: "Semua" }, { value: "ANY", label: "Salah satu" }]} onChange={(mode) => {
          const next = { ...draft, conditionMode: mode };
          const allowed = capabilities(next).references;
          next.actions = next.actions.map((item) => ({ ...item, source: item.source && !allowed.includes(item.source.strategy) ? { strategy: "configured_asset", assetId: "" } : item.source,
            destination: item.destination && !allowed.includes(item.destination.strategy) ? { strategy: "configured_asset", assetId: "" } : item.destination }));
          setDraft(next);
        }} />}
        {draft.conditions.map((condition, index) => <div className="automation-condition" data-field={condition.field} key={index}>
          <label className="field"><span>Kondisi {index + 1}</span><select value={condition.field} onChange={(event) => updateCondition(index, { field: event.target.value as ConditionField, operator: "equals", value: "", upperValue: undefined, currency: undefined })}>
            {meta.conditionFields.map((field) => <option key={field} value={field}>{conditionRegistry[field].label}</option>)}</select></label>
          <label className="field"><span>Perbandingan</span><select value={condition.operator} onChange={(event) => updateCondition(index, { operator: event.target.value as Operator, upperValue: event.target.value === "between" ? "" : undefined })}>
            {conditionRegistry[condition.field].operators.map((operator) => <option key={operator} value={operator}>{operatorLabels[operator]}</option>)}</select></label>
          <div className="automation-condition-value"><ConditionValue condition={condition} options={options} onChange={(patch) => updateCondition(index, patch)} /></div>
          <button type="button" className="row-action automation-condition-remove" data-tone="warning" aria-label={`Hapus kondisi ${index + 1}`} onClick={() => {
            const next = { ...draft, conditions: draft.conditions.filter((_, i) => i !== index) };
            const allowed = capabilities(next).references;
            next.actions = next.actions.map((item) => ({ ...item, source: item.source && !allowed.includes(item.source.strategy) ? { strategy: "configured_asset", assetId: "" } : item.source,
              destination: item.destination && !allowed.includes(item.destination.strategy) ? { strategy: "configured_asset", assetId: "" } : item.destination }));
            setDraft(next);
          }}>Hapus</button>
        </div>)}
      </CompactFormSection>}
      {(!mobile || triggerChosen) && <CompactFormSection {...sectionProps("action", "Lakukan")}>
        <CompactChoice label="Tindakan" required value={actionChosen ? action.kind : undefined} options={meta.actionKinds.map((value) => ({ value, label: actionRegistry[value].label }))} onChange={(kind) => { setActionChosen(true); setChargesEnabled(false); setChargeRows(null);setFeeEnabled(false);setFeeInput(null);
          changeAction({ kind, source: actionRegistry[kind].source ? storage==="income_event"?{strategy:"trigger_destination_asset"}:{ strategy: "configured_asset", assetId: "" } : undefined,
            destination: actionRegistry[kind].destination ? { strategy: "configured_asset", assetId: "" } : undefined, categoryId: undefined, charges: [], transferFeeMinor: undefined });
        }} />
        {triggerChosen && actionChosen && <div className="automation-form-pair">
          {actionRegistry[action.kind].source && <AssetField label="Aset sumber" value={action.source} onChange={(source) => changeAction({ source })} allowed={meta.sourceReferences} options={options} disabled={pending} />}
          {actionRegistry[action.kind].destination && <AssetField label="Aset tujuan" value={action.destination} onChange={(destination) => changeAction({ destination })} allowed={meta.destinationReferences} options={options} disabled={pending} />}
        </div>}
      </CompactFormSection>}
      {triggerChosen && actionChosen && <CompactFormSection {...sectionProps("amount", "Nominal")}>
        {meta.amountStrategies.length===1 ? <p className="finance-hint">{amountRegistry[action.amount.strategy].label}</p> : <label className="field"><span>Cara menentukan nominal</span><select value={action.amount.strategy} onChange={(event) => {
          const strategy = event.target.value as AmountStrategy["strategy"];
          changeAction({ amount: strategy === "fixed" ? { strategy, amountMinor: "", currency: currency ?? "IDR" } : strategy === "percentage_of_trigger" ? { strategy, percentageBps: 1000 } : { strategy } });
          setMoneyInput(null); setDraft((value) => ({ ...value, execution: "confirm_before_execute" }));
        }}>{meta.amountStrategies.map((strategy) => <option key={strategy} value={strategy}>{amountRegistry[strategy].label}</option>)}</select></label>}
        {action.amount.strategy === "fixed" && <div className="automation-form-pair"><label className="field"><span>Mata uang</span><select value={action.amount.currency} onChange={(event) => {
          if (action.amount.strategy === "fixed") changeAction({ amount: { ...action.amount, currency: event.target.value, amountMinor: "" } }); setMoneyInput(null);
        }}>{options.currencies.map((item) => <option key={item.code} value={item.code}>{item.code}</option>)}</select></label>
          <label className="field"><span>Nominal</span><input required inputMode="decimal" value={moneyInput ?? (action.amount.amountMinor ? minorToInput(action.amount.amountMinor, exponent) : "")} onChange={(event) => setMoneyInput(event.target.value)} /></label></div>}
        {action.amount.strategy === "percentage_of_trigger" && <label className="field"><span>Persentase (%)</span><input required inputMode="decimal" value={percentage} onChange={(event) => setPercentage(event.target.value)} /><small>Dihitung dari nominal pokok transaksi pemicu, dibulatkan ke bawah.</small></label>}
        {action.amount.strategy === "confirm_at_runtime" && <p className="finance-hint">Nominal diisi sebelum tindakan dicatat.</p>}
      </CompactFormSection>}
      {triggerChosen && actionChosen && <CompactFormSection {...sectionProps("execution", "Eksekusi")}>
        {meta.executions.length === 1 ? <p className="finance-hint">Minta konfirmasi sebelum mencatat tindakan.</p> : <CompactChoice label="Kebijakan" value={draft.execution} options={meta.executions.map((value) => ({ value, label: value === "automatic" ? "Otomatis" : "Konfirmasi" }))} onChange={(execution) => setDraft({ ...draft, execution })} />}
      </CompactFormSection>}
      {actionChosen && (!mobile || triggerChosen) && <CompactFormSection {...sectionProps("optional", "Opsional")}>
        {optionalVisited && <>
        {action.kind !== "transfer" && <label className="field"><span>Kategori transaksi (opsional)</span><select disabled={pending} value={action.categoryId ?? ""} onChange={(event) => changeAction({ categoryId: event.target.value || undefined })}>
          <option value="">Tanpa kategori</option>{options.catalogs.transactionCategories.filter((item) => item.isActive && item.appliesTo === action.kind).map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>}
        {currency && action.kind === "expense" && <OptionalChargesEditor enabled={chargesEnabled} onEnabledChange={setChargesEnabled} disabled={pending}
          rows={chargeRows??action.charges.map((item) => ({ typeId: item.typeId, amount: minorToInput(item.amountMinor, exponent) }))} inputMode="decimal"
          chargeTypes={options.catalogs.chargeTypes.filter((item) => item.isActive)} onChange={setChargeRows} />}
        {currency && action.kind === "transfer" && <OptionalFormSection label="Ada biaya transfer" enabled={feeEnabled} onChange={setFeeEnabled} disabled={pending}>
          <label className="field"><span>Biaya transfer ({currency})</span><input required disabled={pending} inputMode="decimal" value={feeInput ?? (action.transferFeeMinor ? minorToInput(action.transferFeeMinor, exponent) : "")} onChange={(event) => setFeeInput(event.target.value)} /></label></OptionalFormSection>}
        <label className="field"><span>Catatan (opsional)</span><textarea disabled={pending} maxLength={1000} value={action.note ?? ""} onChange={(event) => changeAction({ note: event.target.value })} /></label>
        </>}
      </CompactFormSection>}
      </div>
    </form>
    </div>}
  </div>;
}

function RuleSummary({ summaries, conditions, options }: { summaries: Record<BuilderSection, string>; conditions: Condition[]; options: FinanceOptions | null }) {
  function conditionText(condition: Condition) {
    const display = (value: string) => {
      if (condition.field === "transaction_type") return actionRegistry[value as FinancialAction["kind"]]?.label ?? "Pilih jenis";
      if (condition.field === "source_asset" || condition.field === "destination_asset") return options?.assets.find((item) => item.id === value)?.displayName ?? "Pilih aset";
      if (condition.field === "transaction_category") return options?.catalogs.transactionCategories.find((item) => item.id === value)?.displayName ?? "Pilih kategori";
      if (condition.field === "base_amount") {
        const currency = condition.currency;
        const exponent = options?.currencies.find((item) => item.code === currency)?.exponent ?? 0;
        try { return value && currency ? formatMinor(value, currency, exponent) : "Isi nominal"; } catch { return "Periksa nominal"; }
      }
      return value || "Pilih nilai";
    };
    return `${conditionRegistry[condition.field].label} · ${operatorLabels[condition.operator]} · ${display(condition.value)}${condition.operator === "between" ? ` – ${display(condition.upperValue ?? "")}` : ""}`;
  }
  return <dl className="automation-rule-summary">
    <div><dt>Nama</dt><dd>{summaries.basics}</dd></div>
    <div><dt>Ketika</dt><dd>{summaries.trigger}</dd></div>
    <div><dt>Jika</dt><dd>{summaries.conditions}{conditions.length > 0 && <ul>{conditions.map((condition, index) => <li key={index}>{conditionText(condition)}</li>)}</ul>}</dd></div>
    <div><dt>Lakukan</dt><dd>{summaries.action}</dd></div>
    <div><dt>Nominal</dt><dd>{summaries.amount}</dd></div>
    <div><dt>Eksekusi</dt><dd>{summaries.execution}</dd></div>
  </dl>;
}

function TimeFields({ trigger, onChange,frequencies }: { trigger: Extract<Trigger, { namespace: "time" }>; onChange: (trigger: Trigger) => void;frequencies:readonly string[] }) {
  const schedule = trigger.schedule;
  const frequencyLabels:Record<string,string>={once:"Sekali",daily:"Setiap hari",weekdays:"Senin–Jumat",weekly:"Mingguan",monthly_day:"Tanggal setiap bulan",monthly_last_day:"Akhir bulan"};
  const change = (patch: Partial<typeof schedule>) => onChange({ namespace: "time", schedule: { ...schedule, ...patch } });
  return <div className="automation-time-grid">
    <div className="automation-time-pair" data-has-day={["weekly", "monthly_day"].includes(schedule.frequency)}>
    <label className="field automation-time-frequency"><span>Pengulangan</span><select value={schedule.frequency} onChange={(event) => change({ frequency: event.target.value as typeof schedule.frequency, weekday: 1, monthDay: 1 })}>
      {frequencies.map((frequency)=><option key={frequency} value={frequency}>{frequencyLabels[frequency]}</option>)}</select></label>
    {schedule.frequency === "weekly" && <label className="field"><span>Hari</span><select value={schedule.weekday ?? 1} onChange={(event) => change({ weekday: Number(event.target.value) })}>
      {["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"].map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></label>}
    {schedule.frequency === "monthly_day" && <label className="field"><span>Tanggal (1–28)</span><input required type="number" min={1} max={28} value={schedule.monthDay ?? 1} onChange={(event) => change({ monthDay: Number(event.target.value) })} /></label>}
    </div>
    <div className="automation-time-pair"><label className="field"><span>{schedule.frequency === "once" ? "Tanggal" : "Mulai"}</span><input required type="date" value={schedule.startOn} onChange={(event) => change({ startOn: event.target.value })} /></label>
      <label className="field"><span>Waktu (WIB)</span><input required type="time" value={schedule.localTime} onChange={(event) => change({ localTime: event.target.value })} /></label></div>
    {schedule.frequency !== "once" && <label className="field automation-time-end"><span>Berakhir (opsional)</span><input type="date" min={schedule.startOn} value={schedule.endOn ?? ""} onChange={(event) => change({ endOn: event.target.value || undefined })} /></label>}
  </div>;
}
function ConditionValue({ condition, options, onChange }: { condition: Condition; options: FinanceOptions; onChange: (patch: Partial<Condition>) => void }) {
  let values: { id: string; label: string }[] | undefined;
  if (condition.field === "transaction_type") values = Object.entries(actionRegistry).map(([id, item]) => ({ id, label: item.label }));
  if (["source_asset", "destination_asset"].includes(condition.field)) values = options.assets.map((item) => ({ id: item.id, label: item.displayName }));
  if (condition.field === "transaction_category") values = options.catalogs.transactionCategories.map((item) => ({ id: item.id, label: item.displayName }));
  if (condition.field === "currency") values = options.currencies.map((item) => ({ id: item.code, label: item.code }));
  if (values) return <label className="field"><span>Nilai</span><select required value={condition.value} onChange={(event) => onChange({ value: event.target.value })}><option value="">Pilih nilai</option>
    {values.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>;
  const exponent = options.currencies.find((item) => item.code === condition.currency)?.exponent ?? 0;
  return <div className="automation-condition-amount"><label className="field"><span>Mata uang</span><select required value={condition.currency ?? ""} onChange={(event) => onChange({ currency: event.target.value, value: "", upperValue: undefined })}>
    <option value="">Pilih mata uang</option>{options.currencies.map((item) => <option key={item.code} value={item.code}>{item.code}</option>)}</select></label>
    <ConditionMoney label="Nominal" value={condition.value} exponent={exponent} onChange={(value)=>onChange({value})}/>
    {condition.operator === "between" && <ConditionMoney label="Sampai" value={condition.upperValue??""} exponent={exponent} onChange={(upperValue)=>onChange({upperValue})}/>}
  </div>;
}
function ConditionMoney({label,value,exponent,onChange}:{label:string;value:string;exponent:number;onChange:(value:string)=>void}){
  const [text,setText]=useState(value?minorToInput(value,exponent):"");
  useEffect(()=>setText(value?minorToInput(value,exponent):""),[value,exponent]);
  return <label className="field"><span>{label}</span><input required inputMode="decimal" value={text}
    pattern={exponent?`[0-9]+([.,][0-9]{1,${exponent}})?`:"[0-9]+"} onChange={(event)=>{
      setText(event.target.value);
      try{onChange(event.target.value?inputToMinor(event.target.value,exponent):"");}catch{/* browser pattern keeps incomplete values from submitting */}
    }}/></label>;
}
