import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SqliteTransactionRepository,
  kioskStandardMigrations,
} from "@tripley-kit/web-container-kiosk-base";
import { NodeSqliteConnection } from "@tripley-kit/web-container-storage-sqlite/node";

import type { HostDeliveryClock, HostPayloadCipherPort } from "./contracts";
import { hostDeliveryMigration } from "./migration";

export class MutableHostClock implements HostDeliveryClock {
  public constructor(public current = new Date("2026-07-21T00:00:00.000Z")) {}
  public now(): Date { return this.current; }
  public advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

export const testCipher: HostPayloadCipherPort = {
  encrypt: async (payload, context) => Buffer
    .from(`${context.payloadRef}:${Buffer.from(payload).toString("base64")}`)
    .toString("base64"),
  decrypt: async (ciphertext, context) => {
    const decoded = Buffer.from(ciphertext, "base64").toString("utf8");
    const prefix = `${context.payloadRef}:`;
    if (!decoded.startsWith(prefix)) throw new Error("payload-context-mismatch");
    return Buffer.from(decoded.slice(prefix.length), "base64");
  },
};

export const createTestDatabase = async () => {
  const directory = await mkdtemp(join(tmpdir(), "tripley-host-delivery-"));
  const path = join(directory, "delivery.db");
  const db = new NodeSqliteConnection(path);
  let closed = false;
  for (const migration of [...kioskStandardMigrations, hostDeliveryMigration]) {
    await migration.up(db);
  }
  const transactions = new SqliteTransactionRepository(db);
  await transactions.create({ businessType: "withdrawal", id: "transaction-1" });
  return {
    db,
    path,
    close: async () => {
      if (closed) return;
      closed = true;
      await db.close();
    },
    dispose: async () => {
      if (!closed) await db.close();
      closed = true;
      await rm(directory, { force: true, recursive: true });
    },
  };
};
