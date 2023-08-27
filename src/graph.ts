import { Machine, machineCount, madeIn } from "./machine";
import { Item, Recipe, itemEq, recipesForResult } from "./recipe";
import Result, { Err, Ok, cause } from "./result";

export type NodeID = number & { readonly $tag: unique symbol };

export type RootNode = {
  id: NodeID;
  type: "root";
  recipe: Recipe;
  desiredProduction: number;
  machine: Machine;
};
export type AssemblerTier = 1 | 2 | 3;

export type IntermediateNode = {
  id: NodeID;
  type: "intermediate";
  recipe: Recipe;
  machine: Machine;
  desiredProduction: number;
};

export type TerminalNode = {
  id: NodeID;
  type: "terminal";
  item: Item;
  requiredAmount: number;
  producedByRecipes: Recipe[];
};

export type RecipeNode = RootNode | IntermediateNode | TerminalNode;
export type MergableNode = IntermediateNode | TerminalNode;

export type NextNodeID = string & { readonly $tag: unique symbol };

export type RecipeGraph = {
  nodes: Map<NodeID, RecipeNode>;
  downEdges: Map<NodeID, NodeID[]>;
  upEdges: Map<NodeID, NodeID[]>;
  nodeDepth: Map<NodeID, number>;
  nodesOnLevel: number[];
};

export function emptyGraph(): RecipeGraph {
  return {
    nodes: new Map(),
    downEdges: new Map(),
    upEdges: new Map(),
    nodeDepth: new Map(),
    nodesOnLevel: [],
  };
}

export type Action =
  | { type: "expand"; node: NodeID }
  | { type: "collapse"; node: NodeID }
  | { type: "merge"; node: NodeID; with: NodeID };

let nodesIssued = 0;
export function nextNodeID(): NodeID {
  return nodesIssued++ as NodeID;
}

export function initialGraph(rootRecipe: Recipe): RecipeGraph {
  const rootNode: RootNode = {
    id: nextNodeID(),
    type: "root",
    recipe: rootRecipe,
    desiredProduction: 2,
    machine: madeIn(rootRecipe)[0],
  };

  const craftingTime = rootRecipe.energyRequired;
  const assemblers = machineCount(rootRecipe, 2, rootNode.machine);

  const children: RecipeNode[] = [];
  for (const { amount, ...item } of rootRecipe.ingredients) {
    children.push({
      id: nextNodeID(),
      type: "terminal",
      item: item,
      requiredAmount: (assemblers * amount) / craftingTime,
      producedByRecipes: recipesForResult(item),
    });
  }

  const nodeDepth = new Map(children.map((node) => [node.id, 1]));
  nodeDepth.set(rootNode.id, 0);

  const nodes = new Map();
  nodes.set(rootNode.id, rootNode);
  for (const node of children) {
    nodes.set(node.id, node);
  }

  return {
    nodes,
    downEdges: new Map([[rootNode.id, children.map((node) => node.id)]]),
    upEdges: new Map(children.map((node) => [node.id, [rootNode.id]])),
    nodeDepth,
    nodesOnLevel: [1, children.length],
  };
}

type ExpandError =
  | { kind: "node-not-found"; node: NodeID }
  | { kind: "unsupported-node"; node: RecipeNode }
  | { kind: "no-recipes"; item: Item }
  | { kind: "multiple-recipes"; item: Item; recipes: Recipe[] }
  | Inconsistency;

