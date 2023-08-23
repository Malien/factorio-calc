import { Machine, machineCount, madeIn } from "./machine"
import { Item, Recipe, itemEq, recipesForResult } from "./recipe"
import Result, { Err } from "./result"

export type NodeID = number & { readonly $tag: unique symbol }

export type RootNode = {
  id: NodeID
  type: "root"
  recipe: Recipe
  desiredProduction: number
  machine: Machine
}
export type AssemblerTier = 1 | 2 | 3

export type IntermediateNode = {
  id: NodeID
  type: "intermediate"
  recipe: Recipe
  machine: Machine
  desiredProduction: number
}

export type TerminalNode = {
  id: NodeID
  type: "terminal"
  item: Item
  requiredAmount: number
  producedByRecipes: Recipe[]
}

export type RecipeNode = RootNode | IntermediateNode | TerminalNode

export type NextNodeID = string & { readonly $tag: unique symbol }

export type RecipeGraph = {
  nodes: Map<NodeID, RecipeNode>
  downEdges: Map<NodeID, NodeID[]>
  upEdges: Map<NodeID, NodeID[]>
  nodeDepth: Map<NodeID, number>
  nodesOnLevel: number[]
}

export function emptyGraph(): RecipeGraph {
  return {
    nodes: new Map(),
    downEdges: new Map(),
    upEdges: new Map(),
    nodeDepth: new Map(),
    nodesOnLevel: [],
  }
}

export type Action =
  | { type: "expand"; node: NodeID }
  | { type: "collapse"; node: NodeID }
  | { type: "merge"; node: NodeID; with: NodeID }

let nodesIssued = 0
export function nextNodeID(): NodeID {
  return nodesIssued++ as NodeID
}

export function initialGraph(rootRecipe: Recipe): RecipeGraph {
  const rootNode: RootNode = {
    id: nextNodeID(),
    type: "root",
    recipe: rootRecipe,
    desiredProduction: 2,
    machine: madeIn(rootRecipe)[0],
  }

  const craftingTime = rootRecipe.energyRequired
  const assemblers = machineCount(rootRecipe, 2, rootNode.machine)

  const children: RecipeNode[] = []
  for (const { amount, ...item } of rootRecipe.ingredients) {
    children.push({
      id: nextNodeID(),
      type: "terminal",
      item: item,
      requiredAmount: (assemblers * amount) / craftingTime,
      producedByRecipes: recipesForResult(item),
    })
  }

  const nodeDepth = new Map(children.map(node => [node.id, 1]))
  nodeDepth.set(rootNode.id, 0)

  const nodes = new Map()
  nodes.set(rootNode.id, rootNode)
  for (const node of children) {
    nodes.set(node.id, node)
  }

  return {
    nodes,
    downEdges: new Map([[rootNode.id, children.map(node => node.id)]]),
    upEdges: new Map(children.map(node => [node.id, [rootNode.id]])),
    nodeDepth,
    nodesOnLevel: [1, children.length],
  }
}

/** NOTE: Mutates graph parameter passed in */
export function expandNode(graph: RecipeGraph, nodeID: NodeID) {
  const prevNode = graph.nodes.get(nodeID)
  if (!prevNode) return Result.err("node-not-found")
  if (prevNode.type !== "terminal") return Result.err("unsupported-node")

  const recipes = recipesForResult(prevNode.item)
  if (recipes.length === 0) return Result.err("no-recipes")
  if (recipes.length !== 1) return Result.err("multiple-recipes")
  const recipe = recipes[0]!

  const depth = graph.nodeDepth.get(nodeID) ?? 0

  const replacementNode: IntermediateNode = {
    id: prevNode.id,
    type: "intermediate",
    recipe,
    machine: madeIn(recipe)[0],
    desiredProduction: prevNode.requiredAmount,
  }

  const childIds: NodeID[] = []
  for (const { amount, ...item } of recipe.ingredients) {
    const child: TerminalNode = {
      id: nextNodeID(),
      type: "terminal",
      item,
      requiredAmount: prevNode.requiredAmount * amount,
      producedByRecipes: recipesForResult(item),
    }
    graph.nodes.set(child.id, child)
    graph.nodeDepth.set(child.id, depth + 1)
    childIds.push(child.id)
  }

  graph.nodes.set(replacementNode.id, replacementNode)
  graph.downEdges.set(nodeID, childIds)
  for (const childId of childIds) {
    graph.upEdges.set(childId, [nodeID])
  }
  graph.nodeDepth.set(replacementNode.id, depth)
  if (depth === graph.nodesOnLevel.length - 1) {
    graph.nodesOnLevel.push(0)
  }
  graph.nodesOnLevel[depth + 1] += childIds.length

  return Result.void
}

type CollapseError =
  | "node-not-found"
  | "unsupported-node"
  | Inconsistency
  | SeverEdgeError

