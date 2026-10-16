import type { ZodError, ZodType } from "zod";
import { ProjectSchema, type Element, type Project } from "./schema/project";
import { StyleSchema, type Style } from "./schema/style";
import { KIND_SCHEMAS, isKind } from "./schema/kinds";

export interface FieldError {
  path: string;
  message: string;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

/** ["elements", 4, "props", "lines", 1, "text"] -> "elements[4].props.lines[1].text" */
export function formatPath(path: ReadonlyArray<PropertyKey>): string {
  return path
    .map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`))
    .join("");
}

export function joinPath(prefix: string, sub: string): string {
  if (!sub) return prefix;
  return sub.startsWith("[") ? `${prefix}${sub}` : `${prefix}.${sub}`;
}

function toErrors(error: ZodError, prefix = ""): FieldError[] {
  return error.issues.map((i) => ({
    path: prefix ? joinPath(prefix, formatPath(i.path)) : formatPath(i.path),
    message: i.message,
  }));
}

export function parseStyle(input: unknown): ParseResult<Style> {
  const r = StyleSchema.safeParse(input);
  return r.success ? { ok: true, value: r.data } : { ok: false, errors: toErrors(r.error) };
}

/** Validates props against the kind's schema and returns the element with defaults applied. */
export function checkElementProps(el: Element, path: string, errors: FieldError[]): Element {
  if (!isKind(el.kind)) {
    errors.push({ path: `${path}.kind`, message: `unknown kind "${el.kind}"` });
    return el;
  }
  const schema: ZodType = KIND_SCHEMAS[el.kind];
  const r = schema.safeParse(el.props);
  if (!r.success) {
    errors.push(...toErrors(r.error, `${path}.props`));
    return el;
  }
  return { ...el, props: r.data as Record<string, unknown> };
}

export function parseProject(input: unknown): ParseResult<Project> {
  const r = ProjectSchema.safeParse(input);
  if (!r.success) return { ok: false, errors: toErrors(r.error) };
  const project = r.data;
  const errors: FieldError[] = [];
  const elements = project.elements.map((el, i) => checkElementProps(el, `elements[${i}]`, errors));
  const proposals = project.proposals.map((p, i) => ({
    ...p,
    variants: p.variants.map((v, j) =>
      v.patch.addElements
        ? {
            ...v,
            patch: {
              ...v.patch,
              addElements: v.patch.addElements.map((el, k) =>
                checkElementProps(el, `proposals[${i}].variants[${j}].patch.addElements[${k}]`, errors),
              ),
            },
          }
        : v,
    ),
  }));
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { ...project, elements, proposals } };
}
