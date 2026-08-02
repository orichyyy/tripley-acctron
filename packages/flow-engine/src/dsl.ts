import { FrameworkError } from "@tripley-kit/web-container-errors";

import type {
  FlowDefinition,
  FlowNodeDefinition,
  SubflowContract,
  SubflowNodeDefinition,
  FlowVersionBinding,
  UserInputNodeDefinition,
} from "./types";

export const defineFlow = <Input = unknown, Output = unknown>(
  definition: FlowDefinition<Input, Output>,
): FlowDefinition<Input, Output> => {
  if (!definition.nodes[definition.startNodeId]) {
    throw new FrameworkError({
      category: "configuration",
      code: "flow.startNode.missing",
      message: `Flow start node does not exist: ${definition.startNodeId}`,
      metadata: {
        flowId: definition.id,
        flowVersion: definition.version,
        startNodeId: definition.startNodeId,
      },
    });
  }

  for (const node of Object.values(definition.nodes)) {
    if (node.id.length === 0) {
      throw new FrameworkError({
        category: "configuration",
        code: "flow.node.id.empty",
        message: "Flow node id must not be empty.",
        metadata: { flowId: definition.id, flowVersion: definition.version },
      });
    }
  }

  return definition;
};

export const defineNode = <TNode extends FlowNodeDefinition>(node: TNode): TNode => node;

export const defineUserInputNode = (node: UserInputNodeDefinition): UserInputNodeDefinition => node;

export const bindFlowVersion = (definition: FlowDefinition): FlowVersionBinding => ({
  flowId: definition.id,
  version: definition.version,
});

export const defineSubflowContract = <TInput, TOutput>(
  definition: FlowDefinition<TInput, TOutput>,
): SubflowContract<TInput, TOutput> => ({
  flowId: definition.id,
  version: definition.version,
});

export type DefineSubflowNodeOptions<TInput, TOutput> =
  Omit<SubflowNodeDefinition<TInput, TOutput>, "kind" | "subflow"> &
  Omit<SubflowNodeDefinition<TInput, TOutput>["subflow"], "flowId" | "version">;

export const defineSubflowNode = <TInput, TOutput>(
  contract: SubflowContract<TInput, TOutput>,
  options: DefineSubflowNodeOptions<TInput, TOutput>,
): SubflowNodeDefinition<TInput, TOutput> => {
  const {
    acceptOutput,
    input,
    mode,
    outputKey,
    ...node
  } = options;
  return {
    ...node,
    kind: "subflow",
    subflow: {
      acceptOutput,
      flowId: contract.flowId,
      input,
      mode,
      outputKey,
      version: contract.version,
    },
  };
};
