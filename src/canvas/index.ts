import { TypedMessageChannel } from "../typed-channel"
import { iconURLForName } from "../icon"
import {
  ExternalElement,
  Interactivity,
  Rect,
  Widget,
  computeFont,
} from "./common"
import * as layout from "./layout"
import type { Action, NodeID, RecipeGraph, RecipeNode } from "../graph"

type ExistingExternalElement = ExternalElement & { element: HTMLElement }

type Offset2D = { dx: number; dy: number }

type VisualNode = Offset2D & {
  bbox: { width: number; height: number }
  dragbox: Rect
  node: RecipeNode
  contents: Widget[]
  externalElements: ExistingExternalElement[]
}

type CanvasOutEvent = Action
type CanvasInEvent =
  | { type: "update-graph"; graph: RecipeGraph }
  | { type: "deinit" }

const LEVEL_OFFSET = 50
const MIN_NODE_SPACING = 20
const MIN_OFFSET = -500
const MAX_OFFSET = 500

function clampOffset(offset: number) {
  return Math.max(MIN_OFFSET, Math.min(MAX_OFFSET, offset))
}

class LightweightAbortSignal {
  private _version = 0
  get version() {
    return this._version
  }
  abort() {
    this._version = (this._version + 1) | 0
  }
}

const MAX_SCALE = 2
const MIN_SCALE = 0.25

type DrawIconArgs = {
  ctx: CanvasRenderingContext2D
  name: string
  x: number
  y: number
  size: number
  signal?: LightweightAbortSignal
}

type InteractiveRegion = {
  interactivity: Interactivity
  layout: Rect
}

namespace webkit {
  export interface GestureEvent extends UIEvent {
    readonly rotation: number
    readonly scale: number
    readonly pageX: number
    readonly pageY: number
    readonly clientX: number
    readonly clientY: number
  }
}

