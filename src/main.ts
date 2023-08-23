import "./style.css"
import "iterator-polyfill"
import { initCanvas } from "./canvas"
import { initSelectionDialog } from "./select-dialog"
import { recipeMap } from "./recipe"
import { NodeID, RecipeGraph, collapseNode, expandNode, initialGraph, mergeNodes } from "./graph"
import Result from "./result"

const canvas = document.getElementById("canvas") as HTMLCanvasElement
const selectionDialog = document.getElementById(
  "selection-dialog",
) as HTMLDialogElement

let graph: RecipeGraph | undefined

const canvasPort = initCanvas(canvas)
initSelectionDialog({
  dialog: selectionDialog,
  onSelected(recipeName) {
    const recipe = recipeMap.get(recipeName)
    if (!recipe) {
      console.error("Selected recipe not found", recipeName)
      return
    }
    graph = initialGraph(recipe)
    console.info("Selected recipe", recipe)
    canvasPort.postMessage({ type: "update-graph", graph })
  },
})

canvasPort.addEventListener("message", event => {
  console.info("Received message from canvas", event.data)
  if (!graph) {
    console.error("Graph not initialized")
    return
  }

  switch (event.data.type) {
    case "expand":
      return handle(expand, graph, event.data.node)
    case "collapse":
      return handle(collapse, graph, event.data.node)
    case "merge":
      return handle(merge, graph, event.data.node, event.data.with)
  }
})

function handle<T extends (...args: any[]) => Result<void, unknown>>(
  fn: T,
  ...args: Parameters<T>
) {
  try {
    const res = fn(...args)
    if (res.err) {
      console.error("Failed to handle event", { name: fn.name, error: res.error, graph})
    }
  } catch (error) {
    console.error("Failed to handle event", { name: fn.name, error, graph })
  }
}

function expand(graph: RecipeGraph, nodeID: NodeID) {
  const res = expandNode(graph, nodeID).context({ node: nodeID })
  if (res.err) return res
  canvasPort.postMessage({ type: "update-graph", graph })
  return Result.void
}

function collapse(graph: RecipeGraph, node: NodeID) {
  const res = collapseNode(graph, node).context({ node })
  if (res.err) return res
  canvasPort.postMessage({ type: "update-graph", graph })
  return Result.void
}

function merge(graph: RecipeGraph, node: NodeID, withNode: NodeID) {
  const res = mergeNodes(graph, node, withNode).context({ node, with: withNode })
  if (res.err) return res
  canvasPort.postMessage({ type: "update-graph", graph })
  return Result.void
}

// Markup includes dialog element already shown, we have to reopen it
// so it becomes modal, and also draws ::backdrop pseudo-element
selectionDialog.close()
selectionDialog.showModal()
