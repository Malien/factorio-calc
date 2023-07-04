export function initCanvas(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!

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

  const boxes = [
    { x: 0, y: 0, width: 100, height: 100, fill: "red" },
    { x: 150, y: 150, width: 75, height: 75, fill: "green" },
  ]

  let frameInvalidated = false
  revalidateSize()

  function draw() {
    ctx.clearRect(0, 0, cssWidth, cssHeight)

    for (const box of boxes) {
      ctx.fillStyle = box.fill
      ctx.fillRect(box.x, box.y, box.width, box.height)
    }
  }

  window.addEventListener("resize", () => {
    revalidateSize()
  })

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
    box: typeof boxes[number]
    anchor: { x: number; y: number }
  }
  const pointerStates = new Map<number, PointerState>()
  let cursor = "auto"

  canvas.addEventListener("pointermove", ev => {
    const boxId = hitTest(ev.x, ev.y)
    let newCursor = cursor

    if (boxId !== undefined) {
      newCursor = "move"
    } else {
      newCursor = "auto"
    }

    const prevState = pointerStates.get(ev.pointerId)
    if (prevState) {
      prevState.box.x = ev.x - prevState.anchor.x
      prevState.box.y = ev.y - prevState.anchor.y
      newCursor = "move"
      invalidateFrame()
    }

    if (newCursor !== cursor) {
      cursor = newCursor
      canvas.style.cursor = cursor
    }
  })

  // type BoxID = number & { readonly $tag: unique symbol }
  // type Rect = { x: number; y: number; width: number; height: number }

  function hitTest(x: number, y: number) {
    for (const box of boxes) {
      if (
        x > box.x &&
        x < box.x + box.width &&
        y > box.y &&
        y < box.y + box.height
      ) {
        return box
      }
    }
  }

  canvas.addEventListener("pointerdown", ev => {
    const box = hitTest(ev.x, ev.y)

    if (box) {
      pointerStates.set(ev.pointerId, {
        x: ev.x,
        y: ev.y,
        box,
        anchor: { x: ev.x - box.x, y: ev.y - box.y },
      })
    }
  })

  canvas.addEventListener("pointerup", ev => {
    pointerStates.delete(ev.pointerId)
  })
}