export function collapseNode(
  graph: RecipeGraph,
  nodeID: NodeID,
): Result<void, CollapseError> {
  const node = graph.nodes.get(nodeID)
  if (!node) return Result.err("node-not-found")
  if (node.type !== "intermediate") return Result.err("unsupported-node")

  const downEdges = graph.downEdges.get(nodeID)
  if (!downEdges) return inconsistency("Missing down edges from nonterminal node", { node })

  // We don't want to modify downEdges array while iterating over it,
  // so we copy all of the edges to a new array.
  for (const childId of Array.from(downEdges)) {
    const res = severEdge(graph, nodeID, childId)
    if (res.err) return res
  }

  const replacementNode: TerminalNode = {
    id: node.id,
    type: "terminal",
    item: node.recipe.results[0],
    requiredAmount: node.desiredProduction,
    producedByRecipes: recipesForResult(node.recipe.results[0]),
  }
  graph.nodes.set(replacementNode.id, replacementNode)
  graph.downEdges.delete(nodeID)

  return Result.void
}

type SeverEdgeError =
  | { kind: "no-edge", direction: "up" | "down", from: NodeID, to: NodeID }
  | Inconsistency

/** Works only for Directed Acyclic Graphs. Will loop forever if there is a cycle. */
function severEdge(graph: RecipeGraph, from: NodeID, to: NodeID): Result<void, SeverEdgeError> {
  console.debug("severEdge", from, to)
  const upEdges = graph.upEdges.get(to)
  if (!upEdges) return Result.err({ kind: "no-edge", direction: "up", from, to })
  const idxUp = upEdges.findIndex(id => id === from)
  if (idxUp === -1) return Result.err({ kind: "no-edge", direction: "up", from, to })

  const downEdges = graph.downEdges.get(from)
  if (!downEdges) return Result.err({ kind: "no-edge", direction: "down", from, to })
  const idxDown = downEdges.findIndex(id => id === to)
  if (idxDown === -1) return Result.err({ kind: "no-edge", direction: "down", from, to })

  upEdges.splice(idxUp, 1)
  downEdges.splice(idxDown, 1)

  if (upEdges.length === 0) {
    return deleteNode(graph, to)
  }

  const oldDepth = graph.nodeDepth.get(to)
  if (oldDepth === undefined) return inconsistency("Missing depth", { node: to })

  let newDepth = graph.nodeDepth.get(upEdges[0]!)
  if (newDepth === undefined) return inconsistency("Missing depth", { node: upEdges[0]! })
  for (const parentId of upEdges.slice(1)) {
    const depth = graph.nodeDepth.get(parentId)
    if (depth === undefined) return inconsistency("Missing depth", { node: parentId })
    newDepth = Math.max(newDepth, depth)
  }
  newDepth += 1

  if (newDepth !== oldDepth) {
    graph.nodesOnLevel[oldDepth] -= 1
    graph.nodesOnLevel[newDepth] += 1
    graph.nodeDepth.set(to, newDepth)
  }

  return Result.void
}

/** Works only for Directed Acyclic Graphs. Will loop forever if there is a cycle. */
function deleteNode(graph: RecipeGraph, node: NodeID): Result<void, SeverEdgeError> {
  console.debug("deleteNode", node)
  graph.nodes.delete(node)
  const depth = graph.nodeDepth.get(node)
  if (depth === undefined) return inconsistency("Missing depth", { node })
  graph.nodesOnLevel[depth] -= 1
  graph.nodeDepth.delete(node)
  graph.upEdges.delete(node)

  const downEdges = graph.downEdges.get(node)
  if (!downEdges) return Result.void

  for (const childId of downEdges) {
    const res = severEdge(graph, node, childId)
    if (res.err) return res
  }

  return Result.void
}

function nodeMergeItem(node: IntermediateNode | TerminalNode): Item
function nodeMergeItem(node: RecipeNode): Item | undefined
function nodeMergeItem(node: RecipeNode) {
  switch (node.type) {
    case "root":
      return undefined
    case "intermediate":
      return node.recipe.results[0]
    case "terminal":
      return node.item
  }
}

export function canMerge(a: RecipeNode, b: RecipeNode) {
  const aItem = nodeMergeItem(a)
  const bItem = nodeMergeItem(b)
  if (!aItem || !bItem) return false
  return itemEq(aItem, bItem)
}

type MergeError =
  | { kind: "node-not-found"; node: NodeID }
  | "incompatible-node-items"
  | "incompatible-node-types"
  | Inconsistency

