import translations from "../extracted/locales/en.json"
import recipeList from "../extracted/recipe.json"
import Result from "./result"

export type Recipe = {
  name: string
  energyRequired: number
  ingredients: NonEmpty<RecipeItem>
  results: NonEmpty<RecipeItem>
  icon: string | undefined
}

type RawRecipe = (typeof recipeList)[number]
type RawRecipeItem =
  | (string | number)[] // in fact is `[name: string, amount: number]`
  | { name: string; amount: number; type?: string }
export type RecipeItem = {
  name: string
  amount: number
  type: "item" | "fluid"
}

const disabledRecipes = new Set([
  "electric-energy-interface",
  "loader",
  "fast-loader",
  "express-loader",
])

type NonEmpty<T> = [T, ...T[]]
function nonEmpty<T>(arr: T[]): arr is NonEmpty<T> {
  return arr.length > 0
}

type ParseRecipeError = ParseIngredientsError | ParseResultError

function parseRecipe(recipe: RawRecipe): Result<Recipe, ParseRecipeError> {
  const ingredients = parseIngredients(recipe)
  if (ingredients.err) return ingredients
  if (!nonEmpty(ingredients.value)) return Result.err("missing-ingredients")

  const results = parseResults(recipe)
  if (results.err) return results
  if (!nonEmpty(results.value)) return Result.err("missing-results")

  return Result.ok({
    name: recipe.name,
    energyRequired: recipe.energy_required ?? 0.5,
    ingredients: ingredients.value,
    results: results.value,
    icon: recipe.icon,
  })
}

type ParseIngredientsError =
  | "missing-ingredients"
  | {
      type: "invalid-ingredient"
      index: number
      item: RawRecipeItem
      error: ParseItemError
    }

function parseIngredients(
  recipe: RawRecipe,
): Result<RecipeItem[], ParseIngredientsError> {
  const rawIngredients = recipe.ingredients ?? recipe.normal.ingredients
  if (!rawIngredients) return Result.err("missing-ingredients")

  return Result.collectArray(
    rawIngredients.map((ingredient, index) =>
      parseItem(ingredient).mapErr(error => ({
        type: "invalid-ingredient",
        index,
        item: ingredient,
        error,
      })),
    ),
  )
}

type ParseResultError =
  | "missing-results"
  | {
      type: "invalid-result"
      index: number
      item: RawRecipeItem
      error: ParseItemError
    }

function parseResults(
  recipe: RawRecipe,
): Result<RecipeItem[], ParseResultError> {
  if (recipe.result) {
    return Result.ok([
      { name: recipe.result, amount: recipe.result_count ?? 1, type: "item" },
    ])
  }

  if (recipe.normal) {
    return Result.ok([
      {
        name: recipe.normal.result,
        amount: recipe.normal.result_count ?? 1,
        type: "item",
      },
    ])
  }

  if (recipe.results) {
    return Result.collectArray(
      recipe.results.map((result, index) =>
        parseItem(result).mapErr(error => ({
          type: "invalid-result" as const,
          index,
          item: result,
          error,
        })),
      ),
    )
  }
  return Result.err("missing-results")
}

type ParseItemError = "invalid-name" | "invalid-type" | "invalid-amount"
function parseItem(item: RawRecipeItem): Result<RecipeItem, ParseItemError> {
  if (Array.isArray(item)) {
    const [name, amount] = item
    if (typeof name !== "string") return Result.err("invalid-name")
    if (typeof amount !== "number") return Result.err("invalid-amount")
    return Result.ok({ name, amount, type: "item" })
  }
  const { name, amount, type = "item" } = item
  if (type !== "item" && type !== "fluid") return Result.err("invalid-type")
  return Result.ok({ name, amount, type })
}

export const recipes = recipeList[Symbol.iterator]()
  .filter(recipe => !disabledRecipes.has(recipe.name))
  .map(parseRecipe)
  .filter(Result.isOk)
  .map(Result.okValue)
  .toArray()

export const recipeMap = new Map(recipes.map(r => [r.name, r] as const))

declare global {
  var recipes: Recipe[] | undefined
  var recipeMap: Map<string, Recipe> | undefined
}

if (import.meta.env.DEV) {
  window.recipes = recipes
  window.recipeMap = recipeMap
}

export function recipeName(recipe: Recipe) {
  const primaryItem = recipe.results[0]
  const itemTranslation = primaryItem && recipeItemName(primaryItem)
  if (itemTranslation) return itemTranslation

  const translation = t(recipe.name)
  if (translation) return translation

  return recipe.name
}

export function recipeItemName({ name, amount }: RecipeItem) {
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

export function recipesForResult(itemType: "item" | "fluid", itemName: string) {
  return recipes.filter(recipe =>
    recipe.results.some(
      result => result.name === itemName && result.type === itemType,
    ),
  )
}
