import { Recipe, recipeName } from "./recipe"
import { TypedMessageChannel } from "./typed-channel"
import { iconNameForRecipe, iconURLForName } from "./icon"

type CanvasOutEvent = never
type CanvasInEvent =
  | { type: "select-root"; recipe: Recipe }
  | { type: "deinit" }

type RootBox = {
  type: "root"
  x: number
  y: number
  width: number
  height: number
  recipe: Recipe
  titleMeasures: TextMetrics
  desiredProduction: number
  innerRect: { width: number; height: number }
}

type Box = RootBox
// type BoxID = ("root" | number) & { readonly $tag: unique symbol }

const BOX_PADDING = 8
const BOX_CONTENT_MARGIN = 8
const BOX_CONTENT_PADDING = 8
const ICON_MARGIN = 12
const ICON_SIZE = 28
const TITLE_FONT = {
  family: "sans-serif",
  size: 18,
  weight: 600,
}
const BODY_FONT = {
  family: "sans-serif",
  size: 14,
  weight: 600,
}

const BOX_BG = "#313131"
const TEXT_COLOR = "rgb(255, 231, 190)"

class LightweightAbortSignal {
  private _version = 0
  get version() {
    return this._version
  }
  abort() {
    this._version = (this._version + 1) | 0
  }
}

type DrawIconArgs = {
  ctx: CanvasRenderingContext2D
  name: string
  x: number
  y: number
  size: number
  signal?: LightweightAbortSignal
}

type ImageCacheEntry = { type: "pending" | "loaded"; image: HTMLImageElement }

const imageCache = new Map<string, ImageCacheEntry>()

function drawIcon({ ctx, name, x, y, size, signal }: DrawIconArgs) {
  const iconURL = iconURLForName(name)
  if (!iconURL) {
    console.warn(`No icon for ${name}`)
    return
  }
  const [sourceX, sourceSize] = sourceIconRectForSize(
    size * window.devicePixelRatio
  )

  function doDraw(image: HTMLImageElement) {
    ctx.drawImage(image, sourceX, 0, sourceSize, sourceSize, x, y, size, size)
  }

  const cached = imageCache.get(iconURL)
  if (cached && cached.type === "loaded") {
    doDraw(cached.image)
    return
  }
  if (cached && cached.type === "pending") {
    const startingVersion = signal?.version

    cached.image.addEventListener(
      "load",
      () => {
        if (signal?.version !== startingVersion) return
        doDraw(cached.image)
      },
      { once: true }
    )
  }

  const image = new Image()
  const entry: ImageCacheEntry = { type: "pending", image }
  imageCache.set(iconURL, entry)

  const startingVersion = signal?.version
  image.addEventListener("load", () => {
    entry.type = "loaded"
    if (signal?.version !== startingVersion) return
    doDraw(image)
  })
  image.src = iconURL
}

function sourceIconRectForSize(size: number): [dx: number, size: number] {
  if (size > 32) return [0, 64]
  else if (size > 16) return [63, 32]
  else return [95, 16]
}

