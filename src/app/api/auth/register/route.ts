import { NextResponse } from "next/server";
import { parseBody, registerSchema } from "@/lib/validators";
import { setSessionCookie } from "@/server/auth";
import { fail, readJson } from "@/server/http";
import { registerUser } from "@/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const parsed = parseBody(registerSchema, await readJson(request));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const session = registerUser(parsed.data);
    await setSessionCookie(session.token);
    return NextResponse.json({ user: session.user });
  } catch (error) {
    return fail(error);
  }
}
