import { Machine, machineCount, madeIn } from "./machine"
import { Recipe, recipesForResult } from "./recipe"

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
  itemName: string
  itemType: "item" | "fluid"
  requiredAmount: number
  producedByRecipes: Recipe[]
}

export type RecipeNode = RootNode | IntermediateNode | TerminalNode

export type NextNodeID = string & { readonly $tag: unique symbol }

export type RecipeGraph = {
  nodes: Map<NodeID, RecipeNode>
  edges: Map<NodeID, NodeID[]>
  nodeDepth: Map<NodeID, number>
  nodesOnLevel: number[]
}

export function emptyGraph(): RecipeGraph {
  return {
    nodes: new Map(),
    edges: new Map(),
    nodeDepth: new Map(),
    nodesOnLevel: [],
  }
}

export type Action =
  | { type: "expand"; node: NodeID }
  | { type: "collapse"; node: NodeID }

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
  for (const { name, type, amount } of rootRecipe.ingredients) {
    children.push({
      id: nextNodeID(),
      type: "terminal",
      itemName: name,
      itemType: type,
      requiredAmount: (assemblers * amount) / craftingTime,
      producedByRecipes: recipesForResult(type, name),
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
    edges: new Map([[rootNode.id, children.map(node => node.id)]]),
    nodeDepth,
    nodesOnLevel: [1, children.length],
  }
}

/** NOTE: Mutates graph parameter passed in */
export function expandNode(graph: RecipeGraph, nodeID: NodeID, recipe: Recipe) {
  const prevNode = graph.nodes.get(nodeID)
  if (!prevNode || prevNode.type !== "terminal")
    return "unsupported-node" as const

  const depth = graph.nodeDepth.get(nodeID) ?? 0

  const replacementNode: IntermediateNode = {
    id: prevNode.id,
    type: "intermediate",
    recipe,
    machine: madeIn(recipe)[0],
    desiredProduction: prevNode.requiredAmount,
  }

  const childIds: NodeID[] = []
  for (const { name, type, amount } of recipe.ingredients) {
    const child: TerminalNode = {
      id: nextNodeID(),
      type: "terminal",
      itemName: name,
      itemType: type,
      requiredAmount: prevNode.requiredAmount * amount,
      producedByRecipes: recipesForResult(type, name),
    }
    graph.nodes.set(child.id, child)
    graph.nodeDepth.set(child.id, depth + 1)
    childIds.push(child.id)
  }

  graph.nodes.set(replacementNode.id, replacementNode)
  graph.edges.set(nodeID, childIds)
  graph.nodeDepth.set(replacementNode.id, depth)
  if (depth === graph.nodesOnLevel.length - 1) {
    graph.nodesOnLevel.push(0)
  }
  graph.nodesOnLevel[depth + 1] += childIds.length
}
