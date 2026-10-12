import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import type { PublicUser } from "@/lib/types";

export const SESSION_COOKIE = "flowstate_session";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

export async function getCurrentUser(): Promise<PublicUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = db.select().from(sessions).where(eq(sessions.id, token)).get();
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    db.delete(sessions).where(eq(sessions.id, token)).run();
    return null;
  }

  const user = db.select().from(users).where(eq(users.id, session.userId)).get();
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name };
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: THIRTY_DAYS,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export { THIRTY_DAYS };
