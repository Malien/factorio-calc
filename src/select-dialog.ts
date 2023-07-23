import { Recipe, recipes, recipeMap, recipeName, t, RecipeItem } from "./recipe"
import { iconForItem, iconNameForRecipe, prepareIconWithName } from "./icon"

function recipeButton(recipe: Recipe, signal?: AbortSignal) {
  const button = document.createElement("button")
  button.type = "submit"
  button.name = "recipeName"
  button.value = recipe.name
  button.className = "recipe-button"

  const iconName = iconNameForRecipe(recipe)
  prepareIconWithName(iconName, signal)
    .then(url => {
      const img = new Image()
      img.className = "recipe-icon"
      img.src = url
      img.alt = recipeName(recipe)
      img.onload = () => {
        button.append(img)
        const animation = img.animate({ opacity: [0, 1] }, { duration: 600 })
        signal?.addEventListener("abort", () => animation.cancel())
        animation.onfinish = () => {
          img.style.opacity = "1"
        }
      }
      button.append(img)
    })
    .catch(err => {
      if (err.name === "AbortError") return
      button.innerText = recipeName(recipe)
      console.error(err, recipe)
    })

  return button
}

export type SelectionDialogProps = {
  dialog: HTMLDialogElement
  onSelected(recipeName: string): void
}

export function initSelectionDialog({
  onSelected,
  dialog,
}: SelectionDialogProps) {
  const form = dialog.querySelector(".selection-form") as HTMLFormElement
  const modal = dialog.querySelector(".dialog-modal") as HTMLDivElement

  // Init dialog
  {
    const controller = new AbortController()

    dialog.addEventListener(
      "submit",
      ev => {
        ev.preventDefault()
        const data = new FormData(ev.target as HTMLFormElement)
        // iOS doesn't set the value of the submitter button this fixes that
        if (ev.submitter instanceof HTMLButtonElement && ev.submitter.name) {
          data.set(ev.submitter.name, ev.submitter.value)
        }
        const recipeName = data.get("recipeName") as string
        onSelected(recipeName)

        dialog.classList.add("hidden")
        function handleAnimationEnd(animationEvent: AnimationEvent) {
          if (
            animationEvent.animationName === "fade-out" &&
            animationEvent.target === dialog
          ) {
            dialog.close()
            controller.abort()
          }
          dialog.removeEventListener("animationend", handleAnimationEnd)
        }
        dialog.addEventListener("animationend", handleAnimationEnd)
      },
      { once: true },
    )
    form.append(
      ...recipes.map(recipe => recipeButton(recipe, controller.signal)),
    )
  }

  // Init tooltip
  {
    const tooltip = dialog.querySelector(".recipe-tooltip") as HTMLDivElement
    const title = tooltip.querySelector(".tooltip-title") as HTMLDivElement
    const ingredients = tooltip.querySelector(
      ".tooltip-ingredients-list",
    ) as HTMLDivElement
    const craftingTime = tooltip.querySelector(
      ".tooltip-crafting-time-value",
    ) as HTMLDivElement

    let currentRecipe: Recipe | undefined
    form.addEventListener("mouseenter", ev => {
      if (
        ev.target instanceof HTMLButtonElement &&
        ev.target.classList.contains("recipe-button")
      ) {
        const recipeName = ev.target.value
        updateTooltip(recipeMap.get(recipeName))
      }
      moveTooltip(ev)
    })
    form.addEventListener("mousemove", ev => {
      if (
        ev.target instanceof HTMLButtonElement &&
        ev.target.classList.contains("recipe-button")
      ) {
        const recipeName = ev.target.value
        updateTooltip(recipeMap.get(recipeName))
      }
      moveTooltip(ev)
    })
    form.addEventListener("mouseleave", () => {
      updateTooltip(undefined)
    })

    function moveTooltip(ev: MouseEvent) {
      const rect = modal.getBoundingClientRect()
      const tooltipRect = tooltip.getBoundingClientRect()

      let left = ev.clientX - rect.left + 8
      if (ev.clientX + tooltipRect.width + 24 > window.innerWidth) {
        left -= tooltipRect.width + 16
      }

      let top = ev.clientY - rect.top + 8
      if (ev.clientY + tooltipRect.height + 24 > window.innerHeight) {
        top -= tooltipRect.height + 16
      }

      tooltip.style.transform = `translate(${left}px, ${top}px)`
    }

    function updateTooltip(newRecipe?: Recipe) {
      if (newRecipe === currentRecipe) return
      currentRecipe = newRecipe

      if (!newRecipe) {
        tooltip.classList.add("hidden")
        return
      }

      tooltip.classList.remove("hidden")
      title.textContent = recipeName(newRecipe)
      craftingTime.textContent = `${newRecipe.energyRequired}s`

      ingredients.innerHTML = ""
      ingredients.append(
        ...newRecipe.ingredients.map(ingredient),
      )
    }
  }
}

function ingredient(ingredient: RecipeItem) {
  const container = document.createElement("div")
  container.classList.add("tooltip-ingredient")

  const amount = document.createElement("span")
  amount.classList.add("tooltip-ingredient-amount")
  amount.textContent = `${ingredient.amount} x`

  const name = document.createElement("span")
  name.classList.add("tooltip-ingredient-name")
  name.textContent = t(ingredient.name) ?? ingredient.name

  iconForItem(ingredient.name, ingredient.type)
    .then(iconURL => {
      const icon = document.createElement("img")
      icon.classList.add("tooltip-ingredient-icon")
      icon.src = iconURL
      container.prepend(icon)
    })
    .catch(console.error)

  container.append(amount, name)
  return container
}
