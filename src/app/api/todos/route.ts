import { NextResponse } from "next/server";
import { parseBody, todoCreateSchema } from "@/lib/validators";
import { fail, isUser, readJson, requireUser } from "@/server/http";
import { createTodo, listTodos } from "@/server/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (!isUser(user)) return user;
    const projectId = new URL(request.url).searchParams.get("projectId");
    return NextResponse.json({ todos: listTodos(user.id, projectId) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!isUser(user)) return user;
    const parsed = parseBody(todoCreateSchema, await readJson(request));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    return NextResponse.json(createTodo(user.id, parsed.data), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
