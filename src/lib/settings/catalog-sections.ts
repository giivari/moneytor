import type { Catalog } from "@/lib/repositories/catalogs";

export const catalogSections: { slug: string; catalog: Catalog; title: string; description: string; summary: string; tone: string }[] = [
  { slug: "categories", catalog: "transactionCategories", title: "Kategori transaksi", description: "Kelola kategori pemasukan dan pengeluaran.", summary: "Pemasukan dan pengeluaran", tone: "blue" },
  { slug: "charges", catalog: "chargeTypes", title: "Jenis biaya tambahan", description: "Kelola biaya yang dicatat terpisah dari jumlah dasar.", summary: "Biaya yang dicatat terpisah", tone: "coral" },
  { slug: "asset-types", catalog: "assetTypes", title: "Jenis aset", description: "Kelola pilihan jenis saat mencatat aset.", summary: "Klasifikasi aset", tone: "violet" },
  { slug: "asset-groups", catalog: "assetGroups", title: "Grup aset", description: "Kelompokkan aset dalam ringkasan keuangan.", summary: "Pengelompokan aset", tone: "cyan" },
  { slug: "providers", catalog: "providers", title: "Penyedia keuangan", description: "Kelola nama lembaga atau penyedia untuk aset.", summary: "Lembaga dan penyedia", tone: "teal" },
  { slug: "networks", catalog: "paymentNetworks", title: "Jaringan kartu", description: "Kelola pilihan jaringan pembayaran kartu.", summary: "Jaringan pembayaran", tone: "amber" },
  { slug: "instrument-types", catalog: "instrumentTypes", title: "Jenis instrumen investasi", description: "Kelola jenis instrumen, termasuk pilihan kustom yang diarsipkan.", summary: "Klasifikasi instrumen investasi", tone: "violet" },
];

export function catalogSection(slug: string) {
  return catalogSections.find((item) => item.slug === slug);
}