export function initCanvas(canvas: HTMLCanvasElement) {
  const { port1: localPort, port2: remotePort } = new TypedMessageChannel<
    CanvasInEvent,
    CanvasOutEvent
  >()

  const ctx = canvas.getContext("2d")!
  const computedTitleFont = `${TITLE_FONT.weight} ${TITLE_FONT.size}px ${TITLE_FONT.family}`
  const computedBodyFont = `${BODY_FONT.weight} ${BODY_FONT.size}px ${BODY_FONT.family}`
  ctx.font = computedTitleFont

  let cssWidth = canvas.clientWidth
  let cssHeight = canvas.clientHeight

  const abortSignal = new LightweightAbortSignal()

  function revalidateSize() {
    cssWidth = canvas.clientWidth
    cssHeight = canvas.clientHeight

    canvas.width = cssWidth * window.devicePixelRatio
    canvas.height = cssHeight * window.devicePixelRatio
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio)

    invalidateFrame()
  }

  let rootBox: RootBox | undefined = undefined

  let frameInvalidated = false
  revalidateSize()

  function draw() {
    ctx.clearRect(0, 0, cssWidth, cssHeight)

    if (rootBox) {
      ctx.fillStyle = BOX_BG
      ctx.fillRect(rootBox.x, rootBox.y, rootBox.width, rootBox.height)
      const titleHeight =
        rootBox.height -
        BOX_PADDING * 2 -
        BOX_CONTENT_MARGIN * 2 -
        rootBox.innerRect.height

      drawIcon({
        ctx,
        name: iconNameForRecipe(rootBox.recipe),
        x: rootBox.x + BOX_PADDING,
        y: rootBox.y + BOX_PADDING + (titleHeight - ICON_SIZE) / 2,
        size: ICON_SIZE,
        signal: abortSignal,
      })
      ctx.fillStyle = TEXT_COLOR
      ctx.font = computedTitleFont

      ctx.fillStyle
      ctx.fillText(
        recipeName(rootBox.recipe),
        rootBox.x + BOX_PADDING + ICON_SIZE + ICON_MARGIN,
        rootBox.y +
          BOX_PADDING +
          rootBox.titleMeasures.actualBoundingBoxAscent +
          (titleHeight -
            rootBox.titleMeasures.actualBoundingBoxAscent -
            rootBox.titleMeasures.actualBoundingBoxDescent) /
            2
      )

      ctx.fillStyle = "#404040"
      ctx.fillRect(
        rootBox.x + BOX_PADDING + BOX_CONTENT_MARGIN,
        rootBox.y + titleHeight + BOX_PADDING + BOX_CONTENT_MARGIN,
        rootBox.innerRect.width,
        rootBox.innerRect.height
      )

      ctx.font = computedBodyFont
      ctx.fillStyle = "white"
      ctx.fillText(
        "Desired production rate: 2 per second",
        rootBox.x + BOX_PADDING + BOX_CONTENT_MARGIN + BOX_CONTENT_PADDING,
        rootBox.y +
          titleHeight +
          BOX_PADDING +
          BOX_CONTENT_MARGIN +
          BOX_CONTENT_PADDING +
          rootBox.titleMeasures.actualBoundingBoxAscent
      )

      ctx.fillText(
        "Crafting time 0.5s",
        rootBox.x + BOX_PADDING + BOX_CONTENT_MARGIN + BOX_CONTENT_PADDING,
        rootBox.y +
          titleHeight +
          BOX_PADDING +
          BOX_CONTENT_MARGIN +
          BOX_CONTENT_PADDING +
          rootBox.titleMeasures.actualBoundingBoxAscent +
          20
      )

      ctx.fillText("Assemblers required: 1", 10, 10)
    }
  }

  window.addEventListener("resize", revalidateSize)

  localPort.addEventListener("message", handleMessage)
  localPort.start()

  function handleMessage(ev: MessageEvent<CanvasInEvent>) {
    switch (ev.data.type) {
      case "deinit": {
        localPort.close()
        window.removeEventListener("resize", revalidateSize)
        localPort.removeEventListener("message", handleMessage)
        break
      }
      case "select-root": {
        const { recipe } = ev.data
        const name = recipeName(recipe)
        ctx.font = computedTitleFont
        const titleMeasures = ctx.measureText(name)

        const innerRect = { width: 300, height: 200 }

        const titleWidth =
          BOX_PADDING * 2 + ICON_SIZE + ICON_MARGIN + titleMeasures.width
        const innerWidth = BOX_CONTENT_MARGIN * 2 + innerRect.width
        const width = BOX_PADDING * 2 + Math.max(titleWidth, innerWidth)
        const titleHeight =
          titleMeasures.actualBoundingBoxAscent +
          titleMeasures.actualBoundingBoxDescent
        const height =
          BOX_PADDING * 2 +
          Math.max(titleHeight, ICON_SIZE) +
          BOX_CONTENT_MARGIN * 2 +
          innerRect.height

        rootBox = {
          type: "root",
          x: cssWidth / 2 - width / 2,
          y: cssHeight * 0.25 - height / 2,
          width,
          height,
          recipe,
          titleMeasures,
          desiredProduction: 1,
          innerRect: { width: 300, height: 200 },
        }
        invalidateFrame()
      }
    }
  }

  function invalidateFrame() {
    if (!frameInvalidated) {
      frameInvalidated = true
      abortSignal.abort()
      requestAnimationFrame(() => {
        draw()
        frameInvalidated = false
      })
    }
  }

  type PointerState = {
    x: number
    y: number
    box: Box
    anchor: { x: number; y: number }
  }
  const pointerStates = new Map<number, PointerState>()
  let cursor = "auto"

  canvas.addEventListener("pointermove", ev => {
    const { left, top } = canvas.getBoundingClientRect()
    const x = ev.x - left
    const y = ev.y - top

    const boxId = hitTest(x, y)
    let newCursor = cursor

    if (boxId !== undefined) {
      newCursor = "move"
    } else {
      newCursor = "auto"
    }

    const prevState = pointerStates.get(ev.pointerId)
    if (prevState) {
      prevState.box.x = x - prevState.anchor.x
      prevState.box.y = y - prevState.anchor.y
      newCursor = "move"
      invalidateFrame()
    }

    if (newCursor !== cursor) {
      cursor = newCursor
      canvas.style.cursor = cursor
    }
  })

  function hitTest(x: number, y: number) {
    if (rootBox && isWithinBox(rootBox, x, y)) {
      return rootBox
    }
  }

  canvas.addEventListener("pointerdown", ev => {
    const { left, top } = canvas.getBoundingClientRect()
    const x = ev.x - left
    const y = ev.y - top

    const box = hitTest(x, y)

    if (box) {
      pointerStates.set(ev.pointerId, {
        x,
        y,
        box,
        anchor: { x: x - box.x, y: y - box.y },
      })
    }
  })

  canvas.addEventListener("pointerup", ev => {
    pointerStates.delete(ev.pointerId)
  })

  return remotePort
}

function isWithinBox(box: Box, x: number, y: number) {
  return (
    x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.height
  )
}
