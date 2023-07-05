import translations from "../extracted/locales/en.json"
import {
  Recipe,
  RecipeItem,
  NormalizedRecipeItem,
  recipes,
  recipeMap,
} from "./recipe"
import { scheduleTilDeadline } from "./scheduler"
import memoize from "./memoize"

const lookupOrder = ["item", "recipe", "fluid", "entity", "equipment"] as const

function t(key: string) {
  for (const type of lookupOrder) {
    const category = translations[type] as Record<string, string>
    if (key in category) return category[key]
  }
}

function recipeItemName({ name, amount }: NormalizedRecipeItem)  {
  const translation = t(name)
  if (!translation) return

  if (amount === 1) return translation
  return `${amount} x ${translation}`
}

function primaryRecipeItem(recipe: Recipe) {
  if (recipe.main_product === "") return
  if (recipe.result) {
    return { type: "item", name: recipe.result, amount: recipe.result_count ?? 1 } as const
  }
  if (recipe.results?.length === 1) {
    const firstResult = recipe.results[0] as RecipeItem
    return normalizeRecipeItem(firstResult)
  }
}

function recipeName(recipe: Recipe) {
  const primaryItem = primaryRecipeItem(recipe)
  const itemTranslation = primaryItem && recipeItemName(primaryItem)
  if (itemTranslation) return itemTranslation

  const translation = t(recipe.name)
  if (translation) return translation

  return recipe.name
}

function recipeButton(recipe: Recipe) {
  const button = document.createElement("button")
  button.type = "submit"
  button.name = "recipeName"
  button.value = recipe.name
  button.className = "recipe-button"

  const iconName = iconNameForRecipe(recipe)
  prepareIconWithName(iconName)
    .then(url => {
      const img = new Image()
      img.className = "recipe-icon"
      img.src = url
      img.alt = recipeName(recipe)
      img.onload = () => {
        button.append(img)
        const animation = img.animate({ opacity: [0, 1] }, { duration: 600 })
        animation.onfinish = () => {
          img.style.opacity = "1"
        }
      }
      button.append(img)
    })
    .catch(err => {
      button.innerText = recipeName(recipe)
      console.error(err, recipe)
    })

  return button
}

