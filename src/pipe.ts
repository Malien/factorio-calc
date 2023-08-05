type AnyFn = (...args: any[]) => any

export function pipe<T1, R>(fn1: (arg: T1) => R): (arg: T1) => R
export function pipe<T1, T2, R>(
  fn1: (arg: T1) => T2,
  fn2: (arg: T2) => R,
): (arg: T1) => R
export function pipe<T1, T2, T3, R>(
  fn1: (arg: T1) => T2,
  fn2: (arg: T2) => T3,
  fn3: (arg: T3) => R,
): (arg: T1) => R
export function pipe<T1, T2, T3, T4, R>(
  fn1: (arg: T1) => T2,
  fn2: (arg: T2) => T3,
  fn3: (arg: T3) => T4,
  fn4: (arg: T4) => R,
): (arg: T1) => R
export function pipe<T1, T2, T3, T4, T5, R>(
  fn1: (arg: T1) => T2,
  fn2: (arg: T2) => T3,
  fn3: (arg: T3) => T4,
  fn4: (arg: T4) => T5,
  fn5: (arg: T5) => R,
): (arg: T1) => R
export function pipe<T1, T2, T3, T4, T5, T6, R>(
  fn1: (arg: T1) => T2,
  fn2: (arg: T2) => T3,
  fn3: (arg: T3) => T4,
  fn4: (arg: T4) => T5,
  fn5: (arg: T5) => T6,
  fn6: (arg: T6) => R,
): (arg: T1) => R
export function pipe<T1, T2, T3, T4, T5, T6, T7, R>(
  fn1: (arg: T1) => T2,
  fn2: (arg: T2) => T3,
  fn3: (arg: T3) => T4,
  fn4: (arg: T4) => T5,
  fn5: (arg: T5) => T6,
  fn6: (arg: T6) => T7,
  fn7: (arg: T7) => R,
): (arg: T1) => R
export function pipe<T1, T2, T3, T4, T5, T6, T7, T8, R>(
  fn1: (arg: T1) => T2,
  fn2: (arg: T2) => T3,
  fn3: (arg: T3) => T4,
  fn4: (arg: T4) => T5,
  fn5: (arg: T5) => T6,
  fn6: (arg: T6) => T7,
  fn7: (arg: T7) => T8,
  fn8: (arg: T8) => R,
): (arg: T1) => R
export function pipe<T1, T2, T3, T4, T5, T6, T7, T8, T9, R>(
  fn1: (arg: T1) => T2,
  fn2: (arg: T2) => T3,
  fn3: (arg: T3) => T4,
  fn4: (arg: T4) => T5,
  fn5: (arg: T5) => T6,
  fn6: (arg: T6) => T7,
  fn7: (arg: T7) => T8,
  fn8: (arg: T8) => T9,
  fn9: (arg: T9) => R,
): (arg: T1) => R
export function pipe<T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, R>(
  fn1: (arg: T1) => T2,
  fn2: (arg: T2) => T3,
  fn3: (arg: T3) => T4,
  fn4: (arg: T4) => T5,
  fn5: (arg: T5) => T6,
  fn6: (arg: T6) => T7,
  fn7: (arg: T7) => T8,
  fn8: (arg: T8) => T9,
  fn9: (arg: T9) => T10,
  fn10: (arg: T10) => R,
): (arg: T1) => R
export default function pipe(...fns: AnyFn[]) {
  return function piped(input: any) {
    return fns.reduce((result, fn) => fn(result), input)
  }
}