declare global {
  interface HTMLElementEventMap {
    gesturestart: webkit.GestureEvent
    gesturechange: webkit.GestureEvent
    gestureend: webkit.GestureEvent
  }
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

  const nodes = new Map<NodeID, VisualNode>()
  const interactiveRegions = new Map<NodeID, InteractiveRegion[]>()

  let frameInvalidated = false
  revalidateSize()

  const presentExternalElements = new Map<
    NodeID,
    Record<string, ExistingExternalElement>
  >()
  let elementInFocus: [node: NodeID, elementKey: string] | undefined = undefined
  let globalOffset = { dx: 0, dy: 0 }
  let scale = 1

  function draw() {
    ctx.clearRect(0, 0, cssWidth, cssHeight)

    for (const node of nodes.values()) {
      for (const widget of node.contents) {
        drawWidget({
          ctx,
          offset: {
            dx: node.dx + globalOffset.dx,
            dy: node.dy + globalOffset.dy,
          },
          widget,
          abortSignal,
          scale,
        })
      }
    }
  }

  type Listener = { type: string; listener: (ev: Event) => void }

  window.addEventListener("resize", revalidateSize)
  localPort.addEventListener("message", handleMessage)
  localPort.start()
  remotePort.start()
  canvas.addEventListener("pointermove", handlePointerMove)
  canvas.addEventListener("pointerdown", handlePointerDown)
  canvas.addEventListener("pointerup", handlePointerUp)

  // These are for pinch-to-zoom
  canvas.addEventListener("gesturestart", handleGestureStart)
  canvas.addEventListener("gesturechange", handleGestureChange)
  canvas.addEventListener("gestureend", handleGestureEnd)
  canvas.addEventListener("wheel", handleWheel)

  let gestureStartScale = 1
  let gestureStartPos = { x: 0, y: 0 }
  let capturedGlobalOffset = { dx: 0, dy: 0 }
  function handleGestureStart(ev: webkit.GestureEvent) {
    console.debug("gesture start", ev)
    ev.preventDefault()
    gestureStartScale = scale
    gestureStartPos = { x: ev.clientX, y: ev.clientY }
    capturedGlobalOffset = { ...globalOffset }
  }

  function handleGestureChange(ev: webkit.GestureEvent) {
    ev.preventDefault()
    scale = Math.max(
      MIN_SCALE,
      Math.min(MAX_SCALE, gestureStartScale * ev.scale),
    )
    const pointDelta = {
      x: gestureStartPos.x * (ev.scale - 1),
      y: gestureStartPos.y * (ev.scale - 1),
    }
    globalOffset.dx = clampOffset(
      capturedGlobalOffset.dx - pointDelta.x / scale,
    )
    globalOffset.dy = clampOffset(
      capturedGlobalOffset.dy - pointDelta.y / scale,
    )
    invalidateFrame()
  }

  function handleGestureEnd(ev: webkit.GestureEvent) {
    ev.preventDefault()
    // scale = 1
    // globalOffset = capturedGlobalOffset
    invalidateFrame()
  }

  const externalListeners = new WeakMap<HTMLElement, Listener[]>()

  function deinit() {
    localPort.close()
    remotePort.close()
    window.removeEventListener("resize", revalidateSize)
    localPort.removeEventListener("message", handleMessage)
    canvas.removeEventListener("pointermove", handlePointerMove)
    canvas.removeEventListener("pointerdown", handlePointerDown)
    canvas.removeEventListener("pointerup", handlePointerUp)
    canvas.removeEventListener("wheel", handleWheel)
    canvas.removeEventListener("gesturestart", handleGestureStart)
    canvas.removeEventListener("gesturechange", handleGestureChange)
    canvas.removeEventListener("gestureend", handleGestureEnd)
    canvas.removeEventListener("wheel", handleWheel)

    for (const elementMap of presentExternalElements.values()) {
      for (const element of Object.values(elementMap)) {
        element.element.remove()
        const listeners = externalListeners.get(element.element) ?? []
        for (const { type, listener } of listeners) {
          element.element.removeEventListener(type, listener)
        }
      }
    }
    presentExternalElements.clear()
  }

  function updateGraph(graph: RecipeGraph) {
    const levelHeight = Array(graph.nodesOnLevel.length).fill(0)
    const levelWidth = Array(graph.nodesOnLevel.length).fill(-MIN_NODE_SPACING)
    type LayoutNode = {
      node: RecipeNode
      bbox: { width: number; height: number }
      dragbox: Rect
      contents: Widget[]
    }
    const layoutNodes: LayoutNode[] = []

    for (const node of graph.nodes.values()) {
      const level = graph.nodeDepth.get(node.id)!

      const { bbox, contents, dragbox, externalElements } = layout.node({
        ctx,
        node,
        focusedElement: focusedElement(node.id),
      })
      updateExternalElements(node.id, externalElements)

      levelHeight[level] = Math.max(levelHeight[level], bbox.height)
      levelWidth[level] += bbox.width + MIN_NODE_SPACING
      layoutNodes.push({ node, bbox, dragbox, contents })
    }

    nodes.clear()
    interactiveRegions.clear()
    const nodesPlacedByLevel = Array(graph.nodesOnLevel.length).fill(0)
    for (const { node, bbox, contents, dragbox } of layoutNodes) {
      const level = graph.nodeDepth.get(node.id)!

      let offset = 0
      for (let i = 0; i < level; i++) {
        offset += levelHeight[i] + LEVEL_OFFSET
      }

      let regions: InteractiveRegion[] | undefined
      for (const widget of contents) {
        if (widget.interactivity?.click) {
          regions ??= []
          regions.push({
            interactivity: widget.interactivity,
            layout: widget.layout,
          })
        }
      }
      if (regions) interactiveRegions.set(node.id, regions)

      const horizontalOffset = nodesPlacedByLevel[level]
      nodesPlacedByLevel[level] += bbox.width + MIN_NODE_SPACING
      nodes.set(node.id, {
        dx: cssWidth / 2 - levelWidth[level] / 2 + horizontalOffset,
        dy: cssHeight / 4 + offset,
        bbox,
        node,
        dragbox,
        contents,
        externalElements: [],
      })
    }

    invalidateFrame()
  }

  function focusedElement(forNode: NodeID) {
    if (!elementInFocus) return undefined
    const [node, elementKey] = elementInFocus
    if (node !== forNode) return undefined
    return elementKey
  }

  function updateExternalElements(
    node: NodeID,
    nextElements: Record<string, ExternalElement>,
  ) {
    const prevElements = (() => {
      const existing = presentExternalElements.get(node)
      if (existing) return existing
      const newMap: Record<string, ExistingExternalElement> = {}
      presentExternalElements.set(node, newMap)
      return newMap
    })()

    for (const newElementKey of additions(prevElements, nextElements)) {
      const newElement = nextElements[newElementKey]!
      if (newElement.tag === "button") {
        const { activate, title, tag } = newElement
        const button = document.createElement("button")
        if (title !== undefined) {
          button.innerText = title
        }
        const listeners: Listener[] = []

        const handleFocus = () => {
          elementInFocus = [node, newElementKey]
          invalidateLayout(node)
        }
        button.addEventListener("focus", handleFocus)
        listeners.push({ type: "focus", listener: handleFocus })

        const handleBlur = () => {
          if (!elementInFocus) return
          const [prevNode, prevElementKey] = elementInFocus
          if (prevNode !== node) return
          if (prevElementKey !== newElementKey) return
          elementInFocus = undefined
          invalidateLayout(node)
        }
        button.addEventListener("blur", handleBlur)
        listeners.push({ type: "blur", listener: handleBlur })

        if (activate) {
          const handleClick = () => {
            localPort.postMessage(activate)
          }
          button.addEventListener("click", handleClick)
          listeners.push({ type: "click", listener: handleClick })
        }

        canvas.append(button)
        externalListeners.set(button, listeners)

        prevElements[newElementKey] = { element: button, tag, title }
      }
    }

    for (const removedElementKey of removals(prevElements, nextElements)) {
      const element = prevElements[removedElementKey]!
      element.element.remove()

      const listeners = externalListeners.get(element.element)
      if (listeners) {
        for (const { type, listener } of listeners) {
          element.element.removeEventListener(type, listener)
        }
        externalListeners.delete(element.element)
      }

      delete prevElements[removedElementKey]
    }
  }

  function handleMessage(ev: MessageEvent<CanvasInEvent>) {
    switch (ev.data.type) {
      case "deinit":
        deinit()
        break
      case "update-graph": {
        updateGraph(ev.data.graph)
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

  function invalidateLayout(ofNode: NodeID) {
    const visualNode = nodes.get(ofNode)
    if (!visualNode) return
    const { externalElements, bbox, contents } = layout.node({
      ctx,
      node: visualNode.node,
      focusedElement: focusedElement(ofNode),
    })
    updateExternalElements(ofNode, externalElements)
    visualNode.bbox = bbox
    visualNode.contents = contents
    invalidateFrame()
  }

  type PointerState = {
    x: number
    y: number
    box: VisualNode
    anchor: { x: number; y: number }
  }
  const pointerStates = new Map<number, PointerState>()
  let cursor = "auto"

  function handlePointerMove(ev: PointerEvent) {
    const { left, top } = canvas.getBoundingClientRect()
    const x = ev.x - left
    const y = ev.y - top

    const [type, box] = hitTest(x, y)
    let newCursor = cursor

    if (type === "node") {
      newCursor = "move"
    } else if (type === "region" && box.interactivity.click) {
      newCursor = "pointer"
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
  }

  function handlePointerDown(ev: PointerEvent) {
    const { left, top } = canvas.getBoundingClientRect()
    const x = ev.x - left
    const y = ev.y - top

    const [type, box] = hitTest(x, y)

    if (type === "node") {
      pointerStates.set(ev.pointerId, {
        x,
        y,
        box,
        anchor: { x: x - box.dx, y: y - box.dy },
      })
    } else if (type === "region" && box.interactivity.click) {
      localPort.postMessage(box.interactivity.click)
    }
  }

  function handlePointerUp(ev: PointerEvent) {
    pointerStates.delete(ev.pointerId)
  }

  function handleWheel(ev: WheelEvent) {
    ev.preventDefault()
    globalOffset.dx = clampOffset(globalOffset.dx - ev.deltaX)
    globalOffset.dy = clampOffset(globalOffset.dy - ev.deltaY)
    invalidateFrame()
  }

  function hitTest(x: number, y: number) {
    x -= globalOffset.dx
    y -= globalOffset.dy
    y /= scale
    x /= scale
    for (const node of nodes.values()) {
      if (isWithinBox(node, x, y)) {
        const regions = interactiveRegions.get(node.node.id) ?? []

        for (const region of regions) {
          if (isWithinRect(node, region.layout, x, y)) {
            return ["region", region] as const
          }
        }

        if (isWithinRect(node, node.dragbox, x, y)) {
          return ["node", node] as const
        }
      }
    }

    return ["none"] as const
  }

  return remotePort
}

function* additions(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
) {
  for (const key of Object.keys(next)) {
    if (!(key in prev)) yield key
  }
}

function* removals(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
) {
  for (const key of Object.keys(prev)) {
    if (!(key in next)) yield key
  }
}

function isWithinBox(box: VisualNode, x: number, y: number) {
  return (
    x >= box.dx &&
    x <= box.dx + box.bbox.width &&
    y >= box.dy &&
    y <= box.dy + box.bbox.height
  )
}

function isWithinRect({ dx, dy }: Offset2D, rect: Rect, x: number, y: number) {
  return (
    x >= dx + rect.x &&
    x <= dx + rect.x + rect.width &&
    y >= dy + rect.y &&
    y <= dy + rect.y + rect.height
  )
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

type DrawWidgetArgs = {
  ctx: CanvasRenderingContext2D
  offset: Offset2D
  scale: number
  widget: Widget
  abortSignal?: LightweightAbortSignal
}

function drawWidget({
  ctx,
  scale,
  offset: { dx, dy },
  widget,
  abortSignal,
}: DrawWidgetArgs) {
  if (widget.type === "box") {
    ctx.fillStyle = widget.bg
    ctx.fillRect(
      (dx + widget.layout.x) * scale,
      (dy + widget.layout.y) * scale,
      widget.layout.width * scale,
      widget.layout.height * scale,
    )
  } else if (widget.type === "icon") {
    drawIcon({
      ctx,
      name: widget.name,
      x: (dx + widget.layout.x) * scale,
      y: (dy + widget.layout.y) * scale,
      size: Math.min(widget.layout.width, widget.layout.height) * scale,
      signal: abortSignal,
    })
  } else if (widget.type === "text") {
    ctx.fillStyle = widget.color
    ctx.font = computeFont({
      family: widget.font.family,
      weight: widget.font.weight,
      size: widget.font.size * scale,
    })
    ctx.fillText(
      widget.text,
      (dx + widget.layout.x) * scale,
      (dy + widget.layout.y + widget.baseline) * scale,
    )
  } else if (widget.type === "ellipse") {
    ctx.fillStyle = widget.bg
    ctx.beginPath()
    ctx.ellipse(
      (dx + widget.layout.x + widget.layout.width / 2) * scale,
      (dy + widget.layout.y + widget.layout.height / 2) * scale,
      (widget.layout.width / 2) * scale,
      (widget.layout.height / 2) * scale,
      0,
      0,
      2 * Math.PI,
    )
    ctx.fill()
  }
}