/** NOTE: Mutates graph parameter passed in */
export function expandNode(
  graph: RecipeGraph,
  nodeID: NodeID,
): Result<void, ExpandError> {
  const prevNode = graph.nodes.get(nodeID);
  if (!prevNode) return Result.err({ kind: "node-not-found", node: nodeID });
  if (prevNode.type !== "terminal")
    return Result.err({ kind: "unsupported-node", node: prevNode });

  const recipes = recipesForResult(prevNode.item);
  if (recipes.length === 0) {
    return Result.err({ kind: "no-recipes", item: prevNode.item });
  }
  if (recipes.length !== 1) {
    return Result.err({
      kind: "multiple-recipes",
      item: prevNode.item,
      recipes,
    });
  }
  const recipe = recipes[0]!;

  const depth = graph.nodeDepth.get(nodeID) ?? 0;

  const replacementNode: IntermediateNode = {
    id: prevNode.id,
    type: "intermediate",
    recipe,
    machine: madeIn(recipe)[0],
    desiredProduction: prevNode.requiredAmount,
  };

  const childIds: NodeID[] = [];
  for (const { amount, ...item } of recipe.ingredients) {
    const child: TerminalNode = {
      id: nextNodeID(),
      type: "terminal",
      item,
      requiredAmount: prevNode.requiredAmount * amount,
      producedByRecipes: recipesForResult(item),
    };
    graph.nodes.set(child.id, child);
    graph.nodeDepth.set(child.id, depth + 1);
    childIds.push(child.id);
  }

  graph.nodes.set(replacementNode.id, replacementNode);
  graph.downEdges.set(nodeID, childIds);
  for (const childId of childIds) {
    graph.upEdges.set(childId, [nodeID]);
  }
  graph.nodeDepth.set(replacementNode.id, depth);
  if (depth === graph.nodesOnLevel.length - 1) {
    graph.nodesOnLevel.push(0);
  }
  graph.nodesOnLevel[depth + 1] += childIds.length;

  return Result.void;
}

type CollapseError =
  | "node-not-found"
  | "unsupported-node"
  | Inconsistency
  | SeverEdgeError;

export function collapseNode(
  graph: RecipeGraph,
  nodeID: NodeID,
): Result<void, CollapseError> {
  const node = graph.nodes.get(nodeID);
  if (!node) return Result.err("node-not-found");
  if (node.type !== "intermediate") return Result.err("unsupported-node");

  const downEdges = graph.downEdges.get(nodeID);
  if (!downEdges)
    return inconsistency("Missing down edges from nonterminal node", { node });

  // We don't want to modify downEdges array while iterating over it,
  // so we copy all of the edges to a new array.
  for (const childId of Array.from(downEdges)) {
    const res = severEdge(graph, nodeID, childId);
    if (res.err) return res;
  }

  const replacementNode: TerminalNode = {
    id: node.id,
    type: "terminal",
    item: node.recipe.results[0],
    requiredAmount: node.desiredProduction,
    producedByRecipes: recipesForResult(node.recipe.results[0]),
  };
  graph.nodes.set(replacementNode.id, replacementNode);
  graph.downEdges.delete(nodeID);

  return Result.void;
}

type SeverEdgeError =
  | { kind: "no-edge"; direction: "up" | "down"; from: NodeID; to: NodeID }
  | Inconsistency;

/** Works only for Directed Acyclic Graphs. Will loop forever if there is a cycle. */
function severEdge(
  graph: RecipeGraph,
  from: NodeID,
  to: NodeID,
): Result<void, SeverEdgeError> {
  console.debug("severEdge", from, to);
  const upEdges = graph.upEdges.get(to);
  if (!upEdges)
    return Result.err({ kind: "no-edge", direction: "up", from, to });
  const idxUp = upEdges.findIndex((id) => id === from);
  if (idxUp === -1)
    return Result.err({ kind: "no-edge", direction: "up", from, to });

  const downEdges = graph.downEdges.get(from);
  if (!downEdges)
    return Result.err({ kind: "no-edge", direction: "down", from, to });
  const idxDown = downEdges.findIndex((id) => id === to);
  if (idxDown === -1)
    return Result.err({ kind: "no-edge", direction: "down", from, to });

  upEdges.splice(idxUp, 1);
  downEdges.splice(idxDown, 1);

  if (upEdges.length === 0) {
    return deleteNode(graph, to);
  }

  const oldDepth = graph.nodeDepth.get(to);
  if (oldDepth === undefined)
    return inconsistency("Missing depth", { node: to });

  let newDepth = graph.nodeDepth.get(upEdges[0]!);
  if (newDepth === undefined)
    return inconsistency("Missing depth", { node: upEdges[0]! });
  for (const parentId of upEdges.slice(1)) {
    const depth = graph.nodeDepth.get(parentId);
    if (depth === undefined)
      return inconsistency("Missing depth", { node: parentId });
    newDepth = Math.max(newDepth, depth);
  }
  newDepth += 1;

  if (newDepth !== oldDepth) {
    graph.nodesOnLevel[oldDepth] -= 1;
    graph.nodesOnLevel[newDepth] += 1;
    graph.nodeDepth.set(to, newDepth);
  }

  return Result.void;
}

