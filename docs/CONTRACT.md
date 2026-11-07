# Kontrak data backend -> frontend

Sumber: `src/lib/finance/summary.ts` (`financeSnapshot`), `src/lib/finance/types.ts`, `src/app/api/finance/**`.
Perubahan bentuk data wajib dicatat di sini (dengan contoh respons) sebelum frontend menyesuaikan.

## Aturan nominal

- Semua nominal uang adalah **string** berisi bilangan bulat minor unit (IDR eksponen 0, jadi `"1500000"` = Rp1.500.000). Bisa negatif (mis. `netWorthMinor`, `availableMinor`).
- Jangan `Number()`/float; pakai `BigInt` atau `parseMinor`/`formatMinor` dari `@/lib/domain/money`. Semua field berakhiran `Minor` mengikuti aturan ini.
- Request: nominal juga dikirim sebagai string (`amountMinor`, `openingAmountMinor`, `expectedMinor`, `correctedMinor`, `transferFeeMinor`, `charges[].amountMinor`, `creditInstallments.principalMinor|interestMinor`). Pengecualian: `creditInstallments.count` bertipe number.
- `exponent` (number) menyertai nominal yang perlu diformat; `currency` kode ISO 3 huruf.

## `financeSnapshot({ includeRecent = true, includeExpenses = true })`

Fungsi server (bukan route HTTP); wajib sesi pemilik; satu transaksi `REPEATABLE READ READ ONLY`. Mengembalikan:

| Field | Tipe | Arti |
|---|---|---|
| `assets` | `FinanceAsset[]` | Semua akun (lihat bawah), termasuk yang diarsipkan |
| `recent` | `FinanceActivity[]` | 6 aktivitas terbaru; `[]` jika `includeRecent=false` |
| `pendingAutomations` | `WorkspaceInstance[]` | Instans otomasi menunggu tindakan; `[]` jika `includeRecent=false` |
| `investment` | `{ totals: InvestmentTotal[]; hasHoldings: boolean }` | Ringkasan investasi per mata uang |
| `planningReady` | boolean | Skema perencanaan sudah termigrasi; jika false, reserved/due = 0 |
| `throughDay` | string `YYYY-MM-DD` | Cakrawala perencanaan (hari ini + 30 hari) |
| `currencies` | `CurrencySummary[]` | Satu entri per mata uang |

`CurrencySummary`:

| Field | Tipe | Arti |
|---|---|---|
| `currency` | string | Kode mata uang |
| `exponent` | number | Eksponen minor unit |
| `totalMinor` | string | Total aset: saldo non-kredit + kelebihan bayar kredit + nilai pasar investasi |
| `liquidMinor` | string | Saldo akun aktif `normallyLiquid`, bukan piutang |
| `eligibleMinor` | string | Saldo akun aktif `normallySpendable`, bukan piutang (sebelum cadangan) |
| `creditDebtMinor` | string | Tagihan kredit jatuh tempo s.d. `throughDay` |
| `liabilitiesMinor` | string | Seluruh kewajiban kredit belum lunas |
| `netWorthMinor` | string | Kekayaan bersih = aset - seluruh kewajiban |
| `reservedMinor` | string | Dana yang dicadangkan |
| `dueMinor` | string | Kewajiban jatuh tempo s.d. `throughDay` + `creditDebtMinor` |
| `coveredMinor` | string | Bagian `dueMinor` yang sudah ditutup cadangan |
| `uncoveredMinor` | string | Bagian `dueMinor` belum tertutup (`dueMinor = coveredMinor + uncoveredMinor`) |
| `spendableMinor` | string | `eligibleMinor - reservedMinor` |
| `availableMinor` | string | "Dana siap pakai" = `eligibleMinor - reservedMinor - uncoveredMinor` (`availableFunds`) |
| `expenseMinor` | string | Pengeluaran bulan berjalan; `"0"` jika `includeExpenses=false` |
| `unpricedCount` | number | Jumlah posisi investasi tanpa harga |

