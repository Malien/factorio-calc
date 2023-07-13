import { Recipe, normalizeRecipeItem, recipeIngredients } from "./recipe";

export type RootNode = {
  type: "root"
  recipe: Recipe
  desiredProduction: number
  assemblyMachineTier: AssemblerTier
}
export type AssemblerTier = 1 | 2 | 3

export type TerminalNode = {
  type: "terminal"
  itemName: string
  itemType: "item" | "fluid"
  requiredAmount: number
}

export type RecipeNode = RootNode | TerminalNode

type AdjacencyList = number[][]

export type RecipeGraph = {
  nodes: RecipeNode[]
  vertices: AdjacencyList
  nodeDepth: number[]
  nodesOnLevel: number[]
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

export function initialGraph(rootRecipe: Recipe): RecipeGraph {
  const nodes: RecipeNode[] = [{ type: "root", recipe: rootRecipe, desiredProduction: 2, assemblyMachineTier: 1 }]

  const craftingTime = rootRecipe.energy_required ?? 0.5
  const assemblers = assemblerCount(rootRecipe, 2, 1)

  for (const ingredient of recipeIngredients(rootRecipe)) {
    const { name, type, amount } = normalizeRecipeItem(ingredient)
    nodes.push({ type: "terminal", itemName: name, itemType: type, requiredAmount: assemblers * amount / craftingTime })
  }

  return {
    nodes,
    vertices: [Array(nodes.length - 1).map((_, i) => i + 1)],
    nodeDepth: [0, ...Array(nodes.length - 1).fill(1)],
    nodesOnLevel: [1, nodes.length - 1],
  }
}
