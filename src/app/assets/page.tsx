import { loadServerWorkbook } from "@/fluent-workbook/loadServerWorkbook";
import FluentWorkbookApp from "@/fluent-workbook/FluentWorkbookApp";

export const dynamic = "force-dynamic";

export default async function AssetsPage() {
  const initialRawData = await loadServerWorkbook();
  return <FluentWorkbookApp initialPage="rekening" initialRawData={initialRawData} />;
}
