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

## Tambahan: jenis aktivitas utang dan koreksi (migrasi 017)

`ActivityDraft.kind` (POST `/api/finance/post`, `replace`) kini menerima `borrow | repay | refund | adjustment` selain `income | expense | transfer`.
Tipe TypeScript: `ActivityKind` tetap 3 jenis lama (dipakai UI, otomasi, impor); `DebtActivityKind` dan `AnyActivityKind` ada di `src/lib/finance/types.ts`.
**Peringatan frontend:** `GET /api/finance/activities` dan `financeSnapshot().recent` dapat mengembalikan `kind` baru walau tipe `FinanceActivity.kind` masih `ActivityKind`;
komponen yang mengindeks label berdasarkan `kind` perlu menangani empat jenis ini (belum diubah, di luar lingkup backend).
Nominal tetap string minor unit. Aturan: borrow BUKAN pemasukan; pokok repay BUKAN pengeluaran, bunga adalah biaya; refund mengurangi pengeluaran (bukan pemasukan);
adjustment dilaporkan terpisah. Otomasi, recurring, dan impor tetap hanya 3 jenis lama; jenis baru bukan pemicu otomasi.

| kind | Field | Ledger (satu pergerakan per sisi aset) | Syarat |
|---|---|---|---|
| `borrow` | `sourceAssetId` (liability), `destinationAssetId`, `amountMinor` | liability `-P`, tujuan `+P` | sumber `asset_class='liability'`; tanpa kategori/biaya |
| `repay` | `sourceAssetId` (pembayar), `destinationAssetId` (liability), `amountMinor`, `charges?: [{typeId (system_key loan_interest "Bunga pinjaman"), amountMinor}]` (maks 1) | pembayar `-P`, liability `+P`, bunga `-I` di pembayar | tujuan liability |
| `refund` | `destinationAssetId`, `amountMinor`, `refundOfActivityId` | tujuan `+P` | asal = pengeluaran posted, mata uang sama; kategori disalin dari asal; total refund aktif <= pokok + biaya asal; pengeluaran asal tidak dapat di-void/dikoreksi selama masih ada refund aktif |
| `adjustment` | tepat satu dari `destinationAssetId` (naik) atau `sourceAssetId` (turun), `amountMinor`, `adjustmentReason` (`reconciliation` \| `opening_debt`) | `+P` atau `-P` | `opening_debt`: hanya `sourceAssetId` dan akun liability; saldo awal akun tetap 0 |

Jadwal pokok: `borrow` dan `opening_debt` boleh membawa `creditCycle` + `creditInstallments { count >= 2, principalMinor, interestMinor: "0" }` (bunga selalu dibukukan saat `repay`);
tanpa jadwal seluruh pokok menjadi tagihan saat ini. `creditDebtMinor`/`availableMinor` memakai rumus yang sama.

Contoh `repay`:
```json
{ "draft": { "kind": "repay", "amountMinor": "1000000", "sourceAssetId": "<uuid>", "destinationAssetId": "<uuid liability>",
  "charges": [{ "typeId": "<uuid loan_interest>", "amountMinor": "50000" }], "occurredAt": "2026-03-01T05:00:00.000Z" }, "idempotencyKey": "<uuid>" }
```
Respons: `{ "id": "<uuid>" }`. Contoh `refund`: `{ "draft": { "kind": "refund", "amountMinor": "40000", "destinationAssetId": "<uuid>", "refundOfActivityId": "<uuid expense>", "occurredAt": "..." }, "idempotencyKey": "<uuid>" }`.

`FinanceActivity` mendapat `refundOfActivityId?: string|null` dan `adjustmentReason?: "reconciliation"|"opening_debt"|null`.
GET `/api/finance/activities?kind=` menerima ketujuh jenis.
Analitik (`FinancialMeasures`) mendapat `adjustmentInMinor`, `adjustmentOutMinor`, `debtBorrowedMinor`, `debtRepaidMinor`, `refundCount` (string, opsional);
`expensePrincipalMinor`/`spendingMinor` sudah dikurangi refund (bisa negatif per kategori) dan memuat bunga repay; `incomeMinor` tidak terpengaruh.
`monthlyExpenses`/`expenseMinor` dan anggaran terpakai juga mengurangi refund dan menghitung bunga repay.
Ekspor transaksi memberi label "Pinjaman cair", "Pelunasan pinjaman", "Refund", "Penyesuaian saldo".

## Tambahan: katalog bertingkat dan sifat kategori (migrasi 018/019)

Sumber isi katalog bawaan: `docs/CATALOG.md` (seed 019). Kategori dua tingkat: induk (`parentId: null`) dan anak. Anak selalu sejenis dengan induknya (income/expense).
`nature` (sifat, hanya pengeluaran): `need | want | obligation | social | saving`; anak tanpa sifat mewarisi sifat induk saat dibuat.
`parentId` dan `nature` hanya boleh berubah dari `null` ke nilai (sekali); setelah terisi terkunci. Sifat efektif: `effectiveNature = natureOverride ?? nature ?? sifat induk`.

