import { PrismaClient } from "@prisma/client";

/**
 * Client Prisma partagé.
 *
 * En développement, le rechargement à chaud recrée le module : sans ce cache
 * global, chaque rechargement ouvrirait un nouveau pool de connexions.
 */
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const prisma = global.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}

export default prisma;
