import { RecipeNode, RootNode, TerminalNode, assemblerCount } from "../graph"
import { iconNameForRecipe } from "../icon"
import { t } from "../recipe"
import { recipeName } from "../recipe"
import {
  Color,
  ComputedFont,
  ExternalElement,
  Font,
  Rect,
  Widget,
  computeFont,
} from "./common"

const BOX_PADDING = 8
const BOX_CONTENT_MARGIN = 8
const BOX_CONTENT_PADDING = 8
const ICON_MARGIN = 12
const ICON_SIZE = 28
const BUTTON_MARGIN = 12
const BUTTON_PADDING = 4
const REQUIRED_AMOUNT_MARGIN = 24
const EXPAND_BUTTON_SIZE = 24
const EXPAND_BUTTON_MARGIN = 4
const TERMINAL_BOX_BOTTOM_PADDING = 4

const TITLE_FONT = {
  family: "sans-serif",
  size: 18,
  weight: 600,
}
const BODY_FONT = {
  family: "sans-serif",
  size: 14,
  weight: 600,
}
const REQUIRED_AMOUNT_FONT = {
  family: "sans-serif",
  size: 14,
  weight: 600,
}

const LINE_SPACING = 1.5

const BOX_BG = "#313131" as Color
const BODY_BG = "#404040" as Color
const BUTTON_BG = "#606060" as Color
const TITLE_COLOR = "rgb(255, 231, 190)" as Color
const TEXT_COLOR = "white" as Color
const REQUIRED_AMOUNT_COLOR = "#ccc" as Color
const FOCUS_COLOR = "#005fdf" as Color

const computedFonts = {
  title: computeFont(TITLE_FONT),
  body: computeFont(BODY_FONT),
  requiredAmount: computeFont(REQUIRED_AMOUNT_FONT),
}

function text(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: Font | ComputedFont,
) {
  font = typeof font === "string" ? font : computeFont(font)
  const prevFont = ctx.font
  ctx.font = font
  const { width, actualBoundingBoxAscent, actualBoundingBoxDescent } =
    ctx.measureText(text)
  ctx.font = prevFont
  return {
    width,
    height: actualBoundingBoxAscent + actualBoundingBoxDescent,
    baseline: actualBoundingBoxAscent,
  }
}

const numberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
})

function lineMargin(font: Font) {
  return font.size * (LINE_SPACING - 1)
}

type LayoutResult = {
  bbox: { width: number; height: number }
  dragbox: Rect
  externalElements: Record<string, ExternalElement>
  contents: Widget[]
}

