import {
  Recipe,
  RecipeItem,
  NormalizedRecipeItem,
  recipes,
  recipeMap,
  recipeName,
  normalizeRecipeItem,
  t,
} from "./recipe"
import { scheduleTilDeadline } from "./scheduler"

function recipeButton(recipe: Recipe, signal?: AbortSignal) {
  const button = document.createElement("button")
  button.type = "submit"
  button.name = "recipeName"
  button.value = recipe.name
  button.className = "recipe-button"

  const iconName = iconNameForRecipe(recipe)
  prepareIconWithName(iconName, signal)
    .then(url => {
      const img = new Image()
      img.className = "recipe-icon"
      img.src = url
      img.alt = recipeName(recipe)
      img.onload = () => {
        button.append(img)
        const animation = img.animate({ opacity: [0, 1] }, { duration: 600 })
        signal?.addEventListener("abort", () => animation.cancel())
        animation.onfinish = () => {
          img.style.opacity = "1"
        }
      }
      button.append(img)
    })
    .catch(err => {
      if (err.name === "AbortError") return
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

type Deferred<T> = {
  resolve(value: T): void
  reject(err: Error): void
}

type PendingCacheEntry = {
  type: "pending"
  controller: AbortController
  resolvers: Set<Deferred<string>>
}

type IconCacheEntry = { type: "resolved"; value: string } | PendingCacheEntry

const iconCache = new Map<string, IconCacheEntry>()

function prepareIconWithName(name: string, signal?: AbortSignal) {
  const cached = iconCache.get(name)
  if (cached && cached.type === "resolved") return Promise.resolve(cached.value)
  if (cached && cached.type === "pending") {
    return new Promise<string>((resolve, reject) => {
      const deferred = { resolve, reject }
      cached.resolvers.add(deferred)
      abortDeferred(cached, deferred)
    })
  }

  function abortDeferred(entry: PendingCacheEntry, deferred: Deferred<string>) {
    signal?.addEventListener("abort", () => {
      entry.resolvers.delete(deferred)
      if (entry.resolvers.size === 0) {
        entry.controller.abort()
        iconCache.delete(name)
      }
      deferred.reject(new DOMException("Aborted", "AbortError"))
    })
  }

  if (name in manualOverrides) {
    name = manualOverrides[name as keyof typeof manualOverrides]
  }
  const iconURL = icons.get(name)
  if (!iconURL) throw new Error("Cannot find icon with name " + name)

  const controller = new AbortController()

  return new Promise<string>(async (resolve, reject) => {
    const deferred = { resolve, reject }

    const entry = {
      type: "pending" as const,
      controller,
      resolvers: new Set([deferred]),
    }

    iconCache.set(name, entry)

    abortDeferred(entry, deferred)

    try {
      const image = await loadImage(iconURL, controller.signal)
      await scheduleTilDeadline(() => {
        cropCtx.clearRect(0, 0, 64, 64)
        cropCtx.drawImage(image, 0, 0)
      }, controller.signal)
      const blob = await canvasToBlob(cropCanvas, "image/png")
      const url = URL.createObjectURL(blob)
      iconCache.set(name, { type: "resolved", value: url })
      for (const resolver of entry.resolvers) {
        resolver.resolve(url)
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return
      for (const resolver of entry.resolvers) {
        resolver.reject(new Error("Failed to create blob from canvas"))
      }
    }
  })
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (blob) resolve(blob)
        else reject(new Error("Failed to create blob from canvas"))
      },
      type,
      quality
    )
  })
}

function loadImage(src: string, signal?: AbortSignal) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    signal?.addEventListener("abort", () => {
      img.src = ""
      reject(new DOMException("Aborted", "AbortError"))
    })
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
    const controller = new AbortController()
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
            controller.abort()
          }
          dialog.removeEventListener("animationend", handleAnimationEnd)
        }
        dialog.addEventListener("animationend", handleAnimationEnd)
      },
      { once: true }
    )
    form.append(
      ...recipes.map(recipe => recipeButton(recipe, controller.signal))
    )
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
      ingredients.append(
        ...recipeIngredients(newRecipe).map(recipe => ingredient(recipe))
      )
    }
  }
}

async function iconForItem(item: NormalizedRecipeItem, signal?: AbortSignal) {
  switch (item.type) {
    case "item":
      return await prepareIconWithName(item.name, signal)
    case "fluid":
      return await prepareIconWithName(`fluid/${item.name}`, signal)
  }
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
