const id = <T>(x: T) => x;

export type MemoizedFn<Args extends any[], Return> = {
  (...args: Args): Return;
  invalidate(): void;
};

type MemoizationKey = string | number | symbol;

export default function memoize<Args extends [MemoizationKey], Return>(
  func: (...args: Args) => Return
): MemoizedFn<Args, Return>;
export default function memoize<Args extends any[], Return>(
  func: (...args: Args) => Return,
  keyfn: (...args: Args) => MemoizationKey
): MemoizedFn<Args, Return>;
export default function memoize<Args extends any[], Return>(
  func: (...args: Args) => Return,
  keyfn: (...args: any[]) => MemoizationKey = id
): MemoizedFn<Args, Return> {
  const cache = new Map<MemoizationKey, Return>();

  const memoizedFunc = (...args: Args) => {
    const key = keyfn(...args);
    if (cache.has(key)) {
      // I've checked that the cache has entry beforehand. I cannot use
      // checks for undefined, since undefined may be the memoized value
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return cache.get(key)!;
    }
    const item = func(...args);
    cache.set(key, item);
    return item;
  };

  memoizedFunc.invalidate = cache.clear.bind(cache);

  return memoizedFunc;
}

