import type { FinanceAsset } from "./types";
import type { CatalogRecord } from "@/lib/repositories/catalogs";

export type FinanceOptions = {
  assets: FinanceAsset[];
  currencies: { code: string; exponent: number }[];
  catalogs: {
    providers: CatalogRecord[]; paymentNetworks: CatalogRecord[]; assetTypes: CatalogRecord[];
    assetGroups: CatalogRecord[]; transactionCategories: CatalogRecord[]; chargeTypes: CatalogRecord[];
  };
};

export async function financeRequest<T>(operation: string, body: Record<string, unknown>): Promise<T> {
  return requestJson<T>(`/api/finance/${operation}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
  });
}
export async function loadFinanceOptions(): Promise<FinanceOptions> {
  return requestJson<FinanceOptions>("/api/finance/options", { cache: "no-store" });
}

export async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, init); }
  catch { throw new Error("Koneksi terputus. Periksa jaringan lalu coba lagi."); }
  let result: unknown;
  try { result = await response.json(); }
  catch { throw new Error("Respons belum dapat diproses. Coba lagi."); }
  if (!response.ok) {
    const message = result && typeof result === "object" && "error" in result && typeof result.error === "string"
      ? result.error : "Permintaan gagal. Coba lagi.";
    throw new Error(message);
  }
  return result as T;
}