`FinanceAsset`: `id`, `displayName`, `currency`, `exponent`, `assetTypeId`, `assetTypeName`, `assetGroupId|null`, `assetGroupName|null`, `providerId|null`, `providerName|null`, `paymentNetworkId|null`, `normallyLiquid`, `normallySpendable` (boolean), `safeSuffix|null`, `note|null`, `isActive`, `openingMinor` (string), `balanceMinor` (string), `assetClass` (`"asset"|"liability"|"receivable"`), `creditInstallments?` (`{ activityId, seq, period "YYYY-MM", principalMinor, interestMinor, status "scheduled"|"cancelled", cancelledByActivityId? }[]`).

`FinanceActivity`: `id`, `cursorTime?`, `kind` (`income|expense|transfer`), `baseAmountMinor`, `currency`, `exponent`, `sourceAssetId|null`, `sourceName|null`, `destinationAssetId|null`, `destinationName|null`, `categoryId|null`, `categoryName|null`, `occurredAt`, `note|null`, `status` (`posted|voided|superseded`), `replacesActivityId|null`, `charges[]` (`{ id, typeId, typeName, systemKey?, amountMinor }`), `creditInstallments?` (`{ count, principalMinor, interestMinor }`), serta field opsional otomasi (`recurringRuleName`, `eventInstanceId`, `automationInstanceId`, `eventSource*`, dll.; lihat `types.ts`).

`InvestmentTotal`: `currency`, `exponent`, `marketMinor`, `costBasisMinor`, `pricedCostBasisMinor`, `unrealizedMinor`, `realizedMinor` (string), `unpricedCount` (number).

## `/api/finance/*`

Semua route: respons `Cache-Control: no-store`; tanpa sesi pemilik -> `401 {"error":"Sesi berakhir"}`. POST juga memeriksa origin (`assertRequestOrigin`), `Content-Type: application/json`, dan batas ukuran body. Kegagalan POST -> `400 {"error": "<pesan>"}`.

### GET `/api/finance/activities`

Query: `history=true|false` (sertakan void/superseded), `direction=desc|asc` (default `desc`), `kind=income|expense|transfer` (opsional), `after=<JSON {"at": timestamp, "id": uuid}>` (kursor, maks 200 karakter).
Respons: `{ items: FinanceActivity[] (maks 50), next: { at: string, id: string } | null }`. Parameter salah -> `400 {"error":"Urutan transaksi tidak valid"}`; gagal baca -> `500`.

### GET `/api/finance/[operation]`

- `options` -> `{ assets: FinanceAsset[], currencies: { code, exponent }[], catalogs: { providers, paymentNetworks, assetTypes, assetGroups, transactionCategories, chargeTypes } }` (aset aktif saja, `listAssets(false)`).
- `asset-opening?id=<uuid>` -> `AssetOpeningHistory`: `{ originalMinor, effectiveMinor, currency, exponent, corrections: { id, previousMinor, correctedMinor, note|null, createdAt }[] }`.
- `asset-detail?id=<uuid>` -> `AssetDetailInfo`: `{ assetId, paymentNetworkName|null, openingEffectiveAt|null, createdAt, adminAutomationStatus ("active"|"paused"|"archived"|null), activitySummary: { activityCount (number), incomeMinor, expenseMinor, transferInMinor, transferOutMinor }, recentActivities: { id, kind, direction ("in"|"out"), amountMinor, chargesMinor, categoryName|null, counterpartyName|null, note|null, occurredAt }[] }`.
- operasi GET lain -> `404 {"error":"Tidak tersedia"}`; kegagalan -> `500 {"error": ...}`.

### POST `/api/finance/[operation]`

Body JSON objek. Respons sukses `200`; operasi tak dikenal -> `404 {"error":"Tidak tersedia"}`.

| operation | Body | Respons |
|---|---|---|
| `asset-create` | `displayName, assetTypeId, assetGroupId?, providerId?, paymentNetworkId?, normallyLiquid, normallySpendable, safeSuffix? (maks 4), note? (maks 1000), assetClass?, currency, openingAmountMinor (>= "0"), openingEffectiveAt (ISO)` | `{ id }` |
| `asset-update` | `id` + field aset di atas (tanpa saldo awal) | `{ ok: true }` |
| `asset-opening-correct` | `assetId, expectedMinor, correctedMinor, note?, idempotencyKey` | `{ id }` |
| `asset-archive` / `asset-restore` | `id` | `{ ok: true }` |
| `catalog-create` | `catalog, displayName, appliesTo? ("income"|"expense", untuk transactionCategories)` | `{ item }` |
| `catalog-rename` | `catalog, id, displayName` | `{ ok: true }` |
| `catalog-archive` / `catalog-restore` / `catalog-delete` | `catalog, id` | `{ ok: true }` |
| `post` | `draft: ActivityDraft, idempotencyKey, creditCycle? ("current"|"next"), creditInstallments? { count, principalMinor, interestMinor }` | `{ id }` |
| `replace` | `id, draft, idempotencyKey, creditCycle?, creditInstallments?` | `{ id }` (koreksi = reversal + posting baru) |
| `void` | `id, idempotencyKey` | `{ id }` (movement pembalik) |

