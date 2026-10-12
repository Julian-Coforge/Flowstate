import { NextResponse } from "next/server";
import type { PublicUser } from "@/lib/types";
import { getCurrentUser } from "./auth";
import { HttpError } from "./store";

export async function requireUser(): Promise<PublicUser | NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  return user;
}

export function isUser(value: PublicUser | NextResponse): value is PublicUser {
  return !(value instanceof NextResponse);
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function fail(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(error);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}
