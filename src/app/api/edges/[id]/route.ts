import { NextResponse } from "next/server";
import { fail, isUser, requireUser } from "@/server/http";
import { deleteEdge } from "@/server/store";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    if (!isUser(user)) return user;
    const { id } = await context.params;
    deleteEdge(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
