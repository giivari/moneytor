"use client";

import { useState } from "react";
import { AppLink as Link } from "@/components/app-link";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, LockKey } from "@phosphor-icons/react";
import { LoadingIndicator } from "./loading-indicator";
import { useMutationPending } from "./finance-feedback";

export async function authRequest(operation: string, body: object = {}) {
  let response: Response;
  try { response = await fetch(`/api/auth/${operation}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" }); }
  catch { throw new Error("Koneksi terputus. Coba lagi."); }
  let data;
  try { data = await response.json(); }
  catch { throw new Error("Respons belum dapat diproses. Coba lagi."); }
  if (!response.ok) throw new Error(data.error ?? "Permintaan gagal.");
  return data;
}
export async function registerPasskey(label: string) {
  const { options, purpose } = await authRequest("register-options");
  let response;
  try { response = await startRegistration({ optionsJSON: options }); }
  catch (error) { await authRequest("cancel", { purpose }).catch(() => {}); throw error; }
  return authRequest("register-finish", { response, purpose, label });
}
export function RecoveryCodes({ codes, done }: { codes: string[]; done: () => void }) {
  return <section className="recovery-codes" aria-label="Kode pemulihan baru"><h2>Simpan kode pemulihan</h2><p>Kode hanya ditampilkan kali ini. Simpan secara privat di luar perangkat ini. Setiap kode hanya bisa dipakai sekali.</p><ul>{codes.map(code => <li key={code}><code>{code}</code></li>)}</ul><button className="auth-primary" onClick={done}>Sudah saya simpan</button></section>;
}
export function AuthPanel({ mode }: { mode: "unlock" | "recover" | "enroll" }) {
  const { pending: busy, begin, finish } = useMutationPending();
  const [error, setError] = useState("");
  const [value, setValue] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [navigating, setNavigating] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!begin()) return; setError("");
    let leaving = false;
    try {
      if (mode === "unlock") {
        const { options } = await authRequest("login-options");
        let response;
        try { response = await startAuthentication({ optionsJSON: options }); }
        catch (error) { await authRequest("cancel", { purpose: "login" }).catch(() => {}); throw error; }
        await authRequest("login-finish", { response });
        setNavigating(true); window.location.assign("/"); leaving = true;
      } else if (mode === "recover") {
        await authRequest("recover", { code: value }); setValue(""); setNavigating(true); window.location.assign("/enroll"); leaving = true;
      } else {
        const result = await registerPasskey(value);
        if (result.codes) setCodes(result.codes); else { setNavigating(true); window.location.assign("/settings"); leaving = true; }
      }
    } catch {
      setError(mode === "recover"
        ? "Kode pemulihan belum dapat digunakan. Periksa kodenya dan coba lagi."
        : "Verifikasi belum selesai atau dibatalkan. Coba lagi; jika perangkat tidak mendukung passkey, gunakan kode pemulihan.");
    } finally { if (!leaving) { setNavigating(false); finish(); } }
  }
  if (codes.length) return <RecoveryCodes codes={codes} done={() => { if (!begin()) return; setNavigating(true); setCodes([]); window.location.assign("/"); }} />;
  return <><div className="auth-symbol"><LockKey size={28} /></div><h1>{mode === "unlock" ? "Keuanganmu terkunci" : mode === "recover" ? "Pulihkan akses" : "Siapkan passkey"}</h1><p>{mode === "unlock" ? "Buka moneytor dengan passkey milikmu." : mode === "recover" ? "Gunakan satu kode pemulihan, lalu daftarkan passkey pengganti dalam 10 menit. Setelah berhasil, passkey dan sesi lama akan dicabut." : "Gunakan kunci perangkat atau security key. Setelah berhasil, simpan kode pemulihan di tempat aman."}</p><form onSubmit={submit}>
    {mode !== "unlock" && <label>{mode === "recover" ? "Kode pemulihan" : "Nama perangkat (opsional)"}<input type={mode === "recover" ? "password" : "text"} value={value} onChange={event => setValue(event.target.value)} maxLength={mode === "recover" ? 80 : 80} required={mode === "recover"} autoComplete="off" spellCheck={false} /></label>}
    <button className="auth-primary" disabled={busy} aria-busy={busy}>{busy ? <LoadingIndicator>{navigating ? "Membuka halaman..." : mode === "unlock" ? "Memverifikasi passkey…" : mode === "enroll" ? "Menyiapkan passkey…" : "Memulihkan akses…"}</LoadingIndicator> : <><Fingerprint size={20} />{mode === "unlock" ? "Lanjutkan dengan passkey" : mode === "recover" ? "Gunakan kode pemulihan" : "Daftarkan passkey"}</>}</button>
  </form>{error && <p role="alert" className="auth-error">{error}</p>}<Link className="auth-secondary" href={mode === "unlock" ? "/recover" : "/unlock"}>{mode === "unlock" ? "Tidak dapat memakai passkey?" : "Kembali ke buka moneytor"}</Link></>;
}

/** Keep the established native POST/redirect bootstrap, with immediate pending acknowledgment. */
export function BootstrapForm() {
  const { pending, begin } = useMutationPending();
  return <form method="post" action="/api/auth/bootstrap" aria-busy={pending} onSubmit={(event) => { if (!begin()) event.preventDefault(); }}>
    <label>Secret penyiapan<input type="password" name="secret" autoComplete="off" required maxLength={128} /></label>
    <button className="auth-primary" disabled={pending} aria-busy={pending}>{pending ? <LoadingIndicator>Menyiapkan akses…</LoadingIndicator> : "Lanjutkan penyiapan"}</button>
  </form>;
}
