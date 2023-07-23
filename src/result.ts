export type Ok<T> = { ok: true; err: false; value: T } & ResultPrototype
export type Err<E> = { ok: false; err: true; error: E } & ResultPrototype

export type Result<T, E> = Ok<T> | Err<E>

type ResultPrototype = {
  mapErr<T, E, const E2>(
    this: Result<T, E>,
    fn: (error: E) => E2,
  ): Result<T, E2>
}

const ResultPrototype = {
  mapErr<T, E, const E2>(
    this: Result<T, E>,
    fn: (error: E) => E2,
  ): Result<T, E2> {
    if (this.ok) return this
    return Result.err(fn(this.error))
  },

  get ok(): boolean {
    return "value" in this
  },

  get err(): boolean {
    return "error" in this
  },

  [Symbol.toStringTag]: "Result",
}

export const Result = {
  ok<T>(value: T): Ok<T> {
    return Object.setPrototypeOf({ value }, ResultPrototype)
  },
  err<const E>(error: E): Err<E> {
    return Object.setPrototypeOf({ error }, ResultPrototype)
  },
  collectArray<T, E>(results: Iterable<Result<T, E>>) {
    const res: T[] = []
    for (const result of results) {
      if (!result.ok) return result
      res.push(result.value)
    }
    return Result.ok(res)
  },

  isOk<T>(value: Result<T, unknown>): value is Ok<T> {
    return value.ok
  },

  isErr<E>(value: Result<unknown, E>): value is Err<E> {
    return value.err
  },

  okValue<T>(value: Ok<T>): T {
    return value.value
  },
}

export default Result
