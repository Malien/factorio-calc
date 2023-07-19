import "./style.css"
import { initCanvas } from "./canvas"
import { initSelectionDialog } from "./select-dialog"
import { recipeMap } from "./recipe"
import { initialGraph } from "./graph"

const canvas = document.getElementById("canvas") as HTMLCanvasElement
const selectionDialog = document.getElementById(
  "selection-dialog"
) as HTMLDialogElement

const canvasPort = initCanvas(canvas)
initSelectionDialog({
  dialog: selectionDialog,
  onSelected(recipeName) {
    const recipe = recipeMap.get(recipeName)
    if (!recipe) {
      console.error("Selected recipe not found", recipeName)
      return
    }
    console.info("Selected recipe", recipe)
    canvasPort.postMessage({ type: "update-graph", graph: initialGraph(recipe) })
  },
})

canvasPort.addEventListener("message", event => {
  console.log("Received message from canvas", event.data)
})
// Markup includes dialog element already shown, we have to reopen it
// so it becomes modal, and also draws ::backdrop pseudo-element
selectionDialog.close()
selectionDialog.showModal()
