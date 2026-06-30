import { FrameworkError } from "@tripley/web-container-errors";

import type {
  FlowDefinition,
  FlowNodeDefinition,
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
