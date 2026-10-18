import { z, type ZodType } from 'zod';

/** Keys that strict providers may reject. Zod emits huge bounds for `.int()`; array limits are checked by zod after the call. */
const DROPPED = ['$schema', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems'];

type Node = Record<string, unknown>;
const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null && !Array.isArray(v);

function strictify(node: Node, path: string): void {
  for (const key of DROPPED) delete node[key];
  if (isNode(node.properties)) {
    const keys = Object.keys(node.properties);
    if (node.additionalProperties !== false) throw new Error(`${path}: additionalProperties must be false`);
    const required = Array.isArray(node.required) ? (node.required as string[]) : [];
    const missing = keys.filter((k) => !required.includes(k));
    if (missing.length > 0) throw new Error(`${path}: keys must all be required (missing: ${missing.join(', ')})`);
    for (const [k, child] of Object.entries(node.properties)) if (isNode(child)) strictify(child, `${path}.${k}`);
  }
  if (isNode(node.items)) strictify(node.items, `${path}[]`);
  for (const list of ['anyOf', 'oneOf', 'allOf'] as const) {
    const entries = node[list];
    if (Array.isArray(entries)) entries.forEach((e, i) => { if (isNode(e)) strictify(e, `${path}.${list}[${i}]`); });
  }
  if (isNode(node.$defs)) for (const [k, child] of Object.entries(node.$defs)) if (isNode(child)) strictify(child, `${path}.$defs.${k}`);
}

/** JSON schema for a strict structured-output call: no numeric bounds, every object closed with all keys required. */
export function toStrictJsonSchema(schema: ZodType): object {
  const json = z.toJSONSchema(schema) as Node;
  strictify(json, '#');
  return json;
}
