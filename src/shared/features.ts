// Feature registry types (SPEC 5.3). Filled in as features are ported.

export interface FeatureDef {
  id: string;
  /** Enabled by default (still subject to flags and the user's local setting). */
  default: boolean;
  flag?: string;
}