`GET /api/finance/options` (`catalogs.transactionCategories[]`) dan `listCatalog("transactionCategories")` kini memuat `parentId`, `nature`, `natureOverride`, `effectiveNature`.
Contoh nyata (fixture `tests/catalog-db.test.mjs`):
```json
{"id":"50000000-0000-4000-8000-000000000120","displayName":"Makan di luar","systemKey":"food_dining","isBuiltIn":true,"isActive":true,
 "appliesTo":"expense","parentId":"50000000-0000-4000-8000-000000000001","nature":"want","natureOverride":null,"effectiveNature":"want"}
```
- `POST /api/finance/catalog-create` dengan `catalog: "transactionCategories"` menerima `parentId?` (induk tingkat 1, jenis sama). Tanpa `parentId` kategori menjadi induk. Respons `{ item }` memuat field di atas.
- `POST /api/finance/category-nature` body `{ "id": "<uuid kategori pengeluaran>", "nature": "saving" | null }` -> `{ "ok": true }`. Override milik pengguna; `null` menghapusnya; entri bawaan tidak diubah.
- Entri demo 002 yang tidak terpakai dinonaktifkan; jenis aset baru (`time_deposit, gold, prepaid_card, credit_card, paylater, loan, receivable`) dan jenis biaya baru (`cash_withdrawal_fee, stamp_duty, penalty_fee, shipping_fee, top_up_fee`) tersedia.
- Analitik (`byCategory` tidak berubah): `byCategoryParent: DimensionRow[]` (pengeluaran dikelompokkan ke induk; kategori induk adalah grupnya sendiri; `key`=id induk atau `uncategorized`)
  dan `byNature: DimensionRow[]` (`key` = sifat efektif atau `none` = "Tanpa sifat"; nama Indonesia: Kebutuhan, Keinginan, Kewajiban, Sosial, Tabungan). Refund dihitung negatif seperti pada `byCategory`.
- Catatan: `listCatalog` masih menjalankan pembersihan runtime lama untuk penyedia/jaringan demo (hapus bila tak terpakai) dan menandai kategori "biaya admin" sebagai bawaan `bank_admin_fee`; tidak diubah di tugas ini.

## Tambahan: rekonsiliasi angka (migrasi 020)

Satu definisi pengeluaran untuk semua laporan (view `spending_effects`): **pengeluaran = pokok expense + semua biaya (biaya expense, biaya transfer, bunga repay) − refund**.
Pembelian kartu kredit/cicilan = pengeluaran penuh saat pembelian; pembayaran tagihan kartu = transfer (bukan pengeluaran); bunga cicilan = biaya.
Pokok borrow, pokok repay, transfer, dan adjustment bukan pengeluaran. Refund dihitung pada TANGGAL REFUND terhadap akun dan kategori versi terbaru pengeluaran asal
(mengikuti rantai koreksi `replaces_activity_id`). Pengeluaran asal boleh dikoreksi selama tidak di bawah total refund; void pengeluaran ditolak selama masih ada refund aktif.
Bulan dikelompokkan memakai Asia/Jakarta (1 Nov 00:30 WIB masuk November). **Pengeluaran bersih per kategori/bulan boleh negatif di backend; frontend yang membatasi tampilan di 0.**
Refund tidak pernah masuk `incomeMinor`. Saldo akun punya satu sumber (`listAssets`; `listAssetBalances` memanggilnya). `netWorthMinor` = Σ saldo akun + nilai pasar investasi (kewajiban bersaldo negatif).

- `AssetDetailInfo.activitySummary.expenseMinor` kini pengeluaran bersih yang dibayar dari akun itu (termasuk biaya transfer dan bunga repay, dikurangi refund); field baru `refundMinor` (sudah terkurang dari `expenseMinor`); `transferOutMinor` hanya pokok.
  Contoh nyata (fixture `tests/reconcile-db.test.mjs`, akun dompet):
  `{"activityCount":14,"incomeMinor":"5000000","expenseMinor":"1074500","refundMinor":"200000","transferInMinor":"0","transferOutMinor":"520000"}`
- Analitik: `expenseItems[].refundedMinor` (total refund sampai kini atas pengeluaran itu; `spendingMinor` tetap bruto) dan daftar baru `spendingItems[]` (`readSpendingItems`) yang jumlahnya persis `spendingMinor` periode (refund negatif).
  Contoh: `{"id":"…","kind":"refund","occurredAt":"2026-11-04T05:00:00.000Z","currency":"IDR","exponent":0,"amountMinor":"-50000","assetId":"…","categoryId":"50000000-0000-4000-8000-000000000002","categoryName":"Transport"}`
  `kind`: `expense | transfer | repay | refund`; transfer dan repay hanya memuat biayanya.
- Dimensi `account` di analitik untuk refund memakai akun pembayar pengeluaran asal.
- `monthlyExpenses(at?)` / `expenseMinor` snapshot memakai definisi yang sama (refund mengurangi di bulan refund).
- `listCatalog` kini baca-saja; penyedia/jaringan demo yang tidak terpakai dihapus oleh migrasi 020. Penandaan kategori "biaya admin" sebagai `bank_admin_fee` dihapus dari kode (ditangani skrip lokal terpisah).
