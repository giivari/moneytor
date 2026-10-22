import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import type { ImportColumnMapping, ImportSourceFormat, NormalizedImportRow } from "./types";

export class ImportValidationError extends Error {}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function readZipEntries(buffer: Buffer): Record<string, string> {
  const entries: Record<string, string> = {};
  // Locate End of Central Directory (0x06054b50) to reliably support both normal and data-descriptor ZIPs.
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new ImportValidationError("File Excel (.xlsx) tidak valid atau rusak.");
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  let ptr = cdOffset;
  for (let idx = 0; idx < totalEntries && ptr + 46 <= buffer.length; idx++) {
    if (buffer.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(ptr + 10);
    const compressedSize = buffer.readUInt32LE(ptr + 20);
    const nameLen = buffer.readUInt16LE(ptr + 28);
    const extraLen = buffer.readUInt16LE(ptr + 30);
    const commentLen = buffer.readUInt16LE(ptr + 32);
    const localHeaderOffset = buffer.readUInt32LE(ptr + 42);
    const name = buffer.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    ptr += 46 + nameLen + extraLen + commentLen;

    if ( name.endsWith(".xml") || name.endsWith(".rels")) {
      if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) continue;
      const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const raw = buffer.subarray(dataStart, dataStart + compressedSize);
      const unpacked = method === 8 ? inflateRawSync(raw) : method === 0 ? raw : null;
      if (unpacked) entries[name] = unpacked.toString("utf8");
    }
  }
  return entries;
}

function indexToColLetter(idx: number): string {
  let n = idx + 1;
  let col = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.trunc((n - 1) / 26);
  }
  return col;
}

export type RawSheetTable = {
  sheets: string[];
  selectedSheet: string | null;
  rows: { rowNumber: number; cells: Record<string, string> }[];
};

export function parseXlsxBuffer(buffer: Buffer, requestedSheet?: string): RawSheetTable {
  const entries = readZipEntries(buffer);
  const workbookXml = entries["xl/workbook.xml"];
  if (!workbookXml) throw new ImportValidationError("Struktur workbook Excel (.xlsx) tidak ditemukan.");
  const sharedStrings: string[] = [];
  const sstXml = entries["xl/sharedStrings.xml"] ?? "";
  for (const si of sstXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const parts = [...si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXmlEntities(m[1]));
    sharedStrings.push(parts.join(""));
  }
  const relsXml = entries["xl/_rels/workbook.xml.rels"] ?? "";
  const relMap = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = m[0];
    const id = (tag.match(/\bId="([^"]+)"/) ?? [])[1];
    const target = (tag.match(/\bTarget="([^"]+)"/) ?? [])[1];
    if (id && target) relMap.set(id, target);
  }
  const sheetDefs: { name: string; path: string }[] = [];
  for (const m of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const tag = m[0];
    const name = decodeXmlEntities((tag.match(/\bname="([^"]+)"/) ?? [])[1] ?? "");
    const rId = (tag.match(/\br:id="([^"]+)"/) ?? [])[1];
    const target = rId ? relMap.get(rId) : undefined;
    if (name && target) {
      const normalizedPath = "xl/" + target.replace(/^\/?(?:xl\/)?/, "");
      sheetDefs.push({ name, path: normalizedPath });
    }
  }
  if (!sheetDefs.length) throw new ImportValidationError("Workbook Excel tidak memiliki sheet.");
  const sheets = sheetDefs.map((s) => s.name);
  const chosen = (requestedSheet ? sheetDefs.find((s) => s.name === requestedSheet) : undefined)
    ?? sheetDefs.find((s) => /^(transactions|transaksi|aktivitas|mutasi)$/i.test(s.name.trim()))
    ?? sheetDefs[0];
  const xml = entries[chosen.path] ?? "";
  const rows: { rowNumber: number; cells: Record<string, string> }[] = [];
  let fallbackRowNum = 0;
  for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    fallbackRowNum += 1;
    const rowAttrs = rm[1];
    const rowBody = rm[2];
    const rowNumber = Number((rowAttrs.match(/\br="(\d+)"/) ?? [])[1] ?? fallbackRowNum);
    const cells: Record<string, string> = {};
    let fallbackColIdx = 0;
    for (const cm of rowBody.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? "";
      const refCol = (attrs.match(/\br="([A-Z]+)\d+"/) ?? [])[1] ?? indexToColLetter(fallbackColIdx);
      fallbackColIdx += 1;
      if (!body) continue;
      const cellType = (attrs.match(/\bt="([^"]+)"/) ?? [])[1];
      const vMatch = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
      const inlineMatch = body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/);
      let val = "";
      if (cellType === "s" && vMatch) {
        val = sharedStrings[Number(vMatch[1].trim())] ?? "";
      } else if (inlineMatch) {
        val = [...inlineMatch[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXmlEntities(t[1])).join("");
      } else if (vMatch) {
        val = decodeXmlEntities(vMatch[1]);
      }
      const trimmed = val.trim();
      if (trimmed !== "") cells[refCol] = trimmed;
    }
    if (Object.keys(cells).length > 0) rows.push({ rowNumber, cells });
  }
  return { sheets, selectedSheet: chosen.name, rows };
}

