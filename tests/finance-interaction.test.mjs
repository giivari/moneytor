import test from "node:test";
import assert from "node:assert/strict";
import { connectFinanceDialog } from "../src/lib/finance/dialog-lifecycle.ts";
import { financeRequest, loadFinanceOptions } from "../src/lib/finance/client.ts";

class Dialog extends EventTarget {
  open = false;
  opens = 0;
  showModal() { assert.equal(this.open, false); this.open = true; this.opens++; }
  close() { this.open = false; queueMicrotask(() => this.dispatchEvent(new Event("close"))); }
}

test("previous close-on-cleanup pattern dismisses the form during effect replay", async () => {
  const dialog = new Dialog();
  let dismissals = 0;
  dialog.addEventListener("close", () => dismissals++);
  dialog.showModal();
  dialog.close(); // Previous effect cleanup.
  dialog.showModal(); // Strict Mode replays the effect setup.
  await Promise.resolve();
  assert.equal(dialog.open, true);
  assert.equal(dismissals, 1); // Parent callback would unmount the open form.
});

test("Strict Mode effect replay keeps the dialog open and user close dismisses once", async () => {
  const dialog = new Dialog();
  let dismissals = 0;
  const connect = () => connectFinanceDialog(dialog, () => dismissals++);
  const cleanup = connect();
  cleanup();
  const finalCleanup = connect();
  await Promise.resolve();
  assert.equal(dialog.open, true);
  assert.equal(dialog.opens, 1);
  assert.equal(dismissals, 0);
  dialog.close();
  await Promise.resolve();
  assert.equal(dismissals, 1);
  finalCleanup();
  dialog.dispatchEvent(new Event("close"));
  assert.equal(dismissals, 1);
});

test("a queued close from an older opening cannot dismiss a reopened dialog", async () => {
  const dialog = new Dialog();
  let dismissals = 0;
  const cleanup = connectFinanceDialog(dialog, () => dismissals++);
  dialog.close();
  cleanup();
  const finalCleanup = connectFinanceDialog(dialog, () => dismissals++);
  await Promise.resolve();
  assert.equal(dismissals, 0);
  finalCleanup();
});

test("finance client reports safe network, malformed response and API errors", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => { throw new Error("internal network diagnostics"); };
  await assert.rejects(loadFinanceOptions(), /Koneksi terputus/);
  globalThis.fetch = async () => new Response("<html>internal diagnostics</html>", { status: 500 });
  await assert.rejects(financeRequest("post", {}), /Respons belum dapat diproses/);
  globalThis.fetch = async () => Response.json({ error: "Jumlah harus positif." }, { status: 400 });
  await assert.rejects(financeRequest("post", {}), /Jumlah harus positif/);
  globalThis.fetch = async () => Response.json(null, { status: 500 });
  await assert.rejects(financeRequest("post", {}), /Permintaan gagal/);
});

test("finance client preserves idempotency payload and successful catalog response", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const body = { idempotencyKey: "stable-retry-key", draft: { amountMinor: "9007199254740993" } };
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/finance/post");
    assert.equal(init.cache, "no-store");
    assert.deepEqual(JSON.parse(init.body), body);
    return Response.json({ id: "synthetic-activity" });
  };
  assert.deepEqual(await financeRequest("post", body), { id: "synthetic-activity" });
  const options = { assets: [], currencies: [], catalogs: {} };
  globalThis.fetch = async () => Response.json(options);
  assert.deepEqual(await loadFinanceOptions(), options);
});
