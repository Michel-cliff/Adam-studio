import type { ZodError, ZodType } from "zod";
import {
  ProjectSchema,
  type Anchor,
  type Asset,
  type Caption,
  type Clip,
  type Element,
  type Project,
  type Variant,
} from "./schema/project";
import { StyleSchema, type Style } from "./schema/style";
import { ASSET_PROP_KINDS, KIND_SCHEMAS, isKind } from "./schema/kinds";
import { indexWords, type WordRef } from "./words";

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

interface Ctx {
  assets: Map<string, Asset>;
  words: Map<string, WordRef>;
  errors: FieldError[];
}

function duplicates(ids: string[], path: string, errors: FieldError[]): void {
  const seen = new Set<string>();
  ids.forEach((id, i) => {
    if (seen.has(id)) errors.push({ path: `${path}[${i}].id`, message: `duplicate id "${id}"` });
    seen.add(id);
  });
}

function checkWord(id: string, path: string, ctx: Ctx): void {
  if (!ctx.words.has(id)) ctx.errors.push({ path, message: `unknown word "${id}"` });
}

function checkAnchor(anchor: Anchor, path: string, ctx: Ctx): void {
  if ("word" in anchor) checkWord(anchor.word, `${path}.word`, ctx);
}

function checkClip(c: Clip, path: string, ctx: Ctx): void {
  if (!ctx.assets.has(c.asset)) ctx.errors.push({ path: `${path}.asset`, message: `unknown asset "${c.asset}"` });
  if (c.framing.mode === "split" && !ctx.assets.has(c.framing.asset)) {
    ctx.errors.push({ path: `${path}.framing.asset`, message: `unknown asset "${c.framing.asset}"` });
  }
}

function checkElement(el: Element, path: string, ctx: Ctx): Element {
  const parsed = checkElementProps(el, path, ctx.errors);
  checkAnchor(parsed.anchor, `${path}.anchor`, ctx);
  if (parsed.untilWord !== undefined) checkWord(parsed.untilWord, `${path}.untilWord`, ctx);
  if (ASSET_PROP_KINDS.has(parsed.kind)) {
    const asset = (parsed.props as { asset?: unknown }).asset;
    if (typeof asset === "string" && !ctx.assets.has(asset)) {
      ctx.errors.push({ path: `${path}.props.asset`, message: `unknown asset "${asset}"` });
    }
  }
  return parsed;
}

function checkCaption(c: Caption, path: string, ctx: Ctx): void {
  checkWord(c.words[0], `${path}.words[0]`, ctx);
  checkWord(c.words[1], `${path}.words[1]`, ctx);
  const first = ctx.words.get(c.words[0]);
  const last = ctx.words.get(c.words[1]);
  if (!first || !last) return;
  if (first.asset !== last.asset) {
    ctx.errors.push({ path: `${path}.words`, message: "a caption's first and last words must come from the same asset" });
  } else if (last.index < first.index) {
    ctx.errors.push({ path: `${path}.words`, message: "the last word comes before the first word" });
  }
}

function checkBeat(b: { from: string; to: string }, path: string, ctx: Ctx): void {
  checkWord(b.from, `${path}.from`, ctx);
  checkWord(b.to, `${path}.to`, ctx);
  const from = ctx.words.get(b.from);
  const to = ctx.words.get(b.to);
  if (from && to && from.asset === to.asset && to.index < from.index) {
    ctx.errors.push({ path: `${path}.to`, message: "the beat ends before it starts" });
  }
}

function checkVariant(v: Variant, path: string, ctx: Ctx): Variant {
  const patch = { ...v.patch };
  if (patch.addElements) {
    patch.addElements = patch.addElements.map((el, k) => checkElement(el, `${path}.addElements[${k}]`, ctx));
  }
  patch.addCaptions?.forEach((c, k) => checkCaption(c, `${path}.addCaptions[${k}]`, ctx));
  patch.setStory?.forEach((c, k) => checkClip(c, `${path}.setStory[${k}]`, ctx));
  if (patch.setStory) duplicates(patch.setStory.map((c) => c.id), `${path}.setStory`, ctx.errors);
  patch.setStructure?.beats.forEach((b, k) => checkBeat(b, `${path}.setStructure.beats[${k}]`, ctx));
  return { ...v, patch };
}

export function parseProject(input: unknown): ParseResult<Project> {
  const r = ProjectSchema.safeParse(input);
  if (!r.success) return { ok: false, errors: toErrors(r.error) };
  const project = r.data;
  const errors: FieldError[] = [];
  const ctx: Ctx = { assets: new Map(project.assets.map((a) => [a.id, a])), words: indexWords(project), errors };

  duplicates(project.assets.map((a) => a.id), "assets", errors);
  duplicates(project.story.map((c) => c.id), "story", errors);
  duplicates(project.elements.map((e) => e.id), "elements", errors);
  duplicates(project.proposals.map((p) => p.id), "proposals", errors);

  for (const asset of Object.keys(project.transcript.words)) {
    if (!ctx.assets.has(asset)) errors.push({ path: `transcript.words.${asset}`, message: `unknown asset "${asset}"` });
  }
  const wordCount = Object.values(project.transcript.words).reduce((n, list) => n + list.length, 0);
  if (wordCount !== ctx.words.size) errors.push({ path: "transcript.words", message: "word ids must be unique across assets" });

  project.story.forEach((c, i) => checkClip(c, `story[${i}]`, ctx));
  const elements = project.elements.map((el, i) => checkElement(el, `elements[${i}]`, ctx));
  project.captions.forEach((c, i) => checkCaption(c, `captions[${i}]`, ctx));
  project.structure?.beats.forEach((b, i) => checkBeat(b, `structure.beats[${i}]`, ctx));
  const proposals = project.proposals.map((p, i) => {
    if (p.anchor) checkAnchor(p.anchor, `proposals[${i}].anchor`, ctx);
    const keys = p.variants.map((v) => v.key);
    keys.forEach((k, j) => { if (keys.indexOf(k) !== j) errors.push({ path: `proposals[${i}].variants[${j}].key`, message: `duplicate variant key "${k}"` }); });
    return { ...p, variants: p.variants.map((v, j) => checkVariant(v, `proposals[${i}].variants[${j}].patch`, ctx)) };
  });

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { ...project, elements, proposals } };
}
