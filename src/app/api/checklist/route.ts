import { NextResponse } from "next/server";
import { checklistCreateSchema, parseBody } from "@/lib/validators";
import { fail, isUser, readJson, requireUser } from "@/server/http";
import { createChecklistItem } from "@/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!isUser(user)) return user;
    const parsed = parseBody(checklistCreateSchema, await readJson(request));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    return NextResponse.json(createChecklistItem(user.id, parsed.data), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
