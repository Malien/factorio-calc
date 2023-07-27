import type { Action } from "../graph"

export type Rect = { x: number; y: number; width: number; height: number }
export type Color = string & { readonly $tag: unique symbol }
export type ComputedFont = string & { readonly $tag: unique symbol }

type WidgetKind =
  | { type: "icon"; name: string }
  | {
      type: "text"
      text: string
      color: Color
      font: Font
      baseline: number
    }
  | { type: "box"; bg: Color }
  | { type: "ellipse"; bg: Color }

export type Interactivity = {
  click?: Action
}

export type Widget = { layout: Rect; interactivity?: Interactivity } & WidgetKind

export type ExternalElement = {
  tag: "button"
  activate?: Action
  title?: string
}

export type Font = {
  family: string
  size: number
  weight: number
}

export function computeFont(font: Font) {
  return `${font.weight} ${font.size}px ${font.family}` as ComputedFont
}