/** Works only for Directed Acyclic Graphs. Will loop forever if there is a cycle. */
function deleteNode(
  graph: RecipeGraph,
  node: NodeID,
): Result<void, SeverEdgeError> {
  graph.nodes.delete(node);
  const depth = graph.nodeDepth.get(node);
  if (depth === undefined) return inconsistency("Missing depth", { node });
  graph.nodesOnLevel[depth] -= 1;
  graph.nodeDepth.delete(node);
  graph.upEdges.delete(node);

  const downEdges = graph.downEdges.get(node);
  if (!downEdges) return Result.void;

  for (const childId of downEdges) {
    const res = severEdge(graph, node, childId);
    if (res.err) return res;
  }

  return Result.void;
}

function nodeMergeItem(node: MergableNode): Item;
function nodeMergeItem(node: RecipeNode): Item | undefined;
function nodeMergeItem(node: RecipeNode) {
  switch (node.type) {
    case "root":
      return undefined;
    case "intermediate":
      return node.recipe.results[0];
    case "terminal":
      return node.item;
  }
}

export function canMerge(a: MergableNode, b: MergableNode): true;
export function canMerge(a: RootNode, b: RecipeNode): false;
export function canMerge(a: RecipeNode, b: RootNode): false;
export function canMerge(a: RecipeNode, b: RecipeNode): boolean;
export function canMerge(a: RecipeNode, b: RecipeNode) {
  const aItem = nodeMergeItem(a);
  const bItem = nodeMergeItem(b);
  if (!aItem || !bItem) return false;
  return itemEq(aItem, bItem);
}

type MergeError =
  | { kind: "node-not-found"; node: NodeID }
  | "incompatible-node-items"
  | { kind: "incompatible-node-types"; left: RecipeNode; right: RecipeNode }
  | {
      kind: "merging-downstream";
      left: MergableNode;
      right: MergableNode;
      [cause]: MergeError;
    }
  | Inconsistency;

/** Mutates graph passed in */
export function mergeNodes(
  graph: RecipeGraph,
  node: NodeID,
  withNode: NodeID,
): Result<void, MergeError> {
  const a = graph.nodes.get(node);
  if (!a) return Result.err({ kind: "node-not-found", node });
  const b = graph.nodes.get(withNode);
  if (!b) return Result.err({ kind: "node-not-found", node: withNode });

  if (a.type === "root" || b.type === "root") {
    return Result.err({ kind: "incompatible-node-types", left: a, right: b });
  }

  return mergeNodesInner(graph, a, b);
}

function mergeNodesInner(
  graph: RecipeGraph,
  node: MergableNode,
  withNode: MergableNode,
): Result<void, MergeError> {
  if (node.type === "terminal" && withNode.type === "terminal") {
    return mergeTerminals(graph, node, withNode);
  } else if (node.type === "intermediate" && withNode.type === "intermediate") {
    return mergeIntermediates(graph, node, withNode);
  } else if (node.type === "intermediate" && withNode.type === "terminal") {
    return Result.err({
      kind: "incompatible-node-types",
      left: node,
      right: withNode,
    });
  } else if (node.type === "terminal" && withNode.type === "intermediate") {
    return Result.err({
      kind: "incompatible-node-types",
      left: node,
      right: withNode,
    });
  }
  throw new Error("Unreachable");
}

