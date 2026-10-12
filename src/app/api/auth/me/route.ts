import { NextResponse } from "next/server";
import { fail, isUser, requireUser } from "@/server/http";
import { getCurrentUser } from "@/server/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    if (!isUser(user)) return user;
    const current = await getCurrentUser();
    return NextResponse.json({ user: current });
  } catch (error) {
    return fail(error);
  }
}