function globIcons(...globs: Record<string, string>[]) {
  const icons = new Map<string, string>()

  for (const glob of globs) {
    for (const [fsPath, importPath] of Object.entries(glob)) {
      const prunedURL = fsPath
        .replace(/^..\/extracted\/graphics\/icons\//, "")
        .replace(/\.png$/, "")
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
  import.meta.glob(
    "../extracted/graphics/icons/fluid/barreling/empty-barrel.png",
    {
      as: "url",
      eager: true,
    }
  )
)

const manualOverrides = {
  "stone-wall": "wall",
  "empty-barrel": "fluid/barreling/empty-barrel",
  "sulfuric-acid": "fluid/sulfuric-acid",
  lubricant: "fluid/lubricant",
  "heat-exchanger": "heat-boiler",
  "distractor-capsule": "distractor",
  "defender-capsule": "defender",
  "destroyer-capsule": "destroyer",
  "discharge-defense-remote": "discharge-defense-equipment-controller",
  "raw-fish": "fish",
}

const cropCanvas = document.createElement("canvas")
cropCanvas.width = 64
cropCanvas.height = 64
const cropCtx = cropCanvas.getContext("2d", {
  alpha: true,
  desynchronized: true,
})!

const iconPrefix = /^__base__\/graphics\/icons\//

function iconNameForRecipe(recipe: Recipe) {
  if (recipe.name in manualOverrides) {
    return manualOverrides[recipe.name as keyof typeof manualOverrides]
  }

  if (recipe.icon) {
    if (!iconPrefix.test(recipe.icon))
      throw new Error("Unsupport icon path " + recipe.icon)
    const prunedURL = recipe.icon
      .replace(/^__base__\/graphics\/icons\//, "")
      .replace(/\.png$/, "")
    return prunedURL
  }

  return recipe.name
}

const prepareIconWithName = memoize(async (name: string) => {
  if (name in manualOverrides) {
    name = manualOverrides[name as keyof typeof manualOverrides]
  }
  const iconURL = icons.get(name)
  if (!iconURL) throw new Error("Cannot find icon with name " + name)
  const image = await loadImage(iconURL)

  return new Promise<string>((resolve, reject) => {
    scheduleTilDeadline(() => {
      cropCtx.clearRect(0, 0, 64, 64)
      cropCtx.drawImage(image, 0, 0)
      cropCanvas.toBlob(blob => {
        if (blob) resolve(URL.createObjectURL(blob))
        else reject(new Error("Failed to create blob"))
      }, "image/png")
    })
  })
})

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image ${src}`))
    img.src = src
  })
}

export type SelectionDialogProps = {
  dialog: HTMLDialogElement
  onSelected(recipeName: string): void
}

export function initSelectionDialog({
  onSelected,
  dialog,
}: SelectionDialogProps) {
  const form = dialog.querySelector(".selection-form") as HTMLFormElement
  const modal = dialog.querySelector(".dialog-modal") as HTMLDivElement

  // Init dialog
  {
    dialog.addEventListener(
      "submit",
      ev => {
        ev.preventDefault()
        const data = new FormData(ev.target as HTMLFormElement)
        const recipeName = data.get("recipeName") as string
        onSelected(recipeName)

        dialog.classList.add("hidden")
        function handleAnimationEnd(animationEvent: AnimationEvent) {
          if (
            animationEvent.animationName === "fade-out" &&
            animationEvent.target === dialog
          ) {
            dialog.close()
          }
          dialog.removeEventListener("animationend", handleAnimationEnd)
        }
        dialog.addEventListener("animationend", handleAnimationEnd)
      },
      { once: true }
    )
    form.append(...recipes.map(recipeButton))
  }

  // Init tooltip
  {
    const tooltip = dialog.querySelector(".recipe-tooltip") as HTMLDivElement
    const title = tooltip.querySelector(".tooltip-title") as HTMLDivElement
    const ingredients = tooltip.querySelector(
      ".tooltip-ingredients-list"
    ) as HTMLDivElement
    const craftingTime = tooltip.querySelector(
      ".tooltip-crafting-time-value"
    ) as HTMLDivElement

    let currentRecipe: Recipe | undefined
    form.addEventListener("mouseenter", ev => {
      if (
        ev.target instanceof HTMLButtonElement &&
        ev.target.classList.contains("recipe-button")
      ) {
        const recipeName = ev.target.value
        updateTooltip(recipeMap.get(recipeName))
      }
      moveTooltip(ev)
    })
    form.addEventListener("mousemove", ev => {
      if (
        ev.target instanceof HTMLButtonElement &&
        ev.target.classList.contains("recipe-button")
      ) {
        const recipeName = ev.target.value
        updateTooltip(recipeMap.get(recipeName))
      }
      moveTooltip(ev)
    })
    form.addEventListener("mouseleave", () => {
      updateTooltip(undefined)
    })

    function moveTooltip(ev: MouseEvent) {
      const rect = modal.getBoundingClientRect()
      const tooltipRect = tooltip.getBoundingClientRect()

      let left = ev.clientX - rect.left + 8
      if (ev.clientX + tooltipRect.width + 24 > window.innerWidth) {
        left -= tooltipRect.width + 16
      } 

      let top = ev.clientY - rect.top + 8
      if (ev.clientY + tooltipRect.height + 24 > window.innerHeight) {
        top -= tooltipRect.height + 16
      } 

      tooltip.style.transform = `translate(${left}px, ${top}px)`
    }

    function updateTooltip(newRecipe?: Recipe) {
      if (newRecipe === currentRecipe) return
      currentRecipe = newRecipe

      if (!newRecipe) {
        tooltip.classList.add("hidden")
        return
      }

      tooltip.classList.remove("hidden")
      title.textContent = recipeName(newRecipe)
      craftingTime.textContent = `${newRecipe.energy_required ?? 0.5}s`

      ingredients.innerHTML = ""
      ingredients.append(...recipeIngredients(newRecipe).map(ingredient))
    }
  }
}

async function iconForItem(item: NormalizedRecipeItem) {
  switch (item.type) {
    case "item":
      return await prepareIconWithName(item.name)
    case "fluid":
      return await prepareIconWithName(`fluid/${item.name}`)
  }
}

function normalizeRecipeItem(item: RecipeItem) {
  if (Array.isArray(item)) {
    const [name, amount] = item
    return { type: "item", name, amount } as const
  }
  if (item.type !== "fluid" && item.type !== "item")
    throw new Error("Unsupported item type " + item.type)
  return item as NormalizedRecipeItem
}

function recipeIngredients(recipe: Recipe) {
  const ingredients = (recipe.ingredients ??
    recipe.normal.ingredients) as RecipeItem[]
  return ingredients.map(normalizeRecipeItem)
}

function ingredient(ingredient: NormalizedRecipeItem) {
  const container = document.createElement("div")
  container.classList.add("tooltip-ingredient")

  const amount = document.createElement("span")
  amount.classList.add("tooltip-ingredient-amount")
  amount.textContent = `${ingredient.amount} x`

  const name = document.createElement("span")
  name.classList.add("tooltip-ingredient-name")
  name.textContent = t(ingredient.name) ?? ingredient.name

  iconForItem(ingredient)
    .then(iconURL => {
      const icon = document.createElement("img")
      icon.classList.add("tooltip-ingredient-icon")
      icon.src = iconURL
      container.prepend(icon)
    })
    .catch(console.error)

  container.append(amount, name)
  return container
}
