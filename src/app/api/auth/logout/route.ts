import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, clearSessionCookie } from "@/server/auth";
import { deleteSession } from "@/server/store";

export const dynamic = "force-dynamic";

export async function POST() {
  const jar = await cookies();
  deleteSession(jar.get(SESSION_COOKIE)?.value);
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
