import test from "node:test";
import assert from "node:assert/strict";

// Start the app separately against the disposable P2 DB. This suite does not enroll an owner.
const enabled = ["http://127.0.0.1:3102", "http://localhost:3000"].includes(process.env.MONETA_AUTH_HTTP_TEST);
test("local HTTP private routes and auth endpoints", { skip: !enabled }, async (t) => {
  const base = process.env.MONETA_AUTH_HTTP_TEST;
  for (const path of ["/", "/transactions", "/assets", "/planning", "/insights", "/settings"]) {
    await t.test(`unauthenticated ${path} redirects`, async () => {
      const response = await fetch(base + path, { redirect: "manual" });
      assert.equal(response.status, 307); assert.equal(response.headers.get("location"), "/unlock");
      assert.match(response.headers.get("cache-control"), /no-store/);
    });
  }
  await t.test("unlock renders the current owner state without financial content and has frame protection", async () => {
    const response = await fetch(base + "/unlock"); assert.equal(response.status, 200);
    const html = await response.text();
    const setup = html.includes("Siapkan moneytor pribadi");
    const login = html.includes("Keuanganmu terkunci");
    assert.notEqual(setup, login);
    if (login) assert.ok(!html.includes("Secret penyiapan"));
    assert.ok(!html.includes("Dapat digunakan"));
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("referrer-policy"), "same-origin");
    assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  });
  await t.test("GET cannot mutate auth", async () => {
    assert.equal((await fetch(base + "/api/auth/logout")).status, 405);
  });
  await t.test("missing and foreign origins rejected", async () => {
    for (const origin of [undefined, "https://attacker.example"]) {
      const response = await fetch(base + "/api/auth/recovery-codes", { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: "{}" });
      assert.equal(response.status, 400); assert.match(response.headers.get("cache-control"), /no-store/);
      assert.ok(!(await response.text()).includes("stack"));
    }
  });
  await t.test("same-origin security request still needs an owner session", async () => {
    const response = await fetch(base + "/api/auth/overview", { method: "POST", headers: { "content-type": "application/json", origin: base.replace("127.0.0.1", "localhost") }, body: "{}" });
    assert.equal(response.status, 400);
  });
  await t.test("native bootstrap form is accepted to the secret check", async () => {
    const response = await fetch(base + "/api/auth/bootstrap", {
      method: "POST", redirect: "manual",
      headers: { origin: base.replace("127.0.0.1", "localhost"), "sec-fetch-site": "same-origin", "content-type": "application/x-www-form-urlencoded" },
      body: "secret=incorrect",
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.match(response.headers.get("location"), /\/unlock\?failed=1$/);
  });
});
