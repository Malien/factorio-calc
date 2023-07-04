import recipeList from "../extracted/recipe.json"

export type Recipe = typeof recipeList[number]
export type RecipeItem =
  | [name: string, amount: number]
  | { type: string; name: string; amount: number }
export type NormalizedRecipeItem = { name: string; amount: number; type: "item" | "fluid" }

export const recipeMap = new Map(recipeList.map(r => [r.name, r] as const))

const disabledRecipes = new Set([
  "electric-energy-interface",
  "loader",
  "fast-loader",
  "express-loader",
])

export const recipes = recipeList.filter(recipe => !disabledRecipes.has(recipe.name))

if (import.meta.env.DEV) {
  window.recipes = recipes
  window.recipeMap = recipeMap
}

