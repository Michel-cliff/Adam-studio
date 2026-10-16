export type Plain = Record<string, unknown>;

function isPlain(v: unknown): v is Plain {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Recursive merge of plain objects; arrays and scalars from `patch` replace those in `base`. */
export function deepMerge(base: Plain, patch: Plain): Plain {
  const out: Plain = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const current = out[k];
    out[k] = isPlain(v) && isPlain(current) ? deepMerge(current, v) : v;
  }
  return out;
}