/** Mutates graph passed in */
export function mergeNodes(
  graph: RecipeGraph,
  node: NodeID,
  withNode: NodeID,
): Result<void, MergeError> {
  const a = graph.nodes.get(node)
  if (!a) return Result.err({ kind: "node-not-found", node })
  const b = graph.nodes.get(withNode)
  if (!b) return Result.err({ kind: "node-not-found", node: withNode })

  if (a.type === "terminal" && b.type === "terminal") {
    return mergeTerminals(graph, a, b)
  } else {
    return Result.err("incompatible-node-types")
  }
}

function mergeTerminals(
  graph: RecipeGraph,
  node: TerminalNode,
  withNode: TerminalNode,
) {
  const aDepth = graph.nodeDepth.get(node.id)
  if (aDepth === undefined)
    return inconsistency("Missing depth", { node: node.id })
  const bDepth = graph.nodeDepth.get(withNode.id)
  if (bDepth === undefined)
    return inconsistency("Missing depth", { node: withNode.id })
  const depth = Math.max(aDepth, bDepth)

  if (!itemEq(node.item, withNode.item))
    return Result.err("incompatible-node-items")

  const replacementNode: TerminalNode = {
    id: node.id,
    type: "terminal",
    item: node.item,
    requiredAmount: node.requiredAmount + withNode.requiredAmount,
    producedByRecipes: node.producedByRecipes,
  }

  graph.nodes.set(replacementNode.id, replacementNode)
  graph.nodes.delete(withNode.id)
  graph.nodeDepth.set(replacementNode.id, depth)
  graph.nodeDepth.delete(withNode.id)
  graph.nodesOnLevel[bDepth] -= 1
  graph.nodesOnLevel[aDepth] -= 1
  graph.nodesOnLevel[depth] += 1

  const replacementUpEdges = graph.upEdges.get(node.id)
  if (!replacementUpEdges) {
    return inconsistency(
      "While merging terminals, found node with no up edges",
      { node: node.id },
    )
  }

  for (const upnode of upnodes(graph, withNode.id)) {
    if (upnode.err) return upnode
    const downEdges = graph.downEdges.get(upnode.value.id)
    if (!downEdges) {
      return inconsistency(
        "While merging terminals, found upnode with no down edges",
        { node: upnode.value.id, upedgeFrom: withNode.id },
      )
    }
    const oldEdge = downEdges.findIndex(id => id === withNode.id)
    if (oldEdge === -1) {
      return inconsistency(
        "While merging terminals, found upnode with no edge to withNode",
        { node: upnode.value.id, upedgeFrom: withNode.id },
      )
    }
    downEdges[oldEdge] = node.id
    replacementUpEdges.push(upnode.value.id)
  }

  return Result.void
}

function* upnodes(graph: RecipeGraph, node: NodeID) {
  const edges = graph.upEdges.get(node)
  if (!edges) return
  for (const parentId of edges) {
    const node = graph.nodes.get(parentId)
    if (!node) {
      yield inconsistency(
        "While traversing upnodes, found edge to non-existent node",
        { from: node, to: parentId },
      )
    } else yield Result.ok(node)
  }
}

function* downnodes(graph: RecipeGraph, node: NodeID) {
  const edges = graph.downEdges.get(node)
  if (!edges) return
  for (const childId of edges) {
    const node = graph.nodes.get(childId)
    if (!node) {
      yield inconsistency(
        "While traversing downnodes, found edge to non-existent node",
        { from: node, to: childId },
      )
    } else yield Result.ok(node)
  }
}

function* traverseInDepth(graph: RecipeGraph, startNode: NodeID) {
  const startingDownEdges = graph.downEdges.get(startNode)
  if (!startingDownEdges) return

  const stack = Array.from(startingDownEdges)
  const visited = new Set<NodeID>()

  while (true) {
    const id = stack.pop()
    if (id === undefined) break
    if (visited.has(id)) continue
    visited.add(id)
    yield id

    const downEdges = graph.downEdges.get(id)
    if (!downEdges) continue
    for (const child of downEdges) {
      stack.push(child)
    }
  }
}

function* traverseInBreadth(graph: RecipeGraph, startNode: NodeID) {
  const startingDownEdges = graph.downEdges.get(startNode)
  if (!startingDownEdges) return

  const queue = Array.from(startingDownEdges)
  const visited = new Set<NodeID>()

  while (true) {
    const id = queue.shift()
    if (id === undefined) break
    if (visited.has(id)) continue
    visited.add(id)
    yield id

    const downEdges = graph.downEdges.get(id)
    if (!downEdges) continue
    for (const child of downEdges) {
      queue.push(child)
    }
  }
}

type Inconsistency = { kind: "inconsistent-graph"; reason: string }

function inconsistency(
  reason: string,
): Err<Inconsistency>
function inconsistency<T>(
  reason: string,
  value: T,
): Err<Inconsistency & T>
function inconsistency<T>(reason: string, value?: T) {
  return Result.err({ kind: "inconsistent-graph", reason, ...value })
}
