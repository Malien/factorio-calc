type Task = () => void | Promise<void>

const taskQueue: Task[] = []

export function scheduleTilDeadline<T>(
  task: () => T | Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const result = new Promise<T>((resolve, reject) => {
    taskQueue.push(() => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"))
        return
      }
      try {
        const res = task()
        if (res instanceof Promise) {
          return res
            .then(value => {
              if (signal?.aborted) {
                reject(new DOMException("Aborted", "AbortError"))
              } else resolve(value)
            })
            .catch(reject)
        }
        resolve(res)
      } catch (err) {
        reject(err)
      }
    })
  })

  reschedule()

  return result
}

const minTaskTimeMs = 5
const maxTaskTimeMs = 10

const requestIdleCallback: typeof window.requestIdleCallback | undefined =
  window.requestIdleCallback

let scheduleId: number | undefined
function reschedule() {
  if (scheduleId !== undefined) return
  if (requestIdleCallback) {
    scheduleId = requestIdleCallback(deadline =>
      runLoop(deadline.timeRemaining())
    )
  } else {
    scheduleId = setTimeout(() => runLoop(), 0)
  }
}

async function runLoop(deadline?: number) {
  scheduleId = undefined
  const start = performance.now()

  while (true) {
    if (shouldYield(start, deadline)) {
      reschedule()
      return
    }

    const nextTask = taskQueue.shift()
    if (!nextTask) return

    await nextTask()
  }
}

declare global {
  interface Navigator {
    scheduling?: {
      isInputPending(): boolean
    }
  }
}

function shouldYield(start: number, deadline?: number) {
  const now = performance.now()
  const diff = now - start

  if (diff < minTaskTimeMs) return false
  if (deadline !== undefined && diff > deadline) return true
  if (navigator.scheduling?.isInputPending()) return true
  return diff > maxTaskTimeMs
}
