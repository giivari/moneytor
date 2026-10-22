import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cookieName } from "./config.ts";
import { resolveSession } from "./store.ts";

// React shares this lookup only within a Server Component request. Route handlers
// retain uncached checks; there is no cross-request/private financial cache.
export const currentOwnerSession = cache(async () => {
  return resolveSession((await cookies()).get(cookieName("session"))?.value);
});
export async function requireOwnerSession() {
  const session = await currentOwnerSession();
  if (!session) redirect("/unlock");
  return session;
}
