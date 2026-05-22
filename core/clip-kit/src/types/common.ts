export type Awaitable<T> = T | Promise<T>;

export type EmptyObject = Record<never, never>;
export type Simplify<T> = { [K in keyof T]: T[K] } & {};
export type MergeContext<TLeft extends object, TRight extends object> = Simplify<Omit<TLeft, keyof TRight> & TRight>;
