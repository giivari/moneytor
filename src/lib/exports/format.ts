import { deflateRawSync } from "node:zlib";
import { parseImportMinorAmount, parseXlsxBuffer } from "../imports/parser.ts";
import { resolveProviderMark } from "../domain/provider-marks.ts";

export type StagedWorkbookAccount = {
  rowNumber: number;
  displayName: string;
  rawBucket: string;
  rawType: string;
  rawRole: string;
  openingAmountMinor: string;
  currency: string;
  assetTypeSystemKey: "bank_account" | "e_wallet" | "physical_cash" | "investment_account";
  assetGroupSystemKey: "liquid" | "reserve" | "investment";
  normallyLiquid: boolean;
  normallySpendable: boolean;
  inferredProviderName: string | null;
  note: string;
  alreadyExists: boolean;
  existingAssetId: string | null;
  defaultSelected: boolean;
};

export type WorkbookAccountMigrationPreview = {
  fileName: string;
  sheetName: string;
  accounts: StagedWorkbookAccount[];
  summary: {
    totalDetected: number;
    newAccountsCount: number;
    existingAccountsCount: number;
  };
};

export type StatementPdfInput = {
  title: string;
  subtitle: string;
  generatedAt?: string;
  summaryItems?: { label: string; value: string }[];
  headers: readonly string[];
  rows: readonly (readonly (string | number | boolean | null | undefined)[])[];
  rightAlignCols?: readonly number[];
};