function mergeIntermediates(
  graph: RecipeGraph,
  node: IntermediateNode,
  withNode: IntermediateNode,
) {
  if (!itemEq(node.recipe.results[0], withNode.recipe.results[0]))
    return Result.err("incompatible-node-items");

  const res = mergeDepths({
    graph,
    node: node.id,
    with: withNode.id,
    into: node.id,
  });
  if (res.err) return res;

  const replacementNode: IntermediateNode = {
    id: node.id,
    type: "intermediate",
    recipe: node.recipe,
    machine: node.machine,
    desiredProduction: node.desiredProduction + withNode.desiredProduction,
  };

  graph.nodes.set(replacementNode.id, replacementNode);
  graph.nodes.delete(withNode.id);

  const targetDownEdges = graph.downEdges.get(node.id) ?? [];
  const fromDownEdges = graph.downEdges.get(withNode.id) ?? [];

  const replacementUpEdges = graph.upEdges.get(node.id);
  if (!replacementUpEdges) {
    return inconsistency(
      "While merging intermediates, found node with no up edges",
      { node: node.id },
    );
  }

  const res2 = iterate(upnodes(graph, withNode.id), (upnode) => {
    const downEdges = graph.downEdges.get(upnode.id);
    if (!downEdges) {
      return inconsistency(
        "While merging intermediates, found upnode with no down edges",
        { node: upnode.id, upedgeFrom: withNode.id },
      );
    }
    const oldEdge = downEdges.findIndex((id) => id === withNode.id);
    if (oldEdge === -1) {
      return inconsistency(
        "While merging intermediates, found upnode with no edge to withNode",
        { node: upnode.id, upedgeFrom: withNode.id },
      );
    }
    downEdges[oldEdge] = replacementNode.id;
    replacementUpEdges.push(upnode.id);
  });
  if (res2.err) return res2;

  const res3 = iterate(downnodes(graph, withNode.id), (downnode) => {
    const upEdges = graph.upEdges.get(downnode.id);
    if (!upEdges) {
      return inconsistency(
        "While merging intermediates, found downnode with no up edges",
        { node: downnode.id, upedgeFrom: withNode.id },
      );
    }
    const oldEdge = upEdges.findIndex((id) => id === withNode.id);
    if (oldEdge === -1) {
      return inconsistency(
        "While merging intermediates, found downnode with no edge to withNode",
        { node: downnode.id, upedgeFrom: withNode.id },
      );
    }
    upEdges.splice(oldEdge, 1);
  });
  if (res3.err) return res3;

  graph.upEdges.delete(withNode.id);
  graph.downEdges.delete(withNode.id);

  return iterate(
    zipDownstreamNodes(graph, targetDownEdges, fromDownEdges),
    ([left, right]) =>
      mergeNodesInner(graph, left, right).context({
        kind: "merging-downstream",
        left,
        right,
      }),
  );
}

function* zipDownstreamNodes(
  graph: RecipeGraph,
  left: Iterable<NodeID>,
  right: Iterable<NodeID>,
): Generator<[MergableNode, MergableNode], Result<void, Inconsistency>> {
  const rightNodes: RecipeNode[] = [];
  for (const childId of right) {
    const node = graph.nodes.get(childId);
    if (!node) {
      return inconsistency(
        "While merging intermediates, found edge to non-existent node",
        { from: node, to: childId },
      );
    }
    rightNodes.push(node);
  }

  for (const childId of left) {
    const node = graph.nodes.get(childId);
    if (!node) {
      return inconsistency(
        "While merging intermediates, found edge to non-existent node",
        { from: node, to: childId },
      );
    }
    if (node.type === "root") {
      return inconsistency(
        "While merging intermediates, found edge to root node",
        { from: node, to: childId },
      );
    }
    const rightNode = rightNodes.find(
      (rightNode): rightNode is MergableNode => {
        if (rightNode.type === "root") return false;
        return itemEq(nodeMergeItem(node), nodeMergeItem(rightNode));
      },
    );
    if (!rightNode) {
      return inconsistency(
        "While merging intermediates, found intermediates with different recipe items",
        { left: node, rightNodes: rightNodes },
      );
    }
    yield [node, rightNode];
  }

  return Result.void;
}

function mergeTerminals(
  graph: RecipeGraph,
  node: TerminalNode,
  withNode: TerminalNode,
) {
  if (!itemEq(node.item, withNode.item)) {
    return Result.err("incompatible-node-items");
  }

  const replacementNode: TerminalNode = {
    id: node.id,
    type: "terminal",
    item: node.item,
    requiredAmount: node.requiredAmount + withNode.requiredAmount,
    producedByRecipes: node.producedByRecipes,
  };

  const res = mergeDepths({
    graph,
    node: node.id,
    with: withNode.id,
    into: replacementNode.id,
  });
  if (res.err) return res;

  graph.nodes.set(replacementNode.id, replacementNode);
  graph.nodes.delete(withNode.id);

  const replacementUpEdges = graph.upEdges.get(replacementNode.id);
  if (!replacementUpEdges) {
    return inconsistency(
      "While merging intermediates, found node with no up edges",
      { node: replacementNode.id },
    );
  }

  const res2 = iterate(upnodes(graph, withNode.id), (upnode) => {
    const downEdges = graph.downEdges.get(upnode.id);
    if (!downEdges) {
      return inconsistency(
        "While merging intermediates, found upnode with no down edges",
        { node: upnode.id, upedgeFrom: withNode.id },
      );
    }
    const oldEdge = downEdges.findIndex((id) => id === withNode.id);
    if (oldEdge === -1) {
      return inconsistency(
        "While merging intermediates, found upnode with no edge to withNode",
        { node: upnode.id, upedgeFrom: withNode.id },
      );
    }
    downEdges[oldEdge] = replacementNode.id;
    replacementUpEdges.push(upnode.id);
  });
  if (res2.err) return res2;

  graph.upEdges.delete(withNode.id);
  graph.downEdges.delete(withNode.id);

  return Result.void;
}

