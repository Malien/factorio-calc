import type { Recipe } from "./recipe"
import { scheduleTilDeadline } from "./scheduler"

const iconPrefix = /^__base__\/graphics\/icons\//

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

export function iconNameForRecipe(recipe: Recipe) {
  if (recipe.icon) {
    if (!iconPrefix.test(recipe.icon))
      throw new Error("Unsupport icon path " + recipe.icon)
    const prunedURL = recipe.icon
      .replace(/^__base__\/graphics\/icons\//, "")
      .replace(/\.png$/, "")
    return prunedURL
  }

  if (recipe.name in manualOverrides) {
    return manualOverrides[recipe.name as keyof typeof manualOverrides]
  }

  return recipe.name
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

export function iconURLForName(name: string) {
  if (name in manualOverrides) {
    name = manualOverrides[name as keyof typeof manualOverrides]
  }
  return icons.get(name)
}

const cropCanvas = document.createElement("canvas")
cropCanvas.width = 64
cropCanvas.height = 64
const cropCtx = cropCanvas.getContext("2d", {
  alpha: true,
  desynchronized: true,
})!

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

export function prepareIconWithName(name: string, signal?: AbortSignal) {
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

  const iconURL = iconURLForName(name)
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

export async function iconForItem(itemName: string, type: "item" | "fluid", signal?: AbortSignal) {
  switch (type) {
    case "item":
      return await prepareIconWithName(itemName, signal)
    case "fluid":
      return await prepareIconWithName(`fluid/${itemName}`, signal)
  }
}

