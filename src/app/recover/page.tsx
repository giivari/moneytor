import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/auth-frame";
import { AuthPanel } from "@/components/auth-panel";
import { ownerState } from "@/lib/auth/store";

export const dynamic = "force-dynamic";
export default async function RecoverPage() {
  if (!(await ownerState()).initialized_at) redirect("/unlock");
  return <AuthFrame><AuthPanel mode="recover" /></AuthFrame>;
}
