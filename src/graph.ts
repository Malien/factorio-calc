import { Recipe, normalizeRecipeItem, recipeIngredients } from "./recipe"

export type NodeID = number & { readonly $tag: unique symbol }

export type RootNode = {
  id: NodeID
  type: "root"
  recipe: Recipe
  desiredProduction: number
  assemblyMachineTier: AssemblerTier
}
export type AssemblerTier = 1 | 2 | 3

export type TerminalNode = {
  id: NodeID
  type: "terminal"
  itemName: string
  itemType: "item" | "fluid"
  requiredAmount: number
}

export type RecipeNode = RootNode | TerminalNode

export type NextNodeID = string & { readonly $tag: unique symbol }

export type RecipeGraph = {
  nodes: RecipeNode[]
  vertices: Map<NodeID, NodeID[]>
  nodeDepth: Map<NodeID, number> 
  nodesOnLevel: number[]
}

export type Action = {
  type: "expand"
  node: NodeID
}

export function assemblerCount(
  recipe: Recipe,
  desiredProduction: number,
  tier: AssemblerTier,
) {
  const craftingTime = recipe.energy_required ?? 0.5
  const resultCount = recipe.result_count ?? 1
  return (craftingTime * desiredProduction) / resultCount / tier
}

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
      assemblyMachineTier: 1,
  }

  const nodes: RecipeNode[] = [rootNode]

  const craftingTime = rootRecipe.energy_required ?? 0.5
  const assemblers = assemblerCount(rootRecipe, 2, 1)

  for (const ingredient of recipeIngredients(rootRecipe)) {
    const { name, type, amount } = normalizeRecipeItem(ingredient)
    nodes.push({
      id: nextNodeID(),
      type: "terminal",
      itemName: name,
      itemType: type,
      requiredAmount: (assemblers * amount) / craftingTime,
    })
  }

  const subnodes = nodes.slice(1)
  const nodeDepth = new Map(subnodes.map(node => [node.id, 1]))
  nodeDepth.set(rootNode.id, 0)

  return {
    nodes,
    vertices: new Map(subnodes.map(node => [rootNode.id, [node.id]])),
    nodeDepth,
    nodesOnLevel: [1, nodes.length - 1],
  }
}
