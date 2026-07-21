import type { FrameworkSqliteConnection } from "@tripley-kit/web-container-storage-core";

import type {
  HostDeliveryClock,
  HostPayloadCipherPort,
  HostPayloadVault,
} from "./contracts";
import { systemHostDeliveryClock } from "./contracts";

interface PayloadRow {
  readonly ciphertext: string;
}

export class SqliteEncryptedHostPayloadVault implements HostPayloadVault {
  public constructor(
    private readonly db: FrameworkSqliteConnection,
    private readonly cipher: HostPayloadCipherPort,
    private readonly clock: HostDeliveryClock = systemHostDeliveryClock,
  ) {}

  public async put(payloadRef: string, payload: Uint8Array): Promise<void> {
    const ciphertext = await this.cipher.encrypt(payload, { payloadRef });
    const now = this.clock.now().toISOString();
    await this.db.run(
      `INSERT INTO kiosk_host_payload (payload_ref, ciphertext, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(payload_ref) DO NOTHING`,
      [payloadRef, ciphertext, now, now],
    );
  }

  public async get(payloadRef: string): Promise<Uint8Array | undefined> {
    const row = await this.db.queryOne<PayloadRow>(
      "SELECT ciphertext FROM kiosk_host_payload WHERE payload_ref = ?",
      [payloadRef],
    );
    return row
      ? this.cipher.decrypt(row.ciphertext, { payloadRef })
      : undefined;
  }

  public async delete(payloadRef: string): Promise<void> {
    await this.db.run("DELETE FROM kiosk_host_payload WHERE payload_ref = ?", [payloadRef]);
  }
}
