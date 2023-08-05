export type NonEmpty<T> = [T, ...T[]]
export function nonEmpty<T>(arr: T[]): arr is NonEmpty<T> {
  return arr.length > 0
}

