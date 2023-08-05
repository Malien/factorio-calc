import translations from "../extracted/locales/en.json"
import recipeList from "../extracted/recipe.json"
import Result, { assertError } from "./result"
import { NonEmpty, nonEmpty } from "./util"

export type Recipe = {
  name: string
  energyRequired: number
  ingredients: NonEmpty<ItemAmount>
  results: NonEmpty<ItemAmount>
  icon: string | undefined
  category: Category
}

export default function checkMembership<T extends string>(values: Iterable<T>) {
  const possibleValues = new Set(values)
  return (value: unknown): value is T => possibleValues.has(value as any)
}

const categories = [
  "crafting",
  "crafting-with-fluid",
  "smelting",
  "chemistry",
] as const
export type Category = (typeof categories)[number]
export const isKnownCategory = checkMembership(categories)

type RawRecipe = (typeof recipeList)[number]
type RawRecipeItem =
  | (string | number)[] // in fact is `[name: string, amount: number]`
  | { name: string; amount: number; type?: string }
export type ItemAmount = Item & { amount: number }
export type Item = {
  name: string
  type: "item" | "fluid"
}

const disabledRecipes = new Set([
  "electric-energy-interface",
  "loader",
  "fast-loader",
  "express-loader",
])

type ParseRecipeError =
  | ParseIngredientsError
  | ParseResultError
  | "unknown-category"

function parseRecipe(recipe: RawRecipe): Result<Recipe, ParseRecipeError> {
  const ingredients = parseIngredients(recipe)
  if (ingredients.err) return ingredients
  if (!nonEmpty(ingredients.value)) return Result.err("missing-ingredients")

  const results = parseResults(recipe)
  if (results.err) return results
  if (!nonEmpty(results.value)) return Result.err("missing-results")

  const category = parseCategory(recipe.category)
  if (category.err) return category

  return Result.ok({
    name: recipe.name,
    energyRequired: recipe.energy_required ?? 0.5,
    ingredients: ingredients.value,
    results: results.value,
    icon: recipe.icon,
    category: category.value,
  })
}

function parseCategory(
  category: string | undefined,
): Result<Category, "unknown-category"> {
  if (category === undefined) return Result.ok("crafting")
  if (isKnownCategory(category)) return Result.ok(category)
  return Result.err("unknown-category")
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
): Result<ItemAmount[], ParseIngredientsError> {
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
): Result<ItemAmount[], ParseResultError> {
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
function parseItem(item: RawRecipeItem): Result<ItemAmount, ParseItemError> {
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

function guardAndReport<T, U extends T>({
  guard,
  report,
}: {
  guard(item: T): item is U
  report(item: T): void
}) {
  return (item: T): item is U => {
    if (!guard(item)) {
      report(item)
      return false
    }
    return true
  }
}

export const recipes = recipeList[Symbol.iterator]()
  .filter(recipe => !disabledRecipes.has(recipe.name))
  .map(recipe => parseRecipe(recipe).context({ recipe }))
  .filter(
    guardAndReport({
      guard: Result.isOk,
      report(error) {
        assertError(error)
        console.warn(`Unsupported recipe definition`, error.error)
      },
    }),
  )
  .map(Result.okValue)
  .toArray()

export const recipeMap = new Map(recipes.map(r => [r.name, r] as const))

declare global {
  var recipes: Recipe[] | undefined
  var recipeMap: Map<string, Recipe> | undefined
  var rawRecipes: RawRecipe[] | undefined
}

if (import.meta.env.DEV) {
  window.recipes = recipes
  window.recipeMap = recipeMap
  window.rawRecipes = recipeList
}

export function recipeName(recipe: Recipe) {
  const primaryItem = recipe.results[0]
  const itemTranslation = primaryItem && recipeItemName(primaryItem)
  if (itemTranslation) return itemTranslation

  const translation = t(recipe.name)
  if (translation) return translation

  return recipe.name
}

export function recipeItemName({ name, amount }: ItemAmount) {
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

