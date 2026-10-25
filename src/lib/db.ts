import { PrismaClient } from "../generated/prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

// ═══════════════════════════════════════════════════════════════
// RCC-HIROS — Prisma client singleton
//
// DATABASE_URL is read at runtime so the same image can run against
// XAMPP (local dev) or the compose-managed MariaDB (production).
// Example: mysql://hiros:secret@db:3306/rcc_hiros
// ═══════════════════════════════════════════════════════════════

function databaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  if (!raw.startsWith("mysql://")) {
    throw new Error("DATABASE_URL must be a mysql:// connection string");
  }

  // Cap the pool without every caller having to remember the query param.
  // An explicit ?connectionLimit=... in the URL wins.
  const url = new URL(raw);
  if (!url.searchParams.has("connectionLimit")) {
    url.searchParams.set("connectionLimit", "10");
  }
  return url.toString();
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaMariaDb(databaseUrl()),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
