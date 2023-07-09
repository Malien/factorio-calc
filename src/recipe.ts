import translations from "../extracted/locales/en.json"
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

export function recipeName(recipe: Recipe) {
  const primaryItem = primaryRecipeItem(recipe)
  const itemTranslation = primaryItem && recipeItemName(primaryItem)
  if (itemTranslation) return itemTranslation

  const translation = t(recipe.name)
  if (translation) return translation

  return recipe.name
}

export function primaryRecipeItem(recipe: Recipe) {
  if (recipe.main_product === "") return
  if (recipe.result) {
    return { type: "item", name: recipe.result, amount: recipe.result_count ?? 1 } as const
  }
  if (recipe.results?.length === 1) {
    const firstResult = recipe.results[0] as RecipeItem
    return normalizeRecipeItem(firstResult)
  }
}

export function recipeItemName({ name, amount }: NormalizedRecipeItem)  {
  const translation = t(name)
  if (!translation) return

  if (amount === 1) return translation
  return `${amount} x ${translation}`
}

const lookupOrder = ["item", "recipe", "fluid", "entity", "equipment"] as const
export function t(key: string) {
  for (const type of lookupOrder) {
    const category = translations[type] as Record<string, string>
    if (key in category) return category[key]
  }
}

export function normalizeRecipeItem(item: RecipeItem) {
  if (Array.isArray(item)) {
    const [name, amount] = item
    return { type: "item", name, amount } as const
  }
  if (item.type !== "fluid" && item.type !== "item")
    throw new Error("Unsupported item type " + item.type)
  return item as NormalizedRecipeItem
}
