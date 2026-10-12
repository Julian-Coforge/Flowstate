import { NextResponse } from "next/server";
import { loginSchema } from "@/lib/validators";
import { parseBody } from "@/lib/validators";
import { setSessionCookie } from "@/server/auth";
import { fail, readJson } from "@/server/http";
import { loginUser } from "@/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const parsed = parseBody(loginSchema, await readJson(request));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const session = loginUser(parsed.data);
    await setSessionCookie(session.token);
    return NextResponse.json({ user: session.user });
  } catch (error) {
    return fail(error);
  }
}
