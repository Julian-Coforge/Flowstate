import { NextResponse } from "next/server";
import { parseBody, projectCreateSchema } from "@/lib/validators";
import { fail, isUser, readJson, requireUser } from "@/server/http";
import { createProject, listProjects } from "@/server/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (!isUser(user)) return user;
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return NextResponse.json({ projects: listProjects(user.id, query) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!isUser(user)) return user;
    const parsed = parseBody(projectCreateSchema, await readJson(request));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    return NextResponse.json(createProject(user.id, parsed.data), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
