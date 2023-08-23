export type Ok<T> = { ok: true; err: false; value: T } & ResultPrototype
export type Err<E> = { ok: false; err: true; error: E } & ResultPrototype

export type Result<T, E> = Ok<T> | Err<E>

export const cause = Symbol("cause")

type ResultPrototype = {
  mapErr<T, E, const E2>(
    this: Result<T, E>,
    fn: (error: E) => E2,
  ): Result<T, E2>

  context<T, E, CTX>(
    this: Result<T, E>,
    context: CTX,
  ): Result<T, CTX & { [cause]: E }>

  withContext<T, E, CTX>(
    this: Result<T, E>,
    fn: (error: E) => CTX,
  ): Result<T, CTX & { [cause]: E }>
}

const ResultPrototype = {
  get ok(): boolean {
    return "value" in this
  },

  get err(): boolean {
    return "error" in this
  },

  mapErr<T, E, const E2>(
    this: Result<T, E>,
    fn: (error: E) => E2,
  ): Result<T, E2> {
    if (this.ok) return this
    return Result.err(fn(this.error))
  },

  context<T, E, CTX>(
    this: Result<T, E>,
    context: CTX,
  ): Result<T, CTX & { [cause]: E }> {
    if (this.ok) return this
    return Result.err({ ...context, [cause]: this.error })
  },

  withContext<T, E, CTX>(
    this: Result<T, E>,
    fn: (error: E) => CTX,
  ): Result<T, CTX & { [cause]: E }> {
    if (this.ok) return this
    return Result.err({ ...fn(this.error), [cause]: this.error })
  },

  [Symbol.toStringTag]: "Result",
}

type ResultStatic = {
  void: Readonly<Ok<void>>

  ok(): Ok<void>
  ok<T>(value: T): Ok<T>

  err(): Err<void>
  err<const E>(error: E): Err<E>

  collectArray<T, E>(results: Iterable<Result<T, E>>): Result<T[], E>

  isOk<T>(value: Result<T, unknown>): value is Ok<T>

  isErr<E>(value: Result<unknown, E>): value is Err<E>

  okValue<T>(value: Ok<T>): T

  assertError: typeof assertError,

  cause: typeof cause,
}

const okVoid = Object.create(ResultPrototype)
okVoid.value = undefined

export const Result: ResultStatic = {
  void: Object.freeze(okVoid),

  ok<T>(value?: T) {
    const result = Object.create(ResultPrototype)
    result.value = value
    return result
  },
  err<const E>(error?: E) {
    const result = Object.create(ResultPrototype)
    result.error = error
    return result
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

  okValue<T>(value: Ok<T>) {
    return value.value
  },

  assertError,

  cause
}

/**
 * Screw you TypeScript. There is no reason for assertion functions to not work on
 * A) Arrow functions
 * B) As a method declaration
 * C) Refferring to `this` as the assertion target
 * Fuck you too :)
 */
export function assertError<E>(
  result: Result<unknown, E>,
): asserts result is Err<E> {
  if (!result.err) throw new Error("Expected error, got ok")
}

export default Result
