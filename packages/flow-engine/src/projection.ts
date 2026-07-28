import type { UiPort, UiStateScope } from "@tripley-kit/web-container-ui-port";

import type { FlowProjectionPort } from "./engine-types";
import type {
  FlowInstanceSnapshot,
  UiFeedbackState,
} from "./types";

export interface FlowUiProjection {
  readonly flowId: string;
  readonly flowVersion: string;
  readonly instanceId: string;
  readonly status: FlowInstanceSnapshot["status"];
  readonly currentNodeId?: string | undefined;
  readonly resultType?: string | undefined;
  readonly reasonCode?: string | undefined;
  readonly feedback?: UiFeedbackState | undefined;
  readonly path: readonly string[];
}

export interface UiPortFlowProjectionOptions {
  readonly stateKey?: string | undefined;
  readonly scope?: Omit<UiStateScope, "flowInstanceId"> | undefined;
}

export class UiPortFlowProjectionAdapter
  implements FlowProjectionPort
{
  public constructor(
    private readonly ui: UiPort,
    private readonly options: UiPortFlowProjectionOptions = {},
  ) {}

  public publish(snapshot: FlowInstanceSnapshot): void {
    this.ui.setState(
      {
        ...this.options.scope,
        flowInstanceId: snapshot.instanceId,
      },
      this.options.stateKey ?? "flow.instance",
      toFlowUiProjection(snapshot),
    );
  }
}

export class CompositeFlowProjection implements FlowProjectionPort {
  public constructor(
    private readonly projections: readonly FlowProjectionPort[],
  ) {}

  public async publish(snapshot: FlowInstanceSnapshot): Promise<void> {
    await Promise.all(
      this.projections.map((projection) => projection.publish(snapshot)),
    );
  }
}

export function toFlowUiProjection(
  snapshot: FlowInstanceSnapshot,
): FlowUiProjection {
  const result = snapshot.result;
  return {
    currentNodeId: snapshot.currentNodeId,
    feedback: snapshot.uiFeedback.at(-1),
    flowId: snapshot.flowId,
    flowVersion: snapshot.flowVersion,
    instanceId: snapshot.instanceId,
    path: snapshot.path,
    reasonCode:
      result?.type === "cancel" ||
      result?.type === "pause" ||
      result?.type === "retry"
        ? result.reasonCode
        : undefined,
    resultType: result?.type,
    status: snapshot.status,
  };
}