export function parseCsvText(csvText: string): RawSheetTable {
  const cleaned = csvText.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const firstLine = cleaned.split("\n", 1)[0] ?? "";
  const counts = [
    { sep: ",", n: (firstLine.match(/,/g) ?? []).length },
    { sep: ";", n: (firstLine.match(/;/g) ?? []).length },
    { sep: "\t", n: (firstLine.match(/\t/g) ?? []).length },
  ].sort((a, b) => b.n - a.n);
  const delimiter = counts[0].n > 0 ? counts[0].sep : ",";

  const parsedRows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inQuotes) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      currentRow.push(currentField.trim());
      currentField = "";
    } else if (ch === "\n") {
      currentRow.push(currentField.trim());
      if (currentRow.some((cell) => cell !== "")) parsedRows.push(currentRow);
      currentRow = [];
      currentField = "";
    } else {
      currentField += ch;
    }
  }
  currentRow.push(currentField.trim());
  if (currentRow.some((cell) => cell !== "")) parsedRows.push(currentRow);

  const rows = parsedRows.map((arr, idx) => {
    const cells: Record<string, string> = {};
    arr.forEach((val, colIdx) => {
      if (val !== "") cells[indexToColLetter(colIdx)] = val;
    });
    return { rowNumber: idx + 1, cells };
  });
  return { sheets: [], selectedSheet: null, rows };
}

const HEADER_SYNONYMS: Record<keyof ImportColumnMapping, RegExp> = {
  date: /^(date|tanggal|tgl|waktu|occurred[_\s-]?at)$/i,
  kind: /^(type|jenis|tipe|kind|kategori[_\s-]?arus)$/i,
  account: /^(account|akun|rekening|source[_\s-]?account|akun[_\s-]?asal|dari[_\s-]?akun|dompet)$/i,
  toAccount: /^(to[_\s-]?account|akun[_\s-]?tujuan|ke[_\s-]?akun|destination[_\s-]?account|tujuan|rekening[_\s-]?tujuan)$/i,
  category: /^(category|kategori|pos)$/i,
  note: /^(description|deskripsi|catatan|note|keterangan|memo|uraian|judul)$/i,
  amount: /^(amount(?:\s*\([^)]*\))?|nominal(?:\s*\([^)]*\))?|jumlah(?:\s*\([^)]*\))?|nilai|besar)$/i,
  fee: /^(fee|biaya|transfer[_\s-]?fee|biaya[_\s-]?transfer|admin)$/i,
  status: /^(status|keadaan)$/i,
};

export function detectColumnsAndHeader(
  table: RawSheetTable,
  overrideMapping?: Partial<ImportColumnMapping>,
): {
  headerRowNumber: number;
  availableColumns: { key: string; label: string }[];
  columnMapping: ImportColumnMapping;
  dataRows: { rowNumber: number; cells: Record<string, string> }[];
} {
  let bestRowIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < Math.min(table.rows.length, 15); i++) {
    const cells = table.rows[i].cells;
    let score = 0;
    for (const val of Object.values(cells)) {
      const clean = val.trim();
      for (const regex of Object.values(HEADER_SYNONYMS)) {
        if (regex.test(clean)) {
          score += 1;
          break;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestRowIdx = i;
    }
  }

  const headerRow = table.rows[bestRowIdx] ?? { rowNumber: 1, cells: {} };
  const availableColumns = Object.entries(headerRow.cells).map(([key, label]) => ({
    key,
    label: `${key}: ${label}`,
  }));

  const autoMap: Partial<ImportColumnMapping> = {};
  for (const [colKey, rawLabel] of Object.entries(headerRow.cells)) {
    const label = rawLabel.trim();
    for (const [field, regex] of Object.entries(HEADER_SYNONYMS) as [keyof ImportColumnMapping, RegExp][]) {
      if (!autoMap[field] && regex.test(label)) {
        autoMap[field] = colKey;
      }
    }
  }

  const columnMapping: ImportColumnMapping = {
    date: overrideMapping?.date ?? autoMap.date ?? "A",
    kind: overrideMapping?.kind ?? autoMap.kind ?? "B",
    account: overrideMapping?.account ?? autoMap.account ?? "C",
    toAccount: overrideMapping?.toAccount ?? autoMap.toAccount ?? "",
    category: overrideMapping?.category ?? autoMap.category ?? "",
    note: overrideMapping?.note ?? autoMap.note ?? "",
    amount: overrideMapping?.amount ?? autoMap.amount ?? "G",
    fee: overrideMapping?.fee ?? autoMap.fee ?? "",
    status: overrideMapping?.status ?? autoMap.status ?? "",
  };

  const dataRows = table.rows.slice(bestRowIdx + 1);
  return {
    headerRowNumber: headerRow.rowNumber,
    availableColumns,
    columnMapping,
    dataRows,
  };
}

export function parseImportDate(raw: string): { occurredAt: string; occurredDay: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Excel serial date (e.g., 46285 -> 2026-09-20)
  if (/^\d{4,6}(?:\.\d+)?$/.test(trimmed)) {
    const serial = Number(trimmed);
    if (Number.isFinite(serial) && serial >= 25569 && serial <= 80000) {
      const utcMs = Math.round((serial - 25569) * 86400 * 1000);
      const d = new Date(utcMs);
      if (!Number.isNaN(d.getTime())) {
        const iso = d.toISOString();
        return { occurredAt: iso, occurredDay: iso.slice(0, 10) };
      }
    }
  }

  // YYYY-MM-DD or ISO timestamp
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(`${trimmed}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime()) && d.toISOString().startsWith(trimmed)) {
      return { occurredAt: d.toISOString(), occurredDay: trimmed };
    }
    return null;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(trimmed);
  if (dmy) {
    const day = dmy[1].padStart(2, "0");
    const month = dmy[2].padStart(2, "0");
    const year = dmy[3];
    const isoDay = `${year}-${month}-${day}`;
    const d = new Date(`${isoDay}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime()) && d.toISOString().startsWith(isoDay)) {
      return { occurredAt: d.toISOString(), occurredDay: isoDay };
    }
    return null;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const iso = parsed.toISOString();
    return { occurredAt: iso, occurredDay: iso.slice(0, 10) };
  }
  return null;
}