type MergeDeptsParams = {
  graph: RecipeGraph;
  node: NodeID;
  with: NodeID;
  into?: NodeID;
};

function mergeDepths({
  graph,
  node,
  with: withNode,
  into = node,
}: MergeDeptsParams) {
  const aDepth = graph.nodeDepth.get(node);
  if (aDepth === undefined) return inconsistency("Missing depth", { node });
  const bDepth = graph.nodeDepth.get(withNode);
  if (bDepth === undefined)
    return inconsistency("Missing depth", { node: withNode });
  const depth = Math.max(aDepth, bDepth);

  if (into !== node) graph.nodeDepth.delete(node);
  graph.nodeDepth.delete(withNode);
  graph.nodeDepth.set(into, depth);
  graph.nodesOnLevel[bDepth] -= 1;
  graph.nodesOnLevel[aDepth] -= 1;
  graph.nodesOnLevel[depth] += 1;

  return Result.void;
}

function* upnodes(
  graph: RecipeGraph,
  node: NodeID,
): Generator<RecipeNode, Result<void, Inconsistency>> {
  const edges = graph.upEdges.get(node);
  if (!edges) return Result.void;
  for (const parentId of edges) {
    const node = graph.nodes.get(parentId);
    if (!node) {
      return inconsistency(
        "While traversing upnodes, found edge to non-existent node",
        { from: node, to: parentId },
      );
    }
    yield node;
  }
  return Result.void;
}

function* downnodes(
  graph: RecipeGraph,
  node: NodeID,
): Generator<RecipeNode, Result<void, Inconsistency>> {
  const edges = graph.downEdges.get(node);
  if (!edges) return Result.void;
  for (const childId of edges) {
    const node = graph.nodes.get(childId);
    if (!node) {
      return inconsistency(
        "While traversing downnodes, found edge to non-existent node",
        { from: node, to: childId },
      );
    }
    yield node;
  }
  return Result.void;
}

function* traverseInDepth(graph: RecipeGraph, startNode: NodeID) {
  const startingDownEdges = graph.downEdges.get(startNode);
  if (!startingDownEdges) return;

  const stack = Array.from(startingDownEdges);
  const visited = new Set<NodeID>();

  while (true) {
    const id = stack.pop();
    if (id === undefined) break;
    if (visited.has(id)) continue;
    visited.add(id);
    yield id;

    const downEdges = graph.downEdges.get(id);
    if (!downEdges) continue;
    for (const child of downEdges) {
      stack.push(child);
    }
  }
}

function* traverseInBreadth(graph: RecipeGraph, startNode: NodeID) {
  const startingDownEdges = graph.downEdges.get(startNode);
  if (!startingDownEdges) return;

  const queue = Array.from(startingDownEdges);
  const visited = new Set<NodeID>();

  while (true) {
    const id = queue.shift();
    if (id === undefined) break;
    if (visited.has(id)) continue;
    visited.add(id);
    yield id;

    const downEdges = graph.downEdges.get(id);
    if (!downEdges) continue;
    for (const child of downEdges) {
      queue.push(child);
    }
  }
}

export type Inconsistency = { kind: "inconsistent-graph"; reason: string };

function inconsistency(reason: string): Err<Inconsistency>;
function inconsistency<T>(reason: string, value: T): Err<Inconsistency & T>;
function inconsistency<T>(reason: string, value?: T) {
  return Result.err({ kind: "inconsistent-graph", reason, ...value });
}

class AssertionError extends Error {}
AssertionError.prototype.name = "AssertionError";

function iterate<T, GenError, GenOK, InnerError = never>(
  gen: Generator<T, Result<GenOK, GenError>>,
  callback: (value: T) => Err<InnerError> | undefined | Ok<unknown>,
): Result<GenOK, InnerError | GenError> {
  while (true) {
    const { value, done } = gen.next();
    if (done) return value;
    const res = callback(value);
    if (res && res.err) return res;
  }
}
