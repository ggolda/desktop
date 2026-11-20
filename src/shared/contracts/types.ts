// Generic shape of a contract (SPEC 3.1): which slices, commands and events exist.
// Both core implementations and window proxies are typed from the same `Contract`.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFn = (...args: any[]) => unknown;

export interface Contract {
  /** slice name -> state type. Parameterized slices use template keys: `` `sceneItems:${string}` ``. */
  slices: Record<string, object>;
  /** target -> method signatures (declared sync; implementations may be async). */
  commands: Record<string, Record<string, AnyFn>>;
  /** event name -> payload type. */
  events: Record<string, unknown>;
}

export type SliceKey<C extends Contract> = Extract<keyof C['slices'], string>;

/** Core-side implementation of one command target: same methods, may return a promise. */
export type CommandImpl<C extends Contract, T extends keyof C['commands']> = {
  [M in keyof C['commands'][T]]: C['commands'][T][M] extends (...a: infer A) => infer R
    ? (...args: A) => R | Promise<R>
    : never;
};

/** Window-side proxy for one command target: every method becomes async. */
export type CommandProxy<C extends Contract> = {
  [T in keyof C['commands']]: {
    [M in keyof C['commands'][T]]: C['commands'][T][M] extends (...a: infer A) => infer R
      ? (...args: A) => Promise<Awaited<R>>
      : never;
  };
};