export function parseImportKind(raw: string): "income" | "expense" | "transfer" | null {
  const clean = raw.trim().toLowerCase();
  if (["income", "pemasukan", "masuk", "pendapatan", "gaji"].includes(clean)) return "income";
  if (["expense", "pengeluaran", "keluar", "belanja", "biaya"].includes(clean)) return "expense";
  if (["transfer", "pindah buku", "mutasi internal", "pindah"].includes(clean)) return "transfer";
  return null;
}

export function parseImportMinorAmount(raw: string, exponent = 0): string | null {
  let clean = raw.trim().replace(/^(?:Rp|IDR|USD|\$)\s*/i, "").trim();
  if (!clean) return null;

  // Handle formatted numbers like "1.650.000" (ID thousand separators) or "1,650,000"
  if (exponent === 0) {
    if (/^\d{1,3}(\.\d{3})+$/.test(clean)) clean = clean.replace(/\./g, "");
    else if (/^\d{1,3}(,\d{3})+$/.test(clean)) clean = clean.replace(/,/g, "");
    else if (/^\d+\.0+$/.test(clean)) clean = clean.replace(/\.0+$/, "");
    if (!/^\d+$/.test(clean)) return null;
    try {
      const value = BigInt(clean);
      return value > 0n ? value.toString() : null;
    } catch {
      return null;
    }
  }

  // Currency with decimal subunits (e.g. exponent = 2)
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(clean)) clean = clean.replace(/,/g, "");
  else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(clean)) clean = clean.replace(/\./g, "").replace(",", ".");
  const match = /^(\d+)(?:\.(\d+))?$/.exec(clean);
  if (!match) return null;
  const whole = match[1];
  const frac = (match[2] ?? "").padEnd(exponent, "0");
  if (frac.length > exponent) return null;
  try {
    const value = BigInt(whole) * (10n ** BigInt(exponent)) + BigInt(frac || "0");
    return value > 0n ? value.toString() : null;
  } catch {
    return null;
  }
}

