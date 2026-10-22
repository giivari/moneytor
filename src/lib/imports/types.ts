export type ImportSourceFormat = "csv" | "xlsx";

export type ImportColumnMapping = {
  date: string;
  kind: string;
  account: string;
  toAccount?: string;
  category?: string;
  note?: string;
  amount: string;
  fee?: string;
  status?: string;
};

export type NormalizedImportRow = {
  rowNumber: number;
  rawDate: string;
  occurredAt: string | null;
  occurredDay: string | null;
  rawKind: string;
  kind: "income" | "expense" | "transfer" | null;
  sourceAccountName: string;
  destinationAccountName: string;
  categoryName: string;
  note: string;
  rawAmount: string;
  amountMinor: string | null;
  feeMinor: string | null;
  rawStatus: string;
  nonPostedStatus: boolean;
  rowFingerprint: string;
  parseErrors: string[];
};

export type StagedPreviewRow = NormalizedImportRow & {
  resolvedSourceAssetId: string | null;
  resolvedDestinationAssetId: string | null;
  resolvedCategoryId: string | null;
  willCreateCategory: boolean;
  status: "ready" | "duplicate" | "invalid" | "skipped_status";
  duplicateReason: string | null;
  validationErrors: string[];
  defaultSelected: boolean;
};

export type ImportPreviewResult = {
  fileName: string;
  sourceFormat: ImportSourceFormat;
  fileSha256: string;
  sheets: string[];
  selectedSheet: string | null;
  headerRowNumber: number;
  availableColumns: { key: string; label: string }[];
  columnMapping: ImportColumnMapping;
  uniqueAccounts: { rawName: string; suggestedAssetId: string | null }[];
  uniqueCategories: { rawName: string; kind: "income" | "expense"; suggestedCategoryId: string | null }[];
  rows: StagedPreviewRow[];
  summary: {
    totalRows: number;
    readyCount: number;
    duplicateCount: number;
    invalidCount: number;
    skippedStatusCount: number;
  };
};

export type ImportBatchSummary = {
  id: string;
  fileName: string;
  sourceFormat: ImportSourceFormat;
  sheetName: string | null;
  totalRows: number;
  importedCount: number;
  skippedCount: number;
  createdCategoriesCount: number;
  createdAt: string;
};

