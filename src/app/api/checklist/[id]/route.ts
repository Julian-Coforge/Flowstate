import { NextResponse } from "next/server";
import { checklistPatchSchema, parseBody } from "@/lib/validators";
import { fail, isUser, readJson, requireUser } from "@/server/http";
import { deleteChecklistItem, updateChecklistItem } from "@/server/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await requireUser();
    if (!isUser(user)) return user;
    const parsed = parseBody(checklistPatchSchema, await readJson(request));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { id } = await context.params;
    return NextResponse.json(updateChecklistItem(user.id, id, parsed.data));
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    if (!isUser(user)) return user;
    const { id } = await context.params;
    deleteChecklistItem(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