`catalog` salah satu dari: `providers, paymentNetworks, assetTypes, assetGroups, transactionCategories, chargeTypes, instrumentTypes`.
`ActivityDraft`: `{ kind, amountMinor, sourceAssetId?, destinationAssetId?, categoryId?, charges?: { typeId, amountMinor }[], transferFeeMinor?, occurredAt, note? }`.
`idempotencyKey` maks 36 karakter; pengulangan dengan kunci sama tidak menggandakan posting. String teks dibatasi panjang (`displayName` 120, id 36).
Kesalahan lifecycle/koreksi saldo awal mengembalikan pesan spesifik (`400`); selain itu `400 {"error":"Perubahan tidak dapat disimpan. Periksa data dan coba lagi."}`.

## Tambahan: asset_class dan split bill atomik (migrasi 016)

`asset_class` selalu ditulis eksplisit di semua jalur pembuatan akun. `asset-create` tanpa `assetClass` kini disimpan sebagai `"asset"` secara eksplisit
(bukan default kolom). Akun piutang HARUS dikirim `assetClass: "receivable"`; jalur lama klien (asset-create tanpa kelas) tetap berjalan tetapi
menghasilkan akun `asset`, jadi frontend sebaiknya beralih ke `split-bill` di bawah.

### POST `/api/finance/asset-class-change`

Request: `{ "id": "<uuid aset>", "assetClass": "asset" | "liability" | "receivable", "idempotencyKey": "<uuid>" }`
Respons: `{ "assetId": "<uuid>", "assetClass": "receivable", "changed": true }`; `changed:false` bila kelas sudah sama (tidak ada catatan baru).
Ditolak (`400`, pesan "Kelas akun tidak dapat diubah selama masih ada jadwal cicilan...") bila akun punya `credit_installments` berstatus `scheduled`.
Kunci yang sama dengan isi berbeda -> `400 "Kunci permintaan sudah digunakan untuk perubahan lain"`. Setiap perubahan dicatat di tabel `asset_class_changes`.

### POST `/api/finance/split-bill`

Satu transaksi DB, satu `idempotencyKey`: pengeluaran pribadi (bila porsi pribadi > 0) + transfer talangan ke akun piutang + pembuatan akun piutang bila belum ada.
Request:
```json
{ "idempotencyKey": "<uuid>", "sourceAssetId": "<uuid>", "totalMinor": "300000", "reimbursedMinor": "200000",
  "occurredAt": "2026-03-01T05:00:00.000Z", "categoryId": "<uuid>?", "charges": [{ "typeId": "<uuid>", "amountMinor": "5000" }],
  "person": "Budi?", "note": "Makan malam?", "receivableAssetId": "<uuid>?" }
```
- `totalMinor` = pokok yang keluar dari akun sumber (porsi pribadi + talangan), tanpa biaya tambahan; `charges` menempel pada pengeluaran pribadi (wajib ada porsi pribadi).
- `receivableAssetId` opsional: harus akun `receivable` aktif, mata uang sama. Jika kosong: pakai akun receivable aktif pertama di mata uang itu, atau buat "Piutang & Talangan" (`assetClass: "receivable"`).
Respons: `{ "personalActivityId": "<uuid>|null", "transferActivityId": "<uuid>", "receivableAssetId": "<uuid>", "receivableCreated": true }`.
Ulangan dengan kunci dan isi sama mengembalikan respons yang sama tanpa posting ganda. Gagal di tengah = tidak ada yang tersimpan. Jalur lama (`asset-create` + dua `post`) tetap tersedia.
