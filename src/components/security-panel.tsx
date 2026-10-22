"use client";

import { sortTemporal } from "@/lib/list-order";
import { useListSort } from "./use-list-sort";
import { ListSortControl } from "./list-sort-control";

import { useEffect, useRef, useState } from "react";
import { AppLink as Link } from "@/components/app-link";
import { ArrowClockwise, CheckCircle, Devices, Key, Lifebuoy, Plus, SignOut, Trash, WarningCircle } from "@phosphor-icons/react";
import { authRequest, registerPasskey, RecoveryCodes } from "./auth-panel";
import { LoadingIndicator } from "./loading-indicator";
import { useMutationPending } from "./finance-feedback";

type Overview = { credentials: { id: string; label: string; createdAt: string; lastUsedAt: string | null }[]; recoveryRemaining: number };
type ConfirmAction = {
  operation: "revoke" | "recovery-codes" | "revoke-sessions" | "logout";
  body?: { id: string };
  title: string;
  description: string;
  confirmLabel: string;
  tone: "warning" | "danger";
};
type Notice = { text: string; tone: "success" | "error" };

export function SecurityPanel({ initial, section }: { initial: Overview; section: "passkeys" | "recovery" | "sessions" }) {
  const [overview, setOverview] = useState(initial);
  const credentialSort = useListSort("security.passkeys");
  const [label, setLabel] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const { pending: busy, begin, finish } = useMutationPending();
  const [pendingOperation, setPendingOperation] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmAction | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const invokingButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!confirmation || !dialogRef.current) return;
    if (!dialogRef.current.open) dialogRef.current.showModal();
    cancelRef.current?.focus();
  }, [confirmation]);

  function ask(action: ConfirmAction, button: HTMLButtonElement) {
    invokingButtonRef.current = button;
    setNotice(null);
    setConfirmation(action);
  }

  function closeConfirmation() { if (!busy) dialogRef.current?.close(); }

  const pendingLabel = pendingOperation === "add" ? "Menyiapkan passkey…" : pendingOperation === "revoke" ? "Mencabut passkey…"
    : pendingOperation === "recovery-codes" ? "Membuat kode baru…" : pendingOperation === "logout" ? "Keluar…" : "Mengeluarkan sesi…";

  async function action(operation: string, body: object = {}) {
    if (!begin()) return;
    setPendingOperation(operation);
    setNotice(null);
    let leaving = false;
    try {
      const result = operation === "add" ? await registerPasskey(label) : await authRequest(operation, body);
      if (operation === "logout") { leaving = true; window.location.assign("/unlock"); return; }
      if (result.codes) setCodes(result.codes);
      setLabel("");
      // A revoked current credential can invalidate this session.
      try { setOverview(await authRequest("overview")); }
      catch { leaving = true; window.location.assign("/unlock"); return; }
      dialogRef.current?.close();
      setNotice({ text: operation === "revoke-sessions" ? "Sesi lain telah dikeluarkan."
        : operation === "recovery-codes" ? "Kode baru dibuat. Simpan sebelum menutup halaman."
        : operation === "revoke" ? "Passkey telah dicabut." : "Passkey berhasil ditambahkan.", tone: "success" });
    } catch {
      setNotice({ text: "Belum berhasil. Buka ulang dengan passkey, lalu coba lagi.", tone: "error" });
    } finally { if (!leaving) finish(); }
  }

  return <>
    <section className="security-panel settings-security-detail" aria-label="Pengelolaan keamanan">
      <div className="security-intro"><p>Perubahan keamanan perlu sesi baru (10 menit). <Link href="/unlock">Konfirmasi dengan passkey</Link> bila diminta.</p></div>
      {busy && <p className="settings-security-pending" role="status"><LoadingIndicator>{pendingLabel}</LoadingIndicator></p>}

      <div className="security-layout">
      {section === "passkeys" && <div className="security-group security-passkeys" aria-labelledby="passkey-title">
        <div className="security-group-heading"><div><h3 id="passkey-title">Passkeys</h3><p>Kunci yang dapat membuka moneytor.</p></div><span className="security-count">{overview.credentials.length} aktif</span></div>
        <ListSortControl {...credentialSort} /><ul className="credential-list">{sortTemporal(overview.credentials, credentialSort.direction, item => item.createdAt, item => item.id).map(item => <li key={item.id}>
          <span className="credential-icon"><Key size={20} aria-hidden="true" /></span>
          <div className="credential-details"><strong>{item.label}</strong><small>Ditambahkan {new Date(item.createdAt).toLocaleDateString("id-ID", { timeZone: "UTC" })}</small></div>
          <button type="button" className="security-button security-button-danger" disabled={busy || overview.credentials.length <= 1} title={overview.credentials.length <= 1 ? "Passkey terakhir tidak dapat dicabut" : undefined} onClick={event => ask({ operation: "revoke", body: { id: item.id }, title: `Cabut passkey “${item.label}”?`, description: "Passkey ini tidak dapat dipakai lagi. Sesi yang dibuat dengannya juga akan berakhir.", confirmLabel: "Cabut passkey", tone: "danger" }, event.currentTarget)}><Trash size={17} aria-hidden="true" />Cabut passkey</button>
        </li>)}</ul>
        <p className="security-help">Passkey terakhir dilindungi. Tambahkan cadangan sebelum mencabutnya.</p>
        <form className="security-add-form" aria-busy={busy} onSubmit={event => { event.preventDefault(); void action("add"); }}><label>Nama passkey baru<input disabled={busy} value={label} onChange={event => setLabel(event.target.value)} maxLength={80} placeholder="Contoh: perangkat cadangan" /></label><button className="auth-primary" disabled={busy} aria-busy={busy && pendingOperation === "add"}>{busy && pendingOperation === "add" ? <LoadingIndicator>{pendingLabel}</LoadingIndicator> : <><Plus size={18} aria-hidden="true" />Tambah passkey</>}</button></form>
      </div>}

      {section === "recovery" && <div className="security-group security-recovery" aria-labelledby="recovery-title">
        <div className="security-group-heading"><div><h3 id="recovery-title">Pemulihan</h3><p>Simpan kode di tempat privat untuk saat passkey tidak tersedia.</p></div><span className="security-count">{overview.recoveryRemaining} tersisa</span></div>
        {codes.length > 0 ? <RecoveryCodes codes={codes} done={() => setCodes([])} /> : <button type="button" className="security-button security-button-warning" disabled={busy} onClick={event => ask({ operation: "recovery-codes", title: "Buat kode pemulihan baru?", description: "Semua kode pemulihan lama akan langsung berhenti berlaku. Simpan kode baru setelah dibuat.", confirmLabel: "Buat kode baru", tone: "warning" }, event.currentTarget)}><ArrowClockwise size={18} aria-hidden="true" />Buat ulang kode pemulihan</button>}
      </div>}

      {section === "sessions" && <div className="security-group security-sessions" aria-labelledby="sessions-title">
        <div className="security-group-heading"><div><h3 id="sessions-title">Sesi</h3><p>Akses yang sedang digunakan di browser dan perangkat lain.</p></div></div>
        <div className="security-session"><span className="credential-icon"><Devices size={20} aria-hidden="true" /></span><div><strong>Sesi saat ini</strong><small>Browser ini tetap aktif saat sesi lain dikeluarkan.</small></div></div>
        <div className="security-actions">
          <button type="button" className="security-button security-button-warning" disabled={busy} onClick={event => ask({ operation: "revoke-sessions", title: "Keluarkan sesi lain?", description: "Browser dan perangkat lain perlu masuk lagi dengan passkey. Sesi ini tetap aktif.", confirmLabel: "Keluarkan sesi lain", tone: "warning" }, event.currentTarget)}><Devices size={18} aria-hidden="true" />Keluarkan sesi lain</button>
        </div>
        <div className="security-signout">
          <button type="button" className="security-button security-button-danger" disabled={busy} onClick={event => ask({ operation: "logout", title: "Keluar dari moneytor?", description: "Anda perlu memakai passkey untuk membuka keuangan lagi.", confirmLabel: "Keluar", tone: "danger" }, event.currentTarget)}><SignOut size={18} aria-hidden="true" />Keluar dari moneytor</button>
        </div>
      </div>}
      </div>
    </section>

    <dialog ref={dialogRef} className="security-confirm" aria-busy={busy} aria-labelledby="security-confirm-title" aria-describedby="security-confirm-description" onCancel={(event) => { if (busy) event.preventDefault(); }} onClose={() => { setConfirmation(null); invokingButtonRef.current?.focus(); }}>
      {confirmation && <><span className={`security-confirm-icon ${confirmation.tone}`} aria-hidden="true">{confirmation.tone === "danger" ? <Trash size={22} /> : <Lifebuoy size={22} />}</span><h2 id="security-confirm-title">{confirmation.title}</h2><p id="security-confirm-description">{confirmation.description}</p>{notice?.tone === "error" && <p className="auth-error" role="alert">{notice.text}</p>}<div className="security-confirm-actions"><button ref={cancelRef} type="button" className="security-button" disabled={busy} onClick={closeConfirmation}>Batal</button><button type="button" className={`security-button security-button-${confirmation.tone}`} disabled={busy} aria-busy={busy} onClick={() => void action(confirmation.operation, confirmation.body)}>{busy ? <LoadingIndicator>{pendingLabel}</LoadingIndicator> : confirmation.confirmLabel}</button></div></>}
    </dialog>

    {notice && <div className="security-notice" data-success={notice.tone === "success"} role={notice.tone === "success" ? "status" : "alert"}>
      {notice.tone === "success" ? <CheckCircle size={20} weight="fill" aria-hidden="true" /> : <WarningCircle size={20} weight="fill" aria-hidden="true" />}
      <span>{notice.text}</span>
    </div>}
  </>;
}
