export type Ok<T> = { readonly ok: true, readonly err: false, readonly value: T } & ResultPrototype;
export type Err<E> = { readonly ok: false, readonly err: true, readonly error: E } & ResultPrototype;

export type Result<T, E> = Ok<T> | Err<E>;

export const cause = Symbol("cause");

type CauseChain<E> = E extends { [cause]: infer E2 } ? E | CauseChain<E2> : E;

type OkPrototype = {
  readonly ok: true;
  readonly err: false;

  mapErr<T>(this: Ok<T>, fn: (error: never) => never): Ok<T>;

  context<T, E, const CTX>(this: Result<T, E>, ctx: CTX): Ok<T>;

  withContext<T, E, const CTX>(this: Result<T, E>, fn: () => CTX): Ok<T>;

  errorChain(this: Result<unknown, unknown>): Iterable<never>;
};

type ErrPrototype = {
  readonly ok: false;
  readonly err: true;

  mapErr<E, const E2>(this: Err<E>, fn: (error: E) => E2): Err<E2>;

  context<T, E, const CTX>(this: Result<T, E>, context: CTX): Err<CTX & { [cause]: E }>;

  withContext<E, const CTX>(
    this: Err<E>,
    fn: (error: E) => CTX,
  ): Err<CTX & { [cause]: E }>;

  errorChain<E>(this: Err<E>): Iterable<CauseChain<E>>;
};

type ResultPrototype = {
  mapErr<T, E, const E2>(
    this: Result<T, E>,
    fn: (error: E) => E2,
  ): Result<T, E2>;

  context<T, E, const CTX>(
    this: Result<T, E>,
    context: CTX,
  ): Result<T, CTX & { [cause]: E }>;

  withContext<T, E, const CTX>(
    this: Result<T, E>,
    fn: (error: E) => CTX,
  ): Result<T, CTX & { [cause]: E }>;

  errorChain<E>(this: Result<unknown, E>): Iterable<CauseChain<E>>;
};

const OkPrototype = Object.freeze({
  get ok(): true {
    return true;
  },

  get err(): false {
    return false;
  },

  mapErr<T, E, const E2>(this: Ok<T>, _fn: (error: E) => E2): Ok<T> {
    return this;
  },

  context<T>(this: Ok<T>): Ok<T> {
    return this;
  },

  withContext<T>(this: Ok<T>): Ok<T> {
    return this;
  },

  *errorChain(this: Ok<unknown>): Iterable<never> {
    return;
  },

  [Symbol.toStringTag]: "Result.Ok",
});

const ErrPrototype = Object.freeze({
  get ok(): false {
    return false;
  },
  get err(): true {
    return true;
  },

  mapErr<E, const E2>(this: Err<E>, fn: (error: E) => E2): Err<E2> {
    return Result.err(fn(this.error));
  },

  context<E, CTX>(this: Err<E>, context: CTX): Err<CTX & { [cause]: E }> {
    return Result.err({ ...context, [cause]: this.error });
  },

  withContext<E, CTX>(
    this: Err<E>,
    fn: (error: E) => CTX,
  ): Err<CTX & { [cause]: E }> {
    return Result.err({ ...fn(this.error), [cause]: this.error });
  },

  *errorChain<E>(this: Err<E>): Iterable<CauseChain<E>> {
    let error: unknown = this.error;
    yield error as CauseChain<E>;
    while (typeof error === "object" && error && cause in error) {
      error = error[cause];
      yield error as CauseChain<E>;
    }
  },

  [Symbol.toStringTag]: "Result.Err",
});

type ResultStatic = {
  readonly void: Ok<void>;

  ok(): Ok<void>;
  ok<T>(value: T): Ok<T>;

  err(): Err<void>;
  err<const E>(error: E): Err<E>;

  collectArray<T, E>(results: Iterable<Result<T, E>>): Result<T[], E>;

  isOk<T>(value: Result<T, unknown>): value is Ok<T>;

  isErr<E>(value: Result<unknown, E>): value is Err<E>;

  okValue<T>(value: Ok<T>): T;

  readonly assertError: typeof assertError;

  readonly cause: typeof cause;
};

const okVoid = Object.create(OkPrototype);
okVoid.value = undefined;

export const Result: ResultStatic = Object.freeze({
  void: Object.freeze(okVoid),

  ok<T>(value?: T) {
    const result = Object.create(OkPrototype);
    result.value = value;
    return result;
  },
  err<const E>(error?: E) {
    const result = Object.create(ErrPrototype);
    result.error = error;
    return result;
  },
  collectArray<T, E>(results: Iterable<Result<T, E>>) {
    const res: T[] = [];
    for (const result of results) {
      if (!result.ok) return result;
      res.push(result.value);
    }
    return Result.ok(res);
  },

  isOk<T>(value: Result<T, unknown>): value is Ok<T> {
    return value.ok;
  },

  isErr<E>(value: Result<unknown, E>): value is Err<E> {
    return value.err;
  },

  okValue<T>(value: Ok<T>) {
    return value.value;
  },

  assertError,

  cause,
});

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
  if (!result.err) throw new Error("Expected error, got ok");
}

export default Result;
