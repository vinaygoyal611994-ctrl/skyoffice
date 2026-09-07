import bcrypt from "bcryptjs";
import { db, usersTable, officesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { User } from "@workspace/db";

const SALT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Session-carried shape. Never trust anything beyond this from the client. */
export interface SessionUser {
  id: number;
  role: "office" | "customer" | "admin";
  /** True for seed, QA, and internal-admin accounts. Copied from users.is_internal
   *  at login time so analytics routes can skip these sessions without a DB lookup. */
  isInternal: boolean;
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()));
  return user;
}

export async function getOfficeIdForUser(
  userId: number,
): Promise<number | null> {
  const [office] = await db
    .select({ id: officesTable.id })
    .from(officesTable)
    .where(eq(officesTable.userId, userId));
  return office?.id ?? null;
}

export async function toAuthUser(user: User) {
  const officeId =
    user.role === "office" ? await getOfficeIdForUser(user.id) : null;
  return {
    id: user.id,
    role: user.role as "office" | "customer" | "admin",
    name: user.name,
    email: user.email,
    phone: user.phone ?? null,
    officeId,
    status: user.status as "active" | "suspended" | "deactivated",
    statusReason: user.statusReason ?? null,
    createdAt: user.createdAt,
  };
}
