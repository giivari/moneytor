import { loadServerWorkbook } from "@/fluent-workbook/loadServerWorkbook";
import FluentWorkbookApp from "@/fluent-workbook/FluentWorkbookApp";

export const dynamic = "force-dynamic";

export default async function CreditPage() {
  const initialRawData = await loadServerWorkbook();
  return <FluentWorkbookApp initialPage="kredit" initialRawData={initialRawData} />;
}
