import "./style.css"
import recipeList from "../extracted/recipe.json"
import translations from "../extracted/locales/en.json"
import { initCanvas } from "./canvas"

type Recipe = typeof recipeList[number]
type RecipeResult =
  | [name: string, amount: number]
  | { type: string; name: string; amount: number }

const canvas = document.getElementById("canvas") as HTMLCanvasElement
const selectionDialog = document.getElementById(
  "selection-dialog"
) as HTMLDialogElement
const selectionForm = document.getElementById(
  "selection-form"
) as HTMLFormElement

initCanvas(canvas)

const recipeMap = new Map(recipeList.map(r => [r.name, r] as const))

selectionDialog.addEventListener("submit", ev => {
  const data = new FormData(ev.target as HTMLFormElement)
  const recipeName = data.get("recipeName") as string
  console.log("Selected recipe", recipeMap.get(recipeName))
})

const lookupOrder = ["item", "recipe", "fluid", "entity", "equipment"] as const

function t(key: string) {
  for (const type of lookupOrder) {
    const category = translations[type] as Record<string, string>
    if (key in category) return category[key]
  }
}

function recipeNameFromResult(name: string, amount: number = 1) {
  const translation = t(name)
  if (!translation) return

  if (amount === 1) return translation
  return `${amount}x ${translation}`
}

function recipeName(recipe: Recipe) {
  const translation = t(recipe.name)
  if (translation) return translation

  if (recipe.result) {
    return (
      recipeNameFromResult(recipe.result, recipe.result_count) ?? recipe.name
    )
  }

  if (recipe.results?.[0]) {
    const first = recipe.results[0] as RecipeResult
    if (Array.isArray(first)) {
      const [name, amount] = first
      return recipeNameFromResult(name, amount) ?? recipe.name
    }
    const { name, amount } = first
    return recipeNameFromResult(name, amount) ?? recipe.name
  }

  return recipe.name
}

function recipeButton(recipe: Recipe) {
  const button = document.createElement("button")
  button.type = "submit"
  button.name = "recipeName"
  button.value = recipe.name
  button.className = "recipe-button"
  button.innerText = recipeName(recipe)

  prepareRecipeIcon(recipe).then((url) => {
    const img = new Image()
    img.className="recipe-icon"
    img.src = url
    img.alt = recipeName(recipe)
    button.childNodes.forEach((n) => n.remove())
    button.append(img)
  }).catch(err => {
    console.error(err, recipe)
  })

  return button
}


function globIcons(...globs: Record<string, string>[]) {
  const icons = new Map<string, string>()

  for (const glob of globs) {
    for (const [fsPath, importPath] of Object.entries(glob)) {
      const prunedURL = fsPath.replace(/^..\/extracted\/graphics\/icons\//, "")
      icons.set(prunedURL, importPath)
    }
  }

  return icons
}

const icons = globIcons(
  import.meta.glob("../extracted/graphics/icons/*.png", {
    as: "url",
    eager: true,
  }),
  import.meta.glob("../extracted/graphics/icons/fluid/*.png", {
    as: "url",
    eager: true,
  }),
  import.meta.glob("../extracted/graphics/icons/fluid/barreling/empty-barrel.png", {
    as: "url",
    eager: true,
  }),
)

const manualOverrides = {
  "stone-wall": "wall",
  "empty-barrel": "fluid/barreling/empty-barrel",
  "sulfuric-acid": "fluid/sulfuric-acid",
  "lubricant": "fluid/lubricant",
  "heat-exchanger": "heat-boiler",
  "distractor-capsule": "distractor",
  "defender-capsule": "defender",
  "destroyer-capsule": "destroyer",
  "discharge-defense-remote": "discharge-defense-equipment-controller"
}

const disabledRecipes = new Set([
  "electric-energy-interface"
])

const cropCanvas = document.createElement("canvas")
cropCanvas.width = 64
cropCanvas.height = 64
const cropCtx = cropCanvas.getContext("2d", { alpha: true, desynchronized: true })!

const iconPrefix = /^__base__\/graphics\/icons\//

function iconForRecipe(recipe: Recipe) {
  if (recipe.name in manualOverrides) {
    return icons.get(manualOverrides[recipe.name as keyof typeof manualOverrides] + ".png")
  }

  if (recipe.icon) {
    if (!iconPrefix.test(recipe.icon)) throw new Error("Unsupport icon path " + recipe.icon)
    const prunedURL = recipe.icon.replace(/^__base__\/graphics\/icons\//, "")
    return icons.get(prunedURL)
  }

  return icons.get(`${recipe.name}.png`)
}

async function prepareRecipeIcon(recipe: Recipe) {
  const icon = iconForRecipe(recipe)
  if (!icon) throw new Error("Cannot find icon for recipe with name " + recipe.name)
  const image = await loadImage(icon)
  cropCtx.clearRect(0, 0, 64, 64)
  cropCtx.drawImage(image, 0, 0)
  const croppedBlob = await blobFromCanvas(cropCanvas)
  return URL.createObjectURL(croppedBlob)
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image ${src}`))
    img.src = src
  })
}

function blobFromCanvas(canvas: HTMLCanvasElement, type: string = "image/png", quality: number = 1) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error("Failed to create blob"))
    }, type, quality)
  })
}

const buttons = recipeList.filter(recipe => !disabledRecipes.has(recipe.name)).map(recipeButton)
selectionForm.append(...buttons)

selectionDialog.showModal()
