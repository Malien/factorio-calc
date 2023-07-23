import "./style.css"
import "iterator-polyfill"
import { initCanvas } from "./canvas"
import { initSelectionDialog } from "./select-dialog"
import { recipeMap, recipesForResult } from "./recipe"
import { RecipeGraph, expandNode, initialGraph } from "./graph"

const canvas = document.getElementById("canvas") as HTMLCanvasElement
const selectionDialog = document.getElementById(
  "selection-dialog"
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
  console.log("Received message from canvas", event.data)
  if (!graph) {
    console.error("Graph not initialized")
    return
  }
  const node = graph.nodes.get(event.data.node)
  if (!node || node.type !== "terminal") {
    console.error("Invalid node ID", event.data.node)
    return
  }

  const recipe = recipesForResult(node.itemType, node.itemName)
  if (recipe.length !== 1) {
    console.error("Multiple or none recipes found for", node.itemType, node.itemName)
    return
  }

  if (event.data.type === "expand") {
    expandNode(graph, event.data.node, recipe[0]!)
    canvasPort.postMessage({ type: "update-graph", graph })
  }
})
// Markup includes dialog element already shown, we have to reopen it
// so it becomes modal, and also draws ::backdrop pseudo-element
selectionDialog.close()
selectionDialog.showModal()