function sanitizeCsvField(raw: string): string {
  let value = raw;
  // Prevent spreadsheet formula injection on text fields starting with =, +, @, or tab/CR,
  // while allowing negative numbers (-12345) and formatted negative currency (-Rp ...) to remain readable.
  if (/^[=+@\t\r]/.test(value) || (/^-[^0-9R]/.test(value))) {
    value = `'${value}`;
  }
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsvDocument(
  headers: readonly string[],
  rows: readonly (readonly (string | number | boolean | null | undefined)[])[],
): string {
  const headerLine = headers.map((h) => sanitizeCsvField(String(h))).join(",");
  const bodyLines = rows.map((row) =>
    row
      .map((cell) => {
        if (cell === null || cell === undefined) return "";
        return sanitizeCsvField(String(cell));
      })
      .join(","),
  );
  return "\uFEFF" + [headerLine, ...bodyLines].join("\r\n") + "\r\n";
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function colIndexToLetter(idx: number): string {
  let n = idx + 1;
  let col = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.trunc((n - 1) / 26);
  }
  return col;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZipBuffer(files: { name: string; data: Buffer }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, "utf8");
    const uncompressed = file.data;
    const compressed = deflateRawSync(uncompressed);
    const checksum = crc32(uncompressed);

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(8, 8); // deflate
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x554b, 12); // mod date
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    localParts.push(localHeader, compressed);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x554b, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

export function toXlsxBuffer(
  sheetName: string,
  headers: readonly string[],
  rows: readonly (readonly (string | number | boolean | null | undefined)[])[],
): Buffer {
  const safeSheetName = (sheetName.replace(/[\\/?*[\]:]/g, " ").trim() || "Data").slice(0, 31);
  const allRows = [headers, ...rows];

  const colWidths = headers.map((h, colIdx) => {
    let maxLen = String(h).length;
    for (const row of rows) {
      const cell = row[colIdx];
      const len = cell === null || cell === undefined ? 0 : String(cell).length;
      if (len > maxLen) maxLen = len;
    }
    return Math.min(Math.max(maxLen + 4, 12), 46);
  });

  const colsXml =
    "<cols>" +
    colWidths
      .map((w, idx) => `<col min="${idx + 1}" max="${idx + 1}" width="${w}" customWidth="1"/>`)
      .join("") +
    "</cols>";

  const rowsXml = allRows
    .map((row, rIdx) => {
      const rowNum = rIdx + 1;
      const isHeader = rIdx === 0;
      const styleAttr = isHeader ? ' s="1"' : ' s="0"';
      const cellsXml = row
        .map((cell, cIdx) => {
          const ref = `${colIndexToLetter(cIdx)}${rowNum}`;
          if (cell === null || cell === undefined || cell === "") {
            return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t></t></is></c>`;
          }
          if (!isHeader && typeof cell === "number" && Number.isFinite(cell)) {
            return `<c r="${ref}"${styleAttr}><v>${cell}</v></c>`;
          }
          let str = String(cell);
          if (/^[=+@\t\r]/.test(str) || (/^-[^0-9R]/.test(str))) {
            str = `'${str}`;
          }
          return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(str)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowNum}"${isHeader ? ' ht="22" customHeight="1"' : ""}>${cellsXml}</row>`;
    })
    .join("");

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${colsXml}
  <sheetData>${rowsXml}</sheetData>
</worksheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(safeSheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="10"/><color rgb="FF1D2225"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top>
      <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
  </cellXfs>
</styleSheet>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  return buildZipBuffer([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypesXml, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRelsXml, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbookXml, "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRelsXml, "utf8") },
    { name: "xl/styles.xml", data: Buffer.from(stylesXml, "utf8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheetXml, "utf8") },
  ]);
}

function escapePdfText(raw: string): string {
  // Normalize Unicode minus/bullet/arrows to WinAnsi-safe equivalents for built-in PDF Helvetica font
  const normalized = raw
    .replace(/\u2212/g, "-")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2192/g, "->")
    .replace(/\u2022/g, "*")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, " ");
  return normalized.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function fitPdfCellText(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  if (maxChars <= 3) return clean.slice(0, maxChars);
  return clean.slice(0, maxChars - 2) + "..";
}

export function toStatementPdfBuffer(input: StatementPdfInput): Buffer {
  const pageWidth = 841.89; // A4 Landscape width in pt
  const pageHeight = 595.28; // A4 Landscape height in pt
  const marginX = 36;
  const contentWidth = pageWidth - marginX * 2;
  const rightAlignSet = new Set(input.rightAlignCols ?? []);
  const generatedLabel =
    input.generatedAt ??
    new Date().toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }) + " WIB";

  // Compute proportional column widths based on content length
  const colWeights = input.headers.map((h, idx) => {
    let maxLen = Math.max(String(h).length, 6);
    for (let r = 0; r < Math.min(input.rows.length, 60); r++) {
      const val = input.rows[r]?.[idx];
      const len = val === null || val === undefined ? 0 : String(val).length;
      if (len > maxLen) maxLen = Math.min(len, 38);
    }
    return maxLen + 3;
  });
  const totalWeight = colWeights.reduce((acc, w) => acc + w, 0) || 1;
  const colWidths = colWeights.map((w) => (w / totalWeight) * contentWidth);

  const firstPageRowsCap = input.summaryItems && input.summaryItems.length > 0 ? 18 : 21;
  const nextPageRowsCap = 24;

  const rowChunks: (readonly (string | number | boolean | null | undefined)[])[][] = [];
  if (input.rows.length === 0) {
    rowChunks.push([]);
  } else {
    let cursor = 0;
    rowChunks.push(input.rows.slice(cursor, cursor + firstPageRowsCap));
    cursor += firstPageRowsCap;
    while (cursor < input.rows.length) {
      rowChunks.push(input.rows.slice(cursor, cursor + nextPageRowsCap));
      cursor += nextPageRowsCap;
    }
  }

  const totalPages = rowChunks.length;
  const pageStreams: string[] = [];

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const ops: string[] = [];
    const chunk = rowChunks[pageIdx];

    // Top bank-statement header banner
    ops.push("0.11 0.16 0.23 rg");
    ops.push(`${marginX} ${pageHeight - 82} ${contentWidth} 52 re f`);

    ops.push("0.75 0.85 0.96 rg");
    ops.push(`BT /F2 8 Tf ${marginX + 14} ${pageHeight - 46} Td (MONEYTOR  |  E-STATEMENT & LAPORAN KEUANGAN PRIBADI) Tj ET`);

    ops.push("1 1 1 rg");
    ops.push(`BT /F2 15 Tf ${marginX + 14} ${pageHeight - 66} Td (${escapePdfText(input.title)}) Tj ET`);

    const rightMeta = `Dicetak: ${generatedLabel}`;
    const rightMetaX = pageWidth - marginX - Math.min(rightMeta.length * 4.5 + 16, 260);
    ops.push("0.88 0.92 0.97 rg");
    ops.push(`BT /F1 8.5 Tf ${rightMetaX} ${pageHeight - 48} Td (${escapePdfText(rightMeta)}) Tj ET`);
    ops.push(`BT /F1 8.5 Tf ${rightMetaX} ${pageHeight - 64} Td (${escapePdfText(input.subtitle.slice(0, 56))}) Tj ET`);

    let currentY = pageHeight - 96;

    // Summary boxes on Page 1
    if (pageIdx === 0 && input.summaryItems && input.summaryItems.length > 0) {
      const items = input.summaryItems.slice(0, 4);
      const gap = 10;
      const boxW = (contentWidth - gap * (items.length - 1)) / items.length;
      const boxH = 42;
      const boxBottomY = currentY - boxH;

      items.forEach((item, idx) => {
        const bx = marginX + idx * (boxW + gap);
        ops.push("0.96 0.97 0.99 rg");
        ops.push("0.84 0.88 0.92 RG 0.7 w");
        ops.push(`${bx.toFixed(2)} ${boxBottomY.toFixed(2)} ${boxW.toFixed(2)} ${boxH} re B`);

        ops.push("0.38 0.45 0.53 rg");
        ops.push(`BT /F1 8 Tf ${(bx + 10).toFixed(2)} ${(boxBottomY + 26).toFixed(2)} Td (${escapePdfText(fitPdfCellText(item.label, 34))}) Tj ET`);

        ops.push("0.11 0.15 0.20 rg");
        ops.push(`BT /F2 11 Tf ${(bx + 10).toFixed(2)} ${(boxBottomY + 10).toFixed(2)} Td (${escapePdfText(fitPdfCellText(item.value, 32))}) Tj ET`);
      });

      currentY = boxBottomY - 14;
    }

    // Table Header Bar
    const tableHeaderH = 22;
    const headerBottomY = currentY - tableHeaderH;
    ops.push("0.18 0.23 0.30 rg");
    ops.push(`${marginX} ${headerBottomY.toFixed(2)} ${contentWidth} ${tableHeaderH} re f`);

    let colX = marginX;
    input.headers.forEach((h, cIdx) => {
      const colW = colWidths[cIdx];
      const maxChars = Math.max(Math.floor((colW - 10) / 4.6), 4);
      const label = fitPdfCellText(String(h), maxChars);
      const isRight = rightAlignSet.has(cIdx);
      const textX = isRight
        ? colX + colW - 6 - label.length * 4.5
        : colX + 6;
      ops.push("1 1 1 rg");
      ops.push(`BT /F2 8.2 Tf ${Math.max(colX + 4, textX).toFixed(2)} ${(headerBottomY + 7).toFixed(2)} Td (${escapePdfText(label)}) Tj ET`);
      colX += colW;
    });

    currentY = headerBottomY;
    const rowH = 18;

    if (chunk.length === 0) {
      const emptyBottomY = currentY - 28;
      ops.push("0.98 0.98 0.99 rg");
      ops.push(`${marginX} ${emptyBottomY.toFixed(2)} ${contentWidth} 28 re f`);
      ops.push("0.42 0.47 0.52 rg");
      ops.push(`BT /F1 9 Tf ${marginX + 12} ${(emptyBottomY + 10).toFixed(2)} Td (Belum ada data tercatat pada bagian ini.) Tj ET`);
      currentY = emptyBottomY;
    } else {
      chunk.forEach((row, rIdx) => {
        const rowBottomY = currentY - rowH;
        if (rIdx % 2 === 1) {
          ops.push("0.965 0.975 0.988 rg");
          ops.push(`${marginX} ${rowBottomY.toFixed(2)} ${contentWidth} ${rowH} re f`);
        }
        ops.push("0.89 0.91 0.94 RG 0.4 w");
        ops.push(`${marginX} ${rowBottomY.toFixed(2)} m ${marginX + contentWidth} ${rowBottomY.toFixed(2)} l S`);

        let cellX = marginX;
        input.headers.forEach((_, cIdx) => {
          const colW = colWidths[cIdx];
          const rawVal = row[cIdx];
          const strVal = rawVal === null || rawVal === undefined ? "" : String(rawVal);
          const maxChars = Math.max(Math.floor((colW - 10) / 4.4), 4);
          const fitted = fitPdfCellText(strVal, maxChars);
          const isRight = rightAlignSet.has(cIdx);
          const textX = isRight
            ? cellX + colW - 6 - fitted.length * 4.3
            : cellX + 6;

          ops.push("0.13 0.16 0.19 rg");
          ops.push(`BT /F1 8 Tf ${Math.max(cellX + 4, textX).toFixed(2)} ${(rowBottomY + 5.5).toFixed(2)} Td (${escapePdfText(fitted)}) Tj ET`);
          cellX += colW;
        });

        currentY = rowBottomY;
      });
    }

    // Footer
    ops.push("0.82 0.85 0.89 RG 0.6 w");
    ops.push(`${marginX} 36 m ${pageWidth - marginX} 36 l S`);
    ops.push("0.45 0.50 0.56 rg");
    ops.push(`BT /F1 7.8 Tf ${marginX} 23 Td (Dokumen e-Statement ini dihasilkan secara otomatis oleh sistem Moneytor.) Tj ET`);
    const pageLabel = `Halaman ${pageIdx + 1} dari ${totalPages}`;
    ops.push(`BT /F2 8 Tf ${(pageWidth - marginX - pageLabel.length * 4.5).toFixed(2)} 23 Td (${escapePdfText(pageLabel)}) Tj ET`);

    pageStreams.push(ops.join("\n"));
  }

  // Assemble PDF 1.4 object graph:
  // 1: Catalog, 2: Pages, 3: Font F1 (Helvetica), 4: Font F2 (Helvetica-Bold)
  // For each page i: Page object = 5 + i*2, Content stream object = 6 + i*2
  const objects: string[] = [];
  const pageObjNums: number[] = [];

  for (let i = 0; i < totalPages; i++) {
    pageObjNums.push(5 + i * 2);
  }

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${totalPages} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
  objects[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;

  for (let i = 0; i < totalPages; i++) {
    const pageObjId = 5 + i * 2;
    const streamObjId = 6 + i * 2;
    const streamData = pageStreams[i];
    const byteLen = Buffer.byteLength(streamData, "utf8");
    objects[pageObjId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamObjId} 0 R >>`;
    objects[streamObjId] = `<< /Length ${byteLen} >>\nstream\n${streamData}\nendstream`;
  }

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary")];
  const offsets: number[] = [0];
  let byteOffset = chunks[0].length;

  for (let id = 1; id < objects.length; id++) {
    offsets[id] = byteOffset;
    const objBuf = Buffer.from(`${id} 0 obj\n${objects[id]}\nendobj\n`, "utf8");
    chunks.push(objBuf);
    byteOffset += objBuf.length;
  }

  const xrefOffset = byteOffset;
  const xrefLines = [`xref`, `0 ${objects.length}`, `0000000000 65535 f `];
  for (let id = 1; id < objects.length; id++) {
    xrefLines.push(`${String(offsets[id]).padStart(10, "0")} 00000 n `);
  }
  const trailer =
    xrefLines.join("\n") +
    `\ntrailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(Buffer.from(trailer, "utf8"));

  return Buffer.concat(chunks);
}

function normalizeName(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseOpeningMinorOrZero(raw: string): string | null {
  const trimmed = raw.trim().replace(/^(?:Rp|IDR|USD|\$)\s*/i, "").trim();
  if (!trimmed || /^0+(?:[.,]0+)?$/.test(trimmed)) return "0";
  return parseImportMinorAmount(raw, 0);
}

export function parseWorkbookAccountsSheet(
  buffer: Buffer,
  existingAssets: readonly { id: string; displayName: string; currency: string }[] = [],
  requestedSheet?: string,
): WorkbookAccountMigrationPreview & { availableSheets: string[] } {
  const prelim = parseXlsxBuffer(buffer);
  const targetSheet =
    requestedSheet && prelim.sheets.includes(requestedSheet)
      ? requestedSheet
      : prelim.sheets.find((s) => /^(accounts|akun|rekening|aset|assets)$/i.test(s.trim())) ?? prelim.sheets[0];
  const table = parseXlsxBuffer(buffer, targetSheet);

  // Locate header row containing "Account" / "Akun" / "Nama Aset"
  let headerIdx = -1;
  const colMap = {
    account: "A",
    bucket: "B",
    type: "C",
    role: "D",
    opening: "E",
    note: "H",
  };

  for (let i = 0; i < Math.min(table.rows.length, 15); i++) {
    const cells = table.rows[i].cells;
    let foundAccount = "";
    let foundOpening = "";
    for (const [col, val] of Object.entries(cells)) {
      const cleaned = val.trim();
      if (/^(account|akun|rekening|nama\s*aset|asset)$/i.test(cleaned)) foundAccount = col;
      if (/^(opening\s*balance|saldo\s*awal)/i.test(cleaned)) foundOpening = col;
    }
    if (foundAccount) {
      headerIdx = i;
      colMap.account = foundAccount;
      if (foundOpening) colMap.opening = foundOpening;
      for (const [col, val] of Object.entries(cells)) {
        const cleaned = val.trim();
        if (/^(bucket|grup|group|alokasi)$/i.test(cleaned)) colMap.bucket = col;
        else if (/^(type|jenis|tipe)$/i.test(cleaned)) colMap.type = col;
        else if (/^(role|peran|fungsi)$/i.test(cleaned)) colMap.role = col;
        else if (/^(note|catatan|deskripsi|keterangan)$/i.test(cleaned)) colMap.note = col;
      }
      break;
    }
  }

  const existingByNorm = new Map<string, { id: string; displayName: string }>();
  for (const asset of existingAssets) {
    existingByNorm.set(normalizeName(asset.displayName), asset);
  }

  const startIndex = headerIdx >= 0 ? headerIdx + 1 : 0;
  const accounts: StagedWorkbookAccount[] = [];

  for (let i = startIndex; i < table.rows.length; i++) {
    const row = table.rows[i];
    const rawName = (row.cells[colMap.account] ?? "").trim();
    if (!rawName) continue;
    // Stop if we hit a secondary section header in the sheet (e.g. "BANK INTEREST CONTROL", "TOTAL", etc.)
    if (/^(bank\s+interest|total|ringkasan|summary|catatan|notes)\b/i.test(rawName)) {
      break;
    }
    const rawBucket = (row.cells[colMap.bucket] ?? "").trim();
    const rawType = (row.cells[colMap.type] ?? "").trim();
    const rawRole = (row.cells[colMap.role] ?? "").trim();
    const rawOpening = (row.cells[colMap.opening] ?? "0").trim();
    const rawNote = (row.cells[colMap.note] ?? "").trim();

    // Require at least a bucket, type, or numeric opening balance so prose rows are ignored
    const parsedOpening = parseOpeningMinorOrZero(rawOpening || "0");
    if (!rawBucket && !rawType && parsedOpening === null) continue;

    const openingAmountMinor = parsedOpening ?? "0";
    const bucketLower = rawBucket.toLowerCase();
    const typeLower = rawType.toLowerCase();
    const nameLower = rawName.toLowerCase();

    let assetGroupSystemKey: StagedWorkbookAccount["assetGroupSystemKey"] = "liquid";
    let normallyLiquid = true;
    let normallySpendable = true;

    if (/emergency|darurat|reserve|cadangan/i.test(bucketLower) || /reserve|cadangan/i.test(rawRole)) {
      assetGroupSystemKey = "reserve";
      normallyLiquid = true;
      normallySpendable = false;
    } else if (/invest/i.test(bucketLower) || /invest/i.test(rawRole) || /^(rdpu|sbn|gold|emas|equity|saham|reksa|obligasi|crypto)$/i.test(typeLower)) {
      assetGroupSystemKey = "investment";
      normallyLiquid = false;
      normallySpendable = false;
    }

    let assetTypeSystemKey: StagedWorkbookAccount["assetTypeSystemKey"] = "bank_account";
    if (assetGroupSystemKey === "investment" || /^(rdpu|sbn|gold|emas|equity|saham|reksa|obligasi|investment)$/i.test(typeLower)) {
      assetTypeSystemKey = "investment_account";
    } else if (/e[\s-]*money|flazz|gopay|ovo|dana|shopeepay|linkaja|wallet|dompet\s*digital/i.test(`${nameLower} ${typeLower}`)) {
      assetTypeSystemKey = /cash\s*wallet/i.test(nameLower) ? "physical_cash" : "e_wallet";
    } else if (/^(cash|tunai|kas)$/i.test(typeLower) || /\bcash\b/i.test(nameLower)) {
      assetTypeSystemKey = "physical_cash";
    } else {
      assetTypeSystemKey = "bank_account";
    }

    const mark = resolveProviderMark(null, rawName);
    const existing = existingByNorm.get(normalizeName(rawName)) ?? null;

    accounts.push({
      rowNumber: row.rowNumber,
      displayName: rawName.slice(0, 120),
      rawBucket,
      rawType,
      rawRole,
      openingAmountMinor,
      currency: "IDR",
      assetTypeSystemKey,
      assetGroupSystemKey,
      normallyLiquid,
      normallySpendable,
      inferredProviderName: mark.inferredProviderName,
      note: rawNote.slice(0, 1000),
      alreadyExists: Boolean(existing),
      existingAssetId: existing?.id ?? null,
      defaultSelected: !existing,
    });
  }

  const existingAccountsCount = accounts.filter((a) => a.alreadyExists).length;
  return {
    fileName: "workbook.xlsx",
    sheetName: targetSheet ?? "Accounts",
    availableSheets: prelim.sheets,
    accounts,
    summary: {
      totalDetected: accounts.length,
      newAccountsCount: accounts.length - existingAccountsCount,
      existingAccountsCount,
    },
  };
}
