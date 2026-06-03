import {
  KioskError,
  type FlowDefinition,
  type FlowEdge,
  type FlowNode,
} from "@tripley-acctron/contracts";

export interface CompiledFlow {
  id: string;
  startNodeId: string;
  nodes: Map<string, FlowNode>;
  edgesByFrom: Map<string, FlowEdge[]>;
}

export function compileFlow(flow: FlowDefinition): CompiledFlow {
  const nodes = new Map<string, FlowNode>();
  const ends = new Set<string>();
  let startNodeId: string | undefined;

  for (const node of flow.nodes) {
    if (nodes.has(node.id)) {
      throw compileError(flow.id, `Duplicate node id ${node.id}.`);
    }
    nodes.set(node.id, node);

    if (node.type === "start") {
      if (startNodeId) {
        throw compileError(flow.id, "Flow has multiple start nodes.");
      }
      startNodeId = node.id;
    }

    if (node.type === "end") {
      if (ends.has(node.name)) {
        throw compileError(flow.id, `Duplicate end name ${node.name}.`);
      }
      ends.add(node.name);
    }
  }

  if (!startNodeId) {
    throw compileError(flow.id, "Flow is missing a start node.");
  }

  const edgesByFrom = new Map<string, FlowEdge[]>();
  for (const edge of flow.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) {
      throw compileError(flow.id, `Edge ${edge.id} references a missing node.`);
    }
    const edges = edgesByFrom.get(edge.from) ?? [];
    edges.push(edge);
    edgesByFrom.set(edge.from, edges);
  }

  return { id: flow.id, startNodeId, nodes, edgesByFrom };
}

function compileError(flowId: string, message: string): KioskError {
  return new KioskError("flow.compile", `Flow ${flowId}: ${message}`);
}
