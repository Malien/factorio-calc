import { Recipe, recipeName } from "./recipe"
import { TypedMessageChannel } from "./typed-channel"

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
}

type Box = RootBox

// type BoxID = ("root" | number) & { readonly $tag: unique symbol }

const BOX_PADDING = 8
const ICON_MARGIN = 4
const ICON_SIZE = 32
const FONT = {
  family: "sans-serif",
  size: 20,
  weight: 600,
}

const BOX_BG = "#313131"
const TEXT_COLOR = "rgb(255, 231, 190)"

export function initCanvas(canvas: HTMLCanvasElement) {
  const { port1: localPort, port2: remotePort } = new TypedMessageChannel<
    CanvasInEvent,
    CanvasOutEvent
  >()

  const ctx = canvas.getContext("2d")!
  const computedFont = `${FONT.weight} ${FONT.size}px ${FONT.family}`
  ctx.font = computedFont

  let cssWidth = canvas.clientWidth
  let cssHeight = canvas.clientHeight

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
      ctx.fillStyle = TEXT_COLOR
      ctx.font = computedFont
      ctx.fillStyle
      ctx.fillText(
        recipeName(rootBox.recipe),
        rootBox.x + BOX_PADDING,
        rootBox.y + BOX_PADDING + rootBox.titleMeasures.actualBoundingBoxAscent
      )
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
        ctx.font = computedFont
        const titleMeasures = ctx.measureText(name)
        const width = BOX_PADDING * 2 + titleMeasures.width
        const height =
          BOX_PADDING * 2 +
          titleMeasures.actualBoundingBoxAscent +
          titleMeasures.actualBoundingBoxDescent
        rootBox = {
          type: "root",
          x: cssWidth / 2 - width / 2,
          y: cssHeight * 0.25 - height / 2,
          width,
          height,
          recipe,
          titleMeasures,
        }
        invalidateFrame()
      }
    }
  }

  function invalidateFrame() {
    if (!frameInvalidated) {
      frameInvalidated = true
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
