import type {
  HostWireExchangeRequest,
  HostWireExchangeResult,
} from "@tripley-kit/web-container-kiosk-host-integration";

import { SerialTaskQueue, deferred, remainingTimeoutMs, withTimeout } from "./async-tools";
import { appendBytes } from "./bytes";
import type { NativeEventSubscription, NativeTcpApi, NativeTcpEvent } from "./contracts";
import type {
  PersistentHostFrameRoute,
  PersistentHostSessionLifecycleEvent,
  PersistentHostSessionPort,
  PersistentHostSessionState,
  PersistentNativeTcpHostSessionConfig,
} from "./persistent-contracts";
import { PersistentInboundCoordinator } from "./persistent-inbound";
import {
  PersistentHostLifecycleEmitter,
  type PersistentLifecycleEventInput,
} from "./persistent-lifecycle";
import {
  connectPersistentSocket,
  persistentConnectErrorCode,
  persistentDispatchErrorCode,
  persistentFailure,
  validatePersistentSessionConfig,
} from "./persistent-session-support";

interface PendingExchange {
  readonly generation: number;
  readonly request: HostWireExchangeRequest;
  readonly result: ReturnType<typeof deferred<HostWireExchangeResult>>;
}

export class PersistentNativeTcpHostSession implements PersistentHostSessionPort {
  public readonly id: string;

  private readonly exchangeQueue = new SerialTaskQueue();
  private readonly writeQueue = new SerialTaskQueue();
  private subscription?: NativeEventSubscription | undefined;
  private readonly lifecycle = new PersistentHostLifecycleEmitter();
  private readonly inbound: PersistentInboundCoordinator;
  private readonly retiredSocketIds = new Set<string>();
  private socketId?: string | undefined;
  private received: Uint8Array = new Uint8Array();
  private pending?: PendingExchange | undefined;
  private connectionPromise?: Promise<void> | undefined;
  private reconnectTimer?: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempt = 0;
  private started = false;
  private disposed = false;
  private generationValue = 0;
  private stateValue: PersistentHostSessionState = "idle";

  public constructor(
    private readonly tcp: NativeTcpApi,
    private readonly config: PersistentNativeTcpHostSessionConfig,
  ) {
    validatePersistentSessionConfig(tcp, config);
    this.id = config.id;
    this.inbound = new PersistentInboundCoordinator(tcp, config, this.writeQueue, () =>
      this.socketId ? { generation: this.generation, socketId: this.socketId } : undefined,
    );
  }

  public get generation(): number {
    return this.generationValue;
  }

  public get state(): PersistentHostSessionState {
    return this.stateValue;
  }

  public async start(): Promise<void> {
    if (this.disposed) throw new Error("host.session.disposed");
    this.started = true;
    this.subscription ??= this.tcp.onEvent((event) => this.handleEvent(event));
    if (this.socketId) return;
    await this.establishConnection(false);
  }

  public onLifecycle(
    handler: (event: PersistentHostSessionLifecycleEvent) => void,
  ): NativeEventSubscription {
    return this.lifecycle.subscribe(handler);
  }

