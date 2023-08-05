import type { Item, Recipe } from "./recipe";
import type { NonEmpty } from "./util";

export type Machine =
  | { type: "assembly-machine"; tier: 1 | 2 | 3 }
  | { type: "furnace"; tier: 1 | 2 | 3 }
  | { type: "chemical-plant" }

export function madeIn(recipe: Recipe): NonEmpty<Machine> {
  switch (recipe.category) {
    case "crafting":
      return [
        { type: "assembly-machine", tier: 1 },
        { type: "assembly-machine", tier: 2 },
        { type: "assembly-machine", tier: 3 },
      ]
    case "crafting-with-fluid":
      return [
        { type: "assembly-machine", tier: 2 },
        { type: "assembly-machine", tier: 3 },
      ]
    case "smelting":
      return [
        { type: "furnace", tier: 1 },
        { type: "furnace", tier: 2 },
        { type: "furnace", tier: 3 },
      ]
    case "chemistry":
      return [{ type: "chemical-plant" }]
  }
}

export function craftingSpeed(machine: Machine) {
  switch (machine.type) {
    case "assembly-machine":
      return machine.tier
    case "furnace":
      return Math.max(2, machine.tier)
    case "chemical-plant":
      return 1
  }
}

export function machineName(machine: Machine) {
  switch (machine.type) {
    case "assembly-machine":
      switch (machine.tier) {
        case 1:
          return "Basic Assembling Machines"
        case 2:
          return "Assembling Machines"
        case 3:
          return "Advanced Assembling Machines"
      }
    case "furnace":
      switch (machine.tier) {
        case 1:
          return "Stone Furnaces"
        case 2:
          return "Steel Furnaces"
        case 3:
          return "Electric Furnaces"
      }
    case "chemical-plant":
      return "Chemical Plants"
  }
}


export function machineItem(machine: Machine): Item {
  switch (machine.type) {
    case "assembly-machine":
      return {
        name: `assembling-machine-${machine.tier}`,
        type: "item",
      }
    case "furnace":
      switch (machine.tier) {
        case 1:
          return { name: "stone-furnace", type: "item" }
        case 2:
          return { name: "steel-furnace", type: "item" }
        case 3:
          return { name: "electric-furnace", type: "item" }
      }
    case "chemical-plant":
      return { name: "chemical-plant", type: "item" }
  }
}

export function machineCount(
  recipe: Recipe,
  desiredProduction: number,
  machine: Machine,
) {
  const craftingTime = recipe.energyRequired
  const resultCount = recipe.results[0].amount
  return (craftingTime * desiredProduction) / resultCount / craftingSpeed(machine)
}

