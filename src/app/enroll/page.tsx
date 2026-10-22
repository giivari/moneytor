import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/auth-frame";
import { AuthPanel } from "@/components/auth-panel";
import { cookieName } from "@/lib/auth/config";

export const dynamic = "force-dynamic";
export default async function EnrollPage() {
  // Presence is only a UX hint; every enrollment operation validates its DB grant.
  if (!(await cookies()).get(cookieName("recovery"))) redirect("/unlock");
  return <AuthFrame><AuthPanel mode="enroll" /></AuthFrame>;
}