  public exchange(request: HostWireExchangeRequest): Promise<HostWireExchangeResult> {
    return this.exchangeQueue.run(() => this.performExchange(request));
  }

  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.started = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.stateValue = "disposed";
    this.pending?.result.resolve(
      persistentFailure("unknown", "host.session.disposed-after-dispatch"),
    );
    this.pending = undefined;
    this.subscription?.unsubscribe();
    this.subscription = undefined;
    const socketId = this.socketId;
    this.socketId = undefined;
    if (socketId) {
      this.retiredSocketIds.add(socketId);
      await this.tcp.close(socketId).catch(() => undefined);
    }
    this.emit({ type: "disposed" });
    this.lifecycle.clear();
  }

  private async performExchange(request: HostWireExchangeRequest): Promise<HostWireExchangeResult> {
    if (this.disposed) return persistentFailure("notSent", "host.session.disposed");
    const deadline = Date.now() + Math.max(1, request.timeoutMs);
    let framed: Uint8Array;
    try {
      framed = this.config.frame.encode(request.payload);
    } catch {
      return persistentFailure("notSent", "host.session.request-frame-invalid");
    }
    try {
      if (!this.socketId) await this.start();
    } catch (error) {
      return persistentFailure("notSent", persistentConnectErrorCode(error));
    }
    const socketId = this.socketId;
    if (!socketId) return persistentFailure("notSent", "host.session.not-connected");
    const result = deferred<HostWireExchangeResult>();
    const pending: PendingExchange = { generation: this.generation, request, result };
    this.pending = pending;
    try {
      await this.writeQueue.run(() =>
        withTimeout(
          this.tcp.write(socketId, framed),
          remainingTimeoutMs(deadline, this.config.writeTimeoutMs),
          "host.session.write-timeout",
        ),
      );
      return await withTimeout(
        result.promise,
        remainingTimeoutMs(deadline, this.config.responseTimeoutMs),
        "host.session.response-timeout",
      );
    } catch (error) {
      const errorCode = persistentDispatchErrorCode(error);
      if (pending.generation === this.generation) this.dropConnection(errorCode, true);
      return persistentFailure("unknown", errorCode);
    } finally {
      if (this.pending === pending) this.pending = undefined;
    }
  }

  private async establishConnection(reconnecting: boolean): Promise<void> {
    if (this.socketId) return;
    if (this.connectionPromise) return this.connectionPromise;
    this.stateValue = reconnecting ? "reconnecting" : "connecting";
    this.emit({ type: "connecting" });
    const operation = this.finishConnection();
    this.connectionPromise = operation;
    try {
      await operation;
    } catch (error) {
      if (!this.disposed) {
        this.stateValue = "idle";
        this.emit({ errorCode: persistentConnectErrorCode(error), type: "disconnected" });
        this.scheduleReconnect();
      }
      throw error;
    } finally {
      if (this.connectionPromise === operation) this.connectionPromise = undefined;
    }
  }

  private async finishConnection(): Promise<void> {
    const socketId = await connectPersistentSocket(this.tcp, this.config, (lateSocket) =>
      this.retiredSocketIds.add(lateSocket),
    );
    if (this.disposed || this.retiredSocketIds.has(socketId)) {
      await this.tcp.close(socketId).catch(() => undefined);
      if (this.disposed) throw new Error("host.session.disposed");
      throw new Error("host.session.socket-id-reused");
    }
    this.socketId = socketId;
    this.generationValue += 1;
    this.reconnectAttempt = 0;
    this.received = new Uint8Array();
    this.stateValue = "connected";
    this.emit({ type: "connected" });
  }

  private handleEvent(event: NativeTcpEvent): void {
    if (!this.socketId || event.id !== this.socketId) return;
    if (event.kind === "close" || event.kind === "error") {
      this.handleDisconnect(event.kind);
      return;
    }
    if (event.kind !== "data" || !event.data) return;
    this.received = appendBytes(this.received, event.data);
    this.drainFrames();
  }

  private drainFrames(): void {
    while (this.received.length > 0) {
      const decoded = this.config.frame.decode(this.received);
      if (decoded.status === "incomplete") return;
      if (decoded.status === "invalid") {
        this.emit({ errorCode: decoded.errorCode, type: "protocol-error" });
        this.handleDisconnect("protocol-error");
        return;
      }
      if (decoded.consumedBytes <= 0 || decoded.consumedBytes > this.received.length) {
        this.emit({ errorCode: "host.session.frame-consumption-invalid", type: "protocol-error" });
        this.handleDisconnect("protocol-error");
        return;
      }
      this.received = this.received.slice(decoded.consumedBytes);
      this.routePayload(decoded.payload);
      if (!this.socketId) return;
    }
  }

  private routePayload(payload: Uint8Array): void {
    const pending = this.pending;
    let route: PersistentHostFrameRoute;
    try {
      route = this.config.routeFrame({
        payload,
        pending: pending
          ? { channel: pending.request.channel, idempotencyKey: pending.request.idempotencyKey }
          : undefined,
      });
    } catch {
      this.emit({ errorCode: "host.session.frame-router-failed", type: "protocol-error" });
      this.handleDisconnect("protocol-error");
      return;
    }
    if (route.kind === "response") {
      if (!pending || pending.generation !== this.generation) {
        this.emit({ type: "orphan-response" });
        return;
      }
      this.pending = undefined;
      pending.result.resolve({
        payload,
        responseId: route.responseId ?? `${pending.request.idempotencyKey}:response`,
        status: "response",
      });
      return;
    }
    if (route.kind === "inbound") {
      this.inbound.dispatch(
        payload,
        route.type,
        route.messageId,
        this.generation,
        (event, generation) => this.emit(event, generation),
      );
    }
  }

  private handleDisconnect(reason: "close" | "error" | "protocol-error"): void {
    const errorCode =
      reason === "protocol-error" ? "host.session.protocol-error" : `host.session.remote-${reason}`;
    this.dropConnection(errorCode, reason !== "close");
  }

  private dropConnection(errorCode: string, closeSocket: boolean): void {
    const socketId = this.socketId;
    if (!socketId) return;
    this.retiredSocketIds.add(socketId);
    this.socketId = undefined;
    this.received = new Uint8Array();
    this.stateValue = "idle";
    this.pending?.result.resolve(persistentFailure("unknown", errorCode));
    this.pending = undefined;
    this.emit({ errorCode, type: "disconnected" });
    if (closeSocket) void this.tcp.close(socketId).catch(() => undefined);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.started || this.disposed || this.socketId || this.reconnectTimer) return;
    const delayMs = Math.min(
      this.config.reconnect.maxDelayMs,
      this.config.reconnect.initialDelayMs *
        this.config.reconnect.multiplier ** this.reconnectAttempt,
    );
    this.reconnectAttempt += 1;
    this.emit({ delayMs, type: "reconnect-scheduled" });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.establishConnection(true).catch(() => undefined);
    }, delayMs);
  }

  private emit(event: PersistentLifecycleEventInput, generation = this.generation): void {
    this.lifecycle.emit(this.stateValue, generation, event);
  }
}