export function normalizeRawImportRows(
  dataRows: { rowNumber: number; cells: Record<string, string> }[],
  mapping: ImportColumnMapping,
  exponent = 0,
): NormalizedImportRow[] {
  const occurrenceCounts = new Map<string, number>();
  const results: NormalizedImportRow[] = [];

  for (const row of dataRows) {
    const get = (col?: string) => (col ? (row.cells[col] ?? "").trim() : "");
    const rawDate = get(mapping.date);
    const rawKind = get(mapping.kind);
    const rawAccount = get(mapping.account);
    const rawToAccount = get(mapping.toAccount);
    const rawCategory = get(mapping.category);
    const note = get(mapping.note).slice(0, 1000);
    const rawAmount = get(mapping.amount);
    const rawFee = get(mapping.fee);
    const rawStatus = get(mapping.status);

    // Skip completely blank or instruction/footer rows that lack date, type, and amount
    if (!rawDate && !rawKind && !rawAmount) continue;

    const parseErrors: string[] = [];
    const dateInfo = parseImportDate(rawDate);
    if (!dateInfo) parseErrors.push(`Tanggal '${rawDate || "kosong"}' tidak valid.`);

    const kind = parseImportKind(rawKind);
    if (!kind) parseErrors.push(`Jenis transaksi '${rawKind || "kosong"}' harus Income, Expense, atau Transfer.`);

    const amountMinor = parseImportMinorAmount(rawAmount, exponent);
    if (!amountMinor) parseErrors.push(`Nominal '${rawAmount || "kosong"}' harus berupa angka positif.`);

    let feeMinor: string | null = null;
    if (rawFee && rawFee !== "0") {
      feeMinor = parseImportMinorAmount(rawFee, exponent);
      if (!feeMinor) parseErrors.push(`Biaya '${rawFee}' tidak valid.`);
    }

    let sourceAccountName = "";
    let destinationAccountName = "";
    if (kind === "income") {
      // Workbook convention: "Income: Account = penerima" unless To Account is explicitly populated
      destinationAccountName = rawToAccount || rawAccount;
      if (!destinationAccountName) parseErrors.push("Akun penerima untuk Pemasukan belum diisi.");
    } else if (kind === "expense") {
      sourceAccountName = rawAccount;
      if (!sourceAccountName) parseErrors.push("Akun pembayar untuk Pengeluaran belum diisi.");
    } else if (kind === "transfer") {
      sourceAccountName = rawAccount;
      destinationAccountName = rawToAccount;
      if (!sourceAccountName || !destinationAccountName) {
        parseErrors.push("Transfer membutuhkan Akun Asal dan Akun Tujuan.");
      } else if (sourceAccountName.toLowerCase() === destinationAccountName.toLowerCase()) {
        parseErrors.push("Akun asal dan tujuan Transfer tidak boleh sama.");
      }
    }

    const categoryName = kind === "transfer" ? "" : (rawCategory.toLowerCase() === "transfer" ? "" : rawCategory);
    const nonPostedStatus = Boolean(rawStatus && !/^(posted|aktif|selesai|ok|berhasil)$/i.test(rawStatus));

    const baseKey = JSON.stringify([
      dateInfo?.occurredDay ?? rawDate,
      kind ?? rawKind.toLowerCase(),
      amountMinor ?? rawAmount,
      sourceAccountName.toLowerCase(),
      destinationAccountName.toLowerCase(),
      categoryName.toLowerCase(),
      note.toLowerCase(),
    ]);
    const seq = (occurrenceCounts.get(baseKey) ?? 0) + 1;
    occurrenceCounts.set(baseKey, seq);
    const rowFingerprint = createHash("sha256").update(`${baseKey}#${seq}`).digest("hex");

    results.push({
      rowNumber: row.rowNumber,
      rawDate,
      occurredAt: dateInfo?.occurredAt ?? null,
      occurredDay: dateInfo?.occurredDay ?? null,
      rawKind,
      kind,
      sourceAccountName,
      destinationAccountName,
      categoryName,
      note,
      rawAmount,
      amountMinor,
      feeMinor,
      rawStatus,
      nonPostedStatus,
      rowFingerprint,
      parseErrors,
    });
  }

  return results;
}

export function parseImportPayload(input: {
  fileName: string;
  contentBase64: string;
  sheetName?: string;
  columnMapping?: Partial<ImportColumnMapping>;
  exponent?: number;
}): {
  sourceFormat: ImportSourceFormat;
  fileSha256: string;
  sheets: string[];
  selectedSheet: string | null;
  headerRowNumber: number;
  availableColumns: { key: string; label: string }[];
  columnMapping: ImportColumnMapping;
  rows: NormalizedImportRow[];
} {
  const buffer = Buffer.from(input.contentBase64, "base64");
  if (!buffer.length) throw new ImportValidationError("File impor kosong.");
  if (buffer.length > 5 * 1024 * 1024) throw new ImportValidationError("Ukuran file melebihi batas 5 MB.");
  const fileSha256 = createHash("sha256").update(buffer).digest("hex");
  const isXlsx = input.fileName.toLowerCase().endsWith(".xlsx") || (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50);
  const sourceFormat: ImportSourceFormat = isXlsx ? "xlsx" : "csv";
  const table = isXlsx ? parseXlsxBuffer(buffer, input.sheetName) : parseCsvText(buffer.toString("utf8"));
  const { headerRowNumber, availableColumns, columnMapping, dataRows } = detectColumnsAndHeader(table, input.columnMapping);
  const rows = normalizeRawImportRows(dataRows, columnMapping, input.exponent ?? 0);
  return {
    sourceFormat,
    fileSha256,
    sheets: table.sheets,
    selectedSheet: table.selectedSheet,
    headerRowNumber,
    availableColumns,
    columnMapping,
    rows,
  };
}
