import { NextResponse } from "next/server";
import { db } from "@/db";
import { seedIfEmpty } from "@/db/seed";
import { users } from "@/db/schema";

export const dynamic = "force-dynamic";

export function GET() {
  seedIfEmpty();
  const row = db.select({ id: users.id }).from(users).get();
  return NextResponse.json({ ok: true, seeded: Boolean(row) });
}
