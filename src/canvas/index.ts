import { TypedMessageChannel } from "../typed-channel"
import { iconURLForName } from "../icon"
import { VisualNode, Widget } from "./common"
import * as layout from "./layout"
import { RecipeGraph, RecipeNode } from "../graph"

type CanvasOutEvent = never
type CanvasInEvent =
  | { type: "update-graph"; graph: RecipeGraph }
  | { type: "deinit" }

// type BoxID = ("root" | number) & { readonly $tag: unique symbol }

const LEVEL_OFFSET = 50
const MIN_NODE_SPACING = 20

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
    size * window.devicePixelRatio,
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
      { once: true },
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

  let nodes: VisualNode[] = []

  let frameInvalidated = false
  revalidateSize()

  function draw() {
    ctx.clearRect(0, 0, cssWidth, cssHeight)

    for (const node of nodes) {
      for (const widget of node.contents) {
        if (widget.type === "box") {
          ctx.fillStyle = widget.bg
          ctx.fillRect(
            node.dx + widget.layout.x,
            node.dy + widget.layout.y,
            widget.layout.width,
            widget.layout.height,
          )
        } else if (widget.type === "icon") {
          drawIcon({
            ctx,
            name: widget.name,
            x: node.dx + widget.layout.x,
            y: node.dy + widget.layout.y,
            size: Math.min(widget.layout.width, widget.layout.height),
            signal: abortSignal,
          })
        } else if (widget.type === "text") {
          ctx.fillStyle = widget.color
          ctx.font = widget.font
          ctx.fillText(
            widget.text,
            node.dx + widget.layout.x,
            node.dy + widget.layout.y + widget.baseline,
          )
        }
      }
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
      case "update-graph": {
        const { graph } = ev.data

        const levelHeight = Array(graph.nodesOnLevel.length).fill(0)
        const levelWidth = Array(graph.nodesOnLevel.length).fill(-MIN_NODE_SPACING)
        type LayoutNode = {
          id: number
          node: RecipeNode
          bbox: { width: number; height: number }
          contents: Widget[]
        }
        const layoutNodes: LayoutNode[] = []

        for (const [id, node] of graph.nodes.entries()) {
          const level = graph.nodeDepth[id]!

          const { bbox, contents } = layout.node(ctx, node)
          levelHeight[level] = Math.max(levelHeight[level], bbox.height)
          levelWidth[level] += bbox.width + MIN_NODE_SPACING
          layoutNodes.push({ id, node, bbox, contents })
        }

        nodes = []
        const nodesPlacedByLevel = Array(graph.nodesOnLevel.length).fill(0)
        for (const node of layoutNodes) {
          const level = graph.nodeDepth[node.id]!

          let offset = 0
          for (let i = 0; i < level; i++) {
            offset += levelHeight[i] + LEVEL_OFFSET
          }

          const horizontalOffset = nodesPlacedByLevel[level]
          nodesPlacedByLevel[level] += node.bbox.width + MIN_NODE_SPACING
          nodes.push({
            dx: cssWidth / 2 - levelWidth[level] / 2 + horizontalOffset,
            dy: cssHeight / 4 + offset,
            bbox: node.bbox,
            node: node.node,
            contents: node.contents,
          })
        }

        invalidateFrame()
        break
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
    box: VisualNode
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
      prevState.box.dx = x - prevState.anchor.x
      prevState.box.dy = y - prevState.anchor.y
      newCursor = "move"
      invalidateFrame()
    }

    if (newCursor !== cursor) {
      cursor = newCursor
      canvas.style.cursor = cursor
    }
  })

  function hitTest(x: number, y: number) {
    for (const node of nodes) {
      if (isWithinBox(node, x, y)) {
        return node
      }
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
        anchor: { x: x - box.dx, y: y - box.dy },
      })
    }
  })

  canvas.addEventListener("pointerup", ev => {
    pointerStates.delete(ev.pointerId)
  })

  return remotePort
}

function isWithinBox(box: VisualNode, x: number, y: number) {
  return (
    x >= box.dx &&
    x <= box.dx + box.bbox.width &&
    y >= box.dy &&
    y <= box.dy + box.bbox.height
  )
}