export function rootBox(
  ctx: CanvasRenderingContext2D,
  node: RootNode,
): LayoutResult {
  const name = recipeName(node.recipe)
  const titleMeasures = text(ctx, name, computedFonts.title)
  const headerHeight = Math.max(titleMeasures.height, ICON_SIZE)
  const headerWidth = ICON_SIZE + ICON_MARGIN + titleMeasures.width

  const productionLine = `Desired production rate: ${node.desiredProduction} per second`
  const productionLineMeasures = text(ctx, productionLine, computedFonts.body)

  const craftingTime = `Crafting time: ${node.recipe.energyRequired}s`
  const craftingTimeMeasures = text(ctx, craftingTime, computedFonts.body)

  const assemblersRequired = `Assemblers required: ${numberFormat.format(
    assemblerCount(node.recipe, node.desiredProduction, node.assemblerTier),
  )}`
  const assemblersRequiredMeasures = text(
    ctx,
    assemblersRequired,
    computedFonts.body,
  )

  const assemblerLineHeight = Math.max(
    BUTTON_PADDING * 2 + ICON_SIZE,
    assemblersRequiredMeasures.height,
  )
  const assemblerLineWidth =
    BUTTON_PADDING * 2 +
    ICON_SIZE +
    BUTTON_MARGIN +
    assemblersRequiredMeasures.width

  const bodyWidth =
    BOX_CONTENT_PADDING * 2 +
    Math.max(
      productionLineMeasures.width,
      craftingTimeMeasures.width,
      assemblerLineWidth,
    )
  const bodyHeight =
    BOX_CONTENT_PADDING * 2 +
    productionLineMeasures.height +
    lineMargin(BODY_FONT) +
    craftingTimeMeasures.height +
    lineMargin(BODY_FONT) +
    assemblerLineHeight

  const bbox = {
    width: BOX_PADDING * 2 + Math.max(headerWidth, bodyWidth),
    height: BOX_PADDING * 2 + headerHeight + BOX_CONTENT_MARGIN + bodyHeight,
  }

  return {
    bbox,
    dragbox: { x: 0, y: 0, width: bbox.width, height: headerHeight },
    externalElements: {},
    contents: [
      {
        type: "box",
        bg: BOX_BG,
        layout: {
          x: 0,
          y: 0,
          width: bbox.width,
          height: bbox.height,
        },
      },
      {
        type: "box",
        bg: BODY_BG,
        layout: {
          x: BOX_PADDING,
          y: BOX_PADDING + headerHeight + BOX_CONTENT_MARGIN,
          width: bodyWidth,
          height: bodyHeight,
        },
      },
      {
        type: "icon",
        name: iconNameForRecipe(node.recipe),
        layout: {
          x: BOX_PADDING,
          y: BOX_PADDING + headerHeight / 2 - ICON_SIZE / 2,
          width: ICON_SIZE,
          height: ICON_SIZE,
        },
      },
      {
        type: "text",
        text: name,
        font: TITLE_FONT,
        color: TITLE_COLOR,
        baseline: titleMeasures.baseline,
        layout: {
          x: BOX_PADDING + ICON_SIZE + ICON_MARGIN,
          y: BOX_PADDING + headerHeight / 2 - titleMeasures.height / 2,
          width: titleMeasures.width,
          height: titleMeasures.height,
        },
      },
      {
        type: "text",
        text: productionLine,
        font: BODY_FONT,
        color: TEXT_COLOR,
        baseline: productionLineMeasures.baseline,
        layout: {
          x: BOX_PADDING + BOX_CONTENT_PADDING,
          y:
            BOX_PADDING +
            headerHeight +
            BOX_CONTENT_MARGIN +
            BOX_CONTENT_PADDING,
          width: productionLineMeasures.width,
          height: productionLineMeasures.height,
        },
      },
      {
        type: "text",
        text: craftingTime,
        font: BODY_FONT,
        color: TEXT_COLOR,
        baseline: craftingTimeMeasures.baseline,
        layout: {
          x: BOX_PADDING + BOX_CONTENT_PADDING,
          y:
            BOX_PADDING +
            headerHeight +
            BOX_CONTENT_MARGIN +
            BOX_CONTENT_PADDING +
            productionLineMeasures.height +
            lineMargin(BODY_FONT),
          width: craftingTimeMeasures.width,
          height: craftingTimeMeasures.height,
        },
      },
      {
        type: "box",
        bg: BUTTON_BG,
        layout: {
          x: BOX_PADDING + BOX_CONTENT_PADDING,
          y:
            BOX_PADDING +
            headerHeight +
            BOX_CONTENT_MARGIN +
            BOX_CONTENT_PADDING +
            productionLineMeasures.height +
            lineMargin(BODY_FONT) +
            craftingTimeMeasures.height +
            lineMargin(BODY_FONT) +
            assemblerLineHeight / 2 -
            (BUTTON_PADDING * 2 + ICON_SIZE) / 2,
          width: BUTTON_PADDING * 2 + ICON_SIZE,
          height: BUTTON_PADDING * 2 + ICON_SIZE,
        },
      },
      {
        type: "icon",
        name: `assembling-machine-${node.assemblerTier}`,
        layout: {
          x: BOX_PADDING + BOX_CONTENT_PADDING + BUTTON_PADDING,
          y:
            BOX_PADDING +
            headerHeight +
            BOX_CONTENT_MARGIN +
            BOX_CONTENT_PADDING +
            productionLineMeasures.height +
            lineMargin(BODY_FONT) +
            craftingTimeMeasures.height +
            lineMargin(BODY_FONT) +
            assemblerLineHeight / 2 -
            (BUTTON_PADDING * 2 + ICON_SIZE) / 2 +
            BUTTON_PADDING,
          width: ICON_SIZE,
          height: ICON_SIZE,
        },
      },
      {
        type: "text",
        text: assemblersRequired,
        font: BODY_FONT,
        color: TEXT_COLOR,
        baseline: assemblersRequiredMeasures.baseline,
        layout: {
          x:
            BOX_PADDING +
            BOX_CONTENT_PADDING +
            BUTTON_PADDING * 2 +
            ICON_SIZE +
            BUTTON_MARGIN,
          y:
            BOX_PADDING +
            headerHeight +
            BOX_CONTENT_MARGIN +
            BOX_CONTENT_PADDING +
            productionLineMeasures.height +
            lineMargin(BODY_FONT) +
            craftingTimeMeasures.height +
            lineMargin(BODY_FONT) +
            assemblerLineHeight / 2 -
            assemblersRequiredMeasures.height / 2,
          width: assemblersRequiredMeasures.width,
          height: assemblersRequiredMeasures.height,
        },
      },
    ],
  }
}

