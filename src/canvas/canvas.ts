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
import {
  Action,
  NodeID,
  RecipeGraph,
  RecipeNode,
  canMerge,
  emptyGraph,
} from "../graph"

type ExistingExternalElement = ExternalElement & { element: HTMLElement }

type Offset2D = { dx: number; dy: number }

type Size = { width: number; height: number }

type VisualNode = Offset2D & {
  bbox: Size
  dragbox: Rect
  recipeNode: RecipeNode
  contents: Widget[]
  externalElements: ExistingExternalElement[]
}

type CanvasOutEvent = Action
type CanvasInEvent =
  | { type: "update-graph"; graph: RecipeGraph }
  | { type: "deinit" }

const LEVEL_OFFSET = 50
const MIN_NODE_SPACING = 20
const OFFSCREEN_OFFSET = 100

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
const LINE_WIDTH = 10
const LINE_COLOR = "#888888"

const MERGE_OVERLAY_COLOR = "#6fc6ff80"
const MERGE_BORDER_COLOR = "#6fc6ff"
const MERGE_BORDER_WIDTH = 4

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
  let graph = emptyGraph()
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

  let nodeToMergeWith: NodeID | undefined = undefined

  function draw() {
    ctx.clearRect(0, 0, cssWidth, cssHeight)

    for (const [fromVertex, toVertices] of graph.edges) {
      const fromBox = nodes.get(fromVertex)
      if (!fromBox) {
        console.warn("Missing node for vertex", fromVertex)
        continue
      }
      const start = {
        x: (globalOffset.dx + fromBox.dx + fromBox.bbox.width / 2) * scale,
        y: (globalOffset.dy + fromBox.dy + fromBox.bbox.height / 2) * scale,
      }
      for (const toVertex of toVertices) {
        const toBox = nodes.get(toVertex)
        if (!toBox) {
          console.warn("Missing node for vertex", toVertex)
          continue
        }
        const end = {
          x: (globalOffset.dx + toBox.dx + toBox.bbox.width / 2) * scale,
          y: (globalOffset.dy + toBox.dy + toBox.bbox.height / 2) * scale,
        }
        ctx.beginPath()
        ctx.moveTo(start.x, start.y)
        ctx.lineWidth = LINE_WIDTH * scale
        ctx.strokeStyle = LINE_COLOR
        ctx.lineTo(end.x, end.y)
        ctx.stroke()
      }
    }

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

      if (nodeToMergeWith === node.recipeNode.id) {
        ctx.fillStyle = MERGE_OVERLAY_COLOR
        ctx.fillRect(
          (globalOffset.dx + node.dx) * scale,
          (globalOffset.dy + node.dy) * scale,
          node.bbox.width * scale,
          node.bbox.height * scale
        )
        ctx.strokeStyle = MERGE_BORDER_COLOR
        ctx.lineWidth = MERGE_BORDER_WIDTH * scale
        ctx.strokeRect(
          (globalOffset.dx + node.dx) * scale,
          (globalOffset.dy + node.dy) * scale,
          node.bbox.width * scale,
          node.bbox.height * scale
        )
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
    globalOffset.dx = clampOffsetX(
      capturedGlobalOffset.dx - pointDelta.x / scale,
    )
    globalOffset.dy = clampOffsetY(
      capturedGlobalOffset.dy - pointDelta.y / scale,
    )
    invalidateFrame()
  }

  function handleGestureEnd(ev: webkit.GestureEvent) {
    ev.preventDefault()
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

  function updateGraph(newGraph: RecipeGraph) {
    const levelHeight = Array(newGraph.nodesOnLevel.length).fill(0)
    const levelWidth = Array(newGraph.nodesOnLevel.length).fill(
      -MIN_NODE_SPACING,
    )
    type LayoutNode = {
      node: RecipeNode
      bbox: { width: number; height: number }
      dragbox: Rect
      contents: Widget[]
    }
    const layoutNodes: LayoutNode[] = []
    graph = newGraph

    for (const node of newGraph.nodes.values()) {
      const level = newGraph.nodeDepth.get(node.id)!

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
    const nodesPlacedByLevel = Array(newGraph.nodesOnLevel.length).fill(0)
    for (const { node, bbox, contents, dragbox } of layoutNodes) {
      const level = newGraph.nodeDepth.get(node.id)!

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
        dx: -levelWidth[level] / 2 + horizontalOffset,
        dy: offset,
        bbox,
        recipeNode: node,
        dragbox,
        contents,
        externalElements: [],
      })
    }

    fullBBox =
      nodes.values().map(CornerRect.ofNode).reduceOpt(CornerRect.compose) ??
      CornerRect.EMPTY
    globalOffset.dx = cssWidth / 2 / scale
    globalOffset.dy = cssHeight / 2 / scale - fullBBox.height / 2
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

  function invalidateComposition(ofNode: VisualNode) {
    fullBBox = fullBBox.compose(CornerRect.ofNode(ofNode))
    invalidateFrame()
  }

  function invalidateLayout(ofNode: NodeID) {
    const visualNode = nodes.get(ofNode)
    if (!visualNode) return
    const { externalElements, bbox, contents } = layout.node({
      ctx,
      node: visualNode.recipeNode,
      focusedElement: focusedElement(ofNode),
    })
    updateExternalElements(ofNode, externalElements)
    visualNode.bbox = bbox
    visualNode.contents = contents
    invalidateComposition(visualNode)
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

    const region = regionHitTest(x, y)
    const [topHit, underHit] = [...hitChain(x, y)].reverse()

    let newCursor = cursor
    if (region) {
      newCursor = "pointer"
    } else if (topHit?.withinDragbox) {
      newCursor = "move"
    } else {
      newCursor = "auto"
    }

    const prevState = pointerStates.get(ev.pointerId)
    if (prevState) {
      prevState.box.dx = (x - prevState.anchor.x) / scale
      prevState.box.dy = (y - prevState.anchor.y) / scale
      newCursor = "move"

      if (
        underHit &&
        canMerge(prevState.box.recipeNode, underHit.node.recipeNode)
      ) {
        nodeToMergeWith = underHit.node.recipeNode.id
      } else {
        nodeToMergeWith = undefined
      }

      invalidateComposition(prevState.box)
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

    if (type === "node-dragbox") {
      pointerStates.set(ev.pointerId, {
        x,
        y,
        box,
        anchor: { x: x - box.dx * scale, y: y - box.dy * scale },
      })
    } else if (type === "region" && box.interactivity.click) {
      localPort.postMessage(box.interactivity.click)
    }
    nodeToMergeWith = undefined
  }

  function handlePointerUp(ev: PointerEvent) {
    pointerStates.delete(ev.pointerId)
  }

  function handleWheel(ev: WheelEvent) {
    ev.preventDefault()
    globalOffset.dx = clampOffsetX(globalOffset.dx - ev.deltaX)
    globalOffset.dy = clampOffsetY(globalOffset.dy - ev.deltaY)
    invalidateFrame()
  }

  function* hitChain(x: number, y: number) {
    y /= scale
    x /= scale
    x -= globalOffset.dx
    y -= globalOffset.dy
    for (const node of nodes.values()) {
      if (isWithinBox(node, x, y)) {
        const regions = interactiveRegions.get(node.recipeNode.id) ?? []

        yield {
          *regions() {
            for (const region of regions) {
              if (isWithinRect(node, region.layout, x, y)) {
                yield region
              }
            }
          },
          get withinDragbox() {
            return isWithinRect(node, node.dragbox, x, y)
          },
          node,
        }
      }
    }
  }

  function regionHitTest(x: number, y: number) {
    for (const hit of hitChain(x, y)) {
      for (const region of hit.regions()) {
        return region
      }
    }
  }

  function hitTest(x: number, y: number) {
    const { value: hitNode } = hitChain(x, y).next()
    if (!hitNode) return ["none"] as const
    const { value: region } = hitNode.regions().next()
    if (region) return ["region", region] as const
    if (hitNode.withinDragbox) return ["node-dragbox", hitNode.node] as const
    return ["node", hitNode.node] as const
  }

  let fullBBox: CornerRect = CornerRect.EMPTY
  function clampOffsetX(offset: number) {
    const min = -fullBBox.width + OFFSCREEN_OFFSET
    const max = fullBBox.width - OFFSCREEN_OFFSET + cssWidth / scale
    return Math.max(min, Math.min(max, offset))
  }
  function clampOffsetY(offset: number) {
    const min = -fullBBox.height + OFFSCREEN_OFFSET
    const max = cssHeight / scale - OFFSCREEN_OFFSET
    return Math.max(min, Math.min(max, offset))
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

type RectOrBox = { x?: number; y?: number; width: number; height: number }

function isWithinRect(
  { dx, dy }: Offset2D,
  { x = 0, y = 0, width, height }: RectOrBox,
  targetX: number,
  targetY: number,
) {
  return (
    targetX >= dx + x &&
    targetX <= dx + x + width &&
    targetY >= dy + y &&
    targetY <= dy + y + height
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
  mergeable?: boolean
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

class CornerRect {
  constructor(
    public readonly x1: number,
    public readonly y1: number,
    public readonly x2: number,
    public readonly y2: number,
  ) {}
  get x() {
    return this.x1
  }
  get y() {
    return this.y1
  }
  get width() {
    return this.x2 - this.x1
  }
  get height() {
    return this.y2 - this.y1
  }
  static fromRect(rect: Rect) {
    return new CornerRect(
      rect.x,
      rect.y,
      rect.x + rect.width,
      rect.y + rect.height,
    )
  }
  // Consumes the rect. aka modifies it's prototype
  static fromCornerRect(rect: {
    x1: number
    y1: number
    x2: number
    y2: number
  }): CornerRect {
    return Object.setPrototypeOf(rect, CornerRect.prototype)
  }
  compose(other: CornerRect) {
    return CornerRect.compose(this, other)
  }

  static compose(a: CornerRect, b: CornerRect) {
    return CornerRect.fromCornerRect({
      x1: Math.min(a.x1, b.x1),
      y1: Math.min(a.y1, b.y1),
      x2: Math.max(a.x2, b.x2),
      y2: Math.max(a.y2, b.y2),
    })
  }

  static ofNode(node: VisualNode) {
    return CornerRect.fromCornerRect({
      x1: node.dx,
      y1: node.dy,
      x2: node.dx + node.bbox.width,
      y2: node.dy + node.bbox.height,
    })
  }

  static EMPTY = new CornerRect(0, 0, 0, 0)
}

declare global {
  interface Iterator<T, TReturn = any, TNext = undefined> {
    reduceOpt(fn: (acc: T, item: T) => T): T | undefined
  }
}

// Yeah... I know, I know. Mutating the prototype of a built-in object is
// generally a bad idea. But screw it!
// Reduce as per spec throws if the iterator is empty and the default value is
// not provided. This is a convenience method that returns undefined instead.
Iterator.prototype.reduceOpt = function reduceOpt<T>(
  this: Iterator<T>,
  fn: (acc: T, item: T) => T,
) {
  const first = this.next()
  if (first.done) return undefined
  let res = first.value

  while (true) {
    const { value, done } = this.next()
    if (done) return res
    res = fn(res, value)
  }
}
