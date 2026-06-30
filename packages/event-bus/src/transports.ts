import { BasicSubscription } from "@tripley/web-container-utils";
import type { EventEnvelope, EventSubscription, EventTransport } from "./types";

export class LocalEventTransport implements EventTransport {
  public readonly id = "local";
  private readonly handlers = new Set<(envelope: EventEnvelope) => void | Promise<void>>();

  public async publish(envelope: EventEnvelope): Promise<void> {
    await Promise.all([...this.handlers].map((handler) => handler(envelope)));
  }

  public subscribe(handler: (envelope: EventEnvelope) => void | Promise<void>): EventSubscription {
    this.handlers.add(handler);
    return new BasicSubscription(() => {
      this.handlers.delete(handler);
    });
  }

  public async dispose(): Promise<void> {
    this.handlers.clear();
  }
}

export interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  addEventListener(type: "message", handler: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", handler: (event: MessageEvent) => void): void;
}

export type BroadcastChannelFactory = (name: string) => BroadcastChannelLike;

export class BroadcastChannelTransport implements EventTransport {
  public readonly id: string;
  private readonly channel: BroadcastChannelLike;
  private readonly handlers = new Set<(envelope: EventEnvelope) => void | Promise<void>>();
  private readonly onMessage = (event: MessageEvent): void => {
    const envelope = event.data as EventEnvelope;
    for (const handler of this.handlers) {
      void handler(envelope);
    }
  };

  public constructor(
    channelName: string,
    factory: BroadcastChannelFactory = createDefaultBroadcastChannel,
  ) {
    this.id = `broadcast:${channelName}`;
    this.channel = factory(channelName);
    this.channel.addEventListener("message", this.onMessage);
  }

  public async publish(envelope: EventEnvelope): Promise<void> {
    this.channel.postMessage(envelope);
  }

  public subscribe(handler: (envelope: EventEnvelope) => void | Promise<void>): EventSubscription {
    this.handlers.add(handler);
    return new BasicSubscription(() => {
      this.handlers.delete(handler);
    });
  }

  public async dispose(): Promise<void> {
    this.handlers.clear();
    this.channel.removeEventListener("message", this.onMessage);
    this.channel.close();
  }
}

export interface HostWindowTransport extends EventTransport {
  readonly id: "host-window";
}

const createDefaultBroadcastChannel = (name: string): BroadcastChannelLike => {
  if (typeof BroadcastChannel === "undefined") {
    throw new Error("BroadcastChannel is not available in this runtime.");
  }

  return new BroadcastChannel(name);
};
