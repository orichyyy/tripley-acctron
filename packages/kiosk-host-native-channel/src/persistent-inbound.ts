import { type SerialTaskQueue, withTimeout } from "./async-tools";
import type { NativeTcpApi } from "./contracts";
import type {
  HostInboundMessage,
  HostInboundReplyResult,
  PersistentNativeTcpHostSessionConfig,
} from "./persistent-contracts";
import type { PersistentLifecycleEventInput } from "./persistent-lifecycle";

interface PersistentConnectionSnapshot {
  readonly generation: number;
  readonly socketId: string;
}

export class PersistentInboundCoordinator {
  public constructor(
    private readonly tcp: NativeTcpApi,
    private readonly config: PersistentNativeTcpHostSessionConfig,
    private readonly writeQueue: SerialTaskQueue,
    private readonly connection: () => PersistentConnectionSnapshot | undefined,
  ) {}

  public dispatch(
    payload: Uint8Array,
    type: string,
    messageId: string | undefined,
    generation: number,
    emit: (event: PersistentLifecycleEventInput, generation: number) => void,
  ): void {
    const message: HostInboundMessage = {
      generation,
      messageId,
      payload,
      receivedAt: Date.now(),
      type,
    };
    void this.config.inbound
      .dispatch(message, {
        respond: (response) => this.respond(response, generation),
      })
      .then((result) => {
        if (result.status === "unhandled") {
          emit({ inboundType: type, type: "inbound-unhandled" }, generation);
        } else if (result.status === "failed") {
          emit(
            { errorCode: result.errorCode, inboundType: type, type: "inbound-failed" },
            generation,
          );
        }
      })
      .catch(() =>
        emit(
          {
            errorCode: "host.session.inbound-dispatch-failed",
            inboundType: type,
            type: "inbound-failed",
          },
          generation,
        ),
      );
  }

  private async respond(payload: Uint8Array, generation: number): Promise<HostInboundReplyResult> {
    const connection = this.connection();
    if (!connection || generation !== connection.generation) {
      return { errorCode: "host.session.inbound-reply-stale", status: "notSent" };
    }
    let framed: Uint8Array;
    try {
      framed = this.config.frame.encode(payload);
    } catch {
      return { errorCode: "host.session.inbound-reply-frame-invalid", status: "notSent" };
    }
    try {
      await this.writeQueue.run(() =>
        withTimeout(
          this.tcp.write(connection.socketId, framed),
          this.config.writeTimeoutMs,
          "host.session.inbound-reply-timeout",
        ),
      );
      return { status: "sent" };
    } catch {
      return { errorCode: "host.session.inbound-reply-failed", status: "unknown" };
    }
  }
}