type TerminalBoxProps = {
  ctx: CanvasRenderingContext2D
  node: TerminalNode
  focusedElement?: string
}

export function terminalBox({
  ctx,
  node,
  focusedElement,
}: TerminalBoxProps): LayoutResult {
  const name = t(node.itemName) ?? node.itemName
  const nameMeasures = text(ctx, name, computedFonts.title)

  const requiredAmountText = `${numberFormat.format(node.requiredAmount)}/s`
  const requiredAmountMeasures = text(
    ctx,
    requiredAmountText,
    computedFonts.requiredAmount,
  )

  const lineHeight = Math.max(
    nameMeasures.height,
    requiredAmountMeasures.height,
    ICON_SIZE,
  )

  const iconName =
    node.itemType === "fluid" ? `fluid/${node.itemName}` : node.itemName

  if (node.producedByRecipes.length === 1) {
    return expandableTerminalBox()
  } else return nonExpandableTerminalBox()

  function expandableTerminalBox(): LayoutResult {
    const expandPlusMeasures = text(ctx, "+", computedFonts.body)

    const dragbox = {
      x: 0,
      y: 0,
      width:
        BOX_PADDING * 2 +
        ICON_SIZE +
        ICON_MARGIN +
        nameMeasures.width +
        REQUIRED_AMOUNT_MARGIN +
        requiredAmountMeasures.width,
      height: BOX_PADDING * 2 + lineHeight + TERMINAL_BOX_BOTTOM_PADDING,
    }

    const bbox = {
      width: dragbox.width,
      height: dragbox.height + EXPAND_BUTTON_MARGIN + EXPAND_BUTTON_SIZE / 2,
    }

    return {
      dragbox,
      bbox,
      externalElements: {
        expand: {
          tag: "button",
          activate: { type: "expand", node: node.id },
          title: "expand recipe",
        },
      },
      contents: [
        {
          type: "box",
          bg: BOX_BG,
          layout: {
            x: 0,
            y: 0,
            width: dragbox.width,
            height: dragbox.height,
          },
        },
        {
          type: "icon",
          name: iconName,
          layout: {
            x: BOX_PADDING,
            y: BOX_PADDING + lineHeight / 2 - ICON_SIZE / 2,
            width: ICON_SIZE,
            height: ICON_SIZE,
          },
        },
        {
          type: "text",
          text: name,
          font: TITLE_FONT,
          color: TITLE_COLOR,
          baseline: nameMeasures.baseline,
          layout: {
            x: BOX_PADDING + ICON_SIZE + ICON_MARGIN,
            y: BOX_PADDING + lineHeight / 2 - nameMeasures.height / 2,
            width: nameMeasures.width,
            height: nameMeasures.height,
          },
        },
        {
          type: "text",
          text: requiredAmountText,
          font: REQUIRED_AMOUNT_FONT,
          color: REQUIRED_AMOUNT_COLOR,
          baseline: requiredAmountMeasures.baseline,
          layout: {
            x:
              BOX_PADDING +
              ICON_SIZE +
              ICON_MARGIN +
              nameMeasures.width +
              REQUIRED_AMOUNT_MARGIN,
            y: BOX_PADDING,
            width: requiredAmountMeasures.width,
            height: requiredAmountMeasures.height,
          },
        },
        {
          type: "ellipse",
          bg: focusedElement === "expand" ? FOCUS_COLOR : BOX_BG,
          layout: {
            x:
              dragbox.width / 2 - EXPAND_BUTTON_SIZE / 2 - EXPAND_BUTTON_MARGIN,
            y: dragbox.height - EXPAND_BUTTON_SIZE / 2 - EXPAND_BUTTON_MARGIN,
            width: EXPAND_BUTTON_SIZE + EXPAND_BUTTON_MARGIN * 2,
            height: EXPAND_BUTTON_SIZE + EXPAND_BUTTON_MARGIN * 2,
          },
        },
        {
          type: "ellipse",
          bg: BUTTON_BG,
          layout: {
            x: dragbox.width / 2 - EXPAND_BUTTON_SIZE / 2,
            y: dragbox.height - EXPAND_BUTTON_SIZE / 2,
            width: EXPAND_BUTTON_SIZE,
            height: EXPAND_BUTTON_SIZE,
          },
          interactivity: {
            click: { type: "expand", node: node.id },
          },
        },
        {
          type: "text",
          text: "+",
          font: BODY_FONT,
          color: TEXT_COLOR,
          baseline: expandPlusMeasures.baseline,
          layout: {
            x: dragbox.width / 2 - expandPlusMeasures.width / 2,
            y: dragbox.height - expandPlusMeasures.height / 2,
            width: expandPlusMeasures.width,
            height: expandPlusMeasures.height,
          },
        },
      ],
    }
  }

  function nonExpandableTerminalBox(): LayoutResult {
    const bbox = {
      width:
        BOX_PADDING * 2 +
        ICON_SIZE +
        ICON_MARGIN +
        nameMeasures.width +
        REQUIRED_AMOUNT_MARGIN +
        requiredAmountMeasures.width,
      height: BOX_PADDING * 2 + lineHeight,
    }

    return {
      dragbox: { x: 0, y: 0, width: bbox.width, height: bbox.height },
      bbox,
      externalElements: {
        expand: {
          tag: "button",
          activate: { type: "expand", node: node.id },
          title: "expand recipe",
        },
      },
      contents: [
        {
          type: "box",
          bg: BOX_BG,
          layout: {
            x: 0,
            y: 0,
            width: bbox.width,
            height: bbox.height,
          },
        },
        {
          type: "icon",
          name: iconName,
          layout: {
            x: BOX_PADDING,
            y: BOX_PADDING + lineHeight / 2 - ICON_SIZE / 2,
            width: ICON_SIZE,
            height: ICON_SIZE,
          },
        },
        {
          type: "text",
          text: name,
          font: TITLE_FONT,
          color: TITLE_COLOR,
          baseline: nameMeasures.baseline,
          layout: {
            x: BOX_PADDING + ICON_SIZE + ICON_MARGIN,
            y: BOX_PADDING + lineHeight / 2 - nameMeasures.height / 2,
            width: nameMeasures.width,
            height: nameMeasures.height,
          },
        },
        {
          type: "text",
          text: requiredAmountText,
          font: REQUIRED_AMOUNT_FONT,
          color: REQUIRED_AMOUNT_COLOR,
          baseline: requiredAmountMeasures.baseline,
          layout: {
            x:
              BOX_PADDING +
              ICON_SIZE +
              ICON_MARGIN +
              nameMeasures.width +
              REQUIRED_AMOUNT_MARGIN,
            y: BOX_PADDING,
            width: requiredAmountMeasures.width,
            height: requiredAmountMeasures.height,
          },
        },
      ],
    }
  }
}

type LayoutNodeArgs = {
  ctx: CanvasRenderingContext2D
  node: RecipeNode
  focusedElement?: string
}

export function node({ ctx, node, focusedElement }: LayoutNodeArgs) {
  switch (node.type) {
    case "root":
      return rootBox(ctx, node)
    case "terminal":
      return terminalBox({ ctx, node, focusedElement })
    case "intermediate":
      return terminalBox({
        ctx,
        node: {
          type: "terminal",
          id: node.id,
          itemName: node.recipe.results[0].name,
          itemType: node.recipe.results[0].type,
          requiredAmount: node.desiredProduction,
          producedByRecipes: [],
        },
        focusedElement,
      })
  }
}
