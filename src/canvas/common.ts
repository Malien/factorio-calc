import { RecipeNode } from "../graph";

export type Rect = { x: number; y: number; width: number; height: number }
export type Color = string & { readonly $tag: unique symbol }
export type ComputedFont = string & { readonly $tag: unique symbol }

export type Widget =
  | { type: "icon"; name: string; layout: Rect }
  | {
      type: "text"
      text: string
      color: Color
      font: ComputedFont
      baseline: number
      layout: Rect
    }
  | { type: "box"; bg: Color; layout: Rect }


export type VisualNode = {
  dx: number
  dy: number
  bbox: { width: number; height: number }
  node: RecipeNode
  contents: Widget[]
}

