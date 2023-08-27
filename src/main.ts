import "./style.css";
import "@malien/iterator-polyfill";
import { initCanvas } from "./canvas";
import { initSelectionDialog } from "./select-dialog";
import { recipeMap } from "./recipe";
import {
  NodeID,
  RecipeGraph,
  collapseNode,
  expandNode,
  initialGraph,
  mergeNodes,
} from "./graph";
import Result from "./result";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const selectionDialog = document.getElementById(
  "selection-dialog",
) as HTMLDialogElement;

let globalGraph: RecipeGraph | undefined;

const canvasPort = initCanvas(canvas);
initSelectionDialog({
  dialog: selectionDialog,
  onSelected(recipeName) {
    const recipe = recipeMap.get(recipeName);
    if (!recipe) {
      console.error("Selected recipe not found", recipeName);
      return;
    }
    globalGraph = initialGraph(recipe);
    console.info("Selected recipe", recipe);
    canvasPort.postMessage({ type: "update-graph", graph: globalGraph });
  },
});

canvasPort.addEventListener("message", (event) => {
  console.info("Received message from canvas", event.data);
  if (!globalGraph) {
    console.error("Graph not initialized");
    return;
  }

  switch (event.data.type) {
    case "expand":
      return handle(expand, globalGraph, event.data.node);
    case "collapse":
      return handle(collapse, globalGraph, event.data.node);
    case "merge":
      return handle(merge, globalGraph, event.data.node, event.data.with);
  }
});

function handle<
  Fn extends (graph: RecipeGraph, ...args: any[]) => Result<void, unknown>,
>(
  fn: Fn,
  graph: RecipeGraph,
  ...args: Fn extends (
    graph: RecipeGraph,
    ...args: infer Args
  ) => Result<void, unknown>
    ? Args
    : never
) {
  try {
    const backupGraph = structuredClone(graph);
    const res = fn(graph, ...args);
    if (res.err) {
      console.error("Failed to handle event", {
        name: fn.name,
        error: res.error,
        graph,
      });

      for (const cause of res.errorChain()) {
        if (
          typeof cause === "object" &&
          cause &&
          "kind" in cause &&
          cause.kind === "inconsistent-graph"
        ) {
          console.error(
            "Encountered graph inconsistency. " +
              "Operation may have left graph in an even worse state. " +
              "Restoring backup graph.",
            cause,
          );
          globalGraph = backupGraph;
          // canvasPort.postMessage({ type: "update-graph", graph });
          break;
        }
      }
    }
  } catch (error) {
    console.error("Failed to handle event", { name: fn.name, error, graph });
  }
}

function expand(graph: RecipeGraph, nodeID: NodeID) {
  const res = expandNode(graph, nodeID).context({ node: nodeID });
  if (res.err) return res;
  canvasPort.postMessage({ type: "update-graph", graph });
  return Result.void;
}

function collapse(graph: RecipeGraph, node: NodeID) {
  const res = collapseNode(graph, node).context({ node });
  if (res.err) return res;
  canvasPort.postMessage({ type: "update-graph", graph });
  return Result.void;
}

function merge(graph: RecipeGraph, node: NodeID, withNode: NodeID) {
  const res = mergeNodes(graph, node, withNode).context({
    node,
    with: withNode,
  });
  if (res.err) return res;
  canvasPort.postMessage({ type: "update-graph", graph });
  return Result.void;
}

// Markup includes dialog element already shown, we have to reopen it
// so it becomes modal, and also draws ::backdrop pseudo-element
selectionDialog.close();
selectionDialog.showModal();
