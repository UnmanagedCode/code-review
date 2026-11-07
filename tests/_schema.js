// A plain-JS port of `checkSchema` and `validate` from code-conductor's `src/mcp/jsonSchemaSubset.ts`: the validator cc
// applies to a plugin tool's `outputSchema` (shape check at manifest load, value check on every typed reply).
// Same keyword set and same strictness. Re-sync when cc's subset changes; tests never import cc's tree.

const KEYWORDS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'anyOf', 'description']);
const TYPES = new Set(['object', 'array', 'string', 'integer', 'number', 'boolean', 'null']);

const isSchema = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const typeList = (t) => (t === undefined ? [] : Array.isArray(t) ? t : [t]);

/** Throws on the first schema-shape error; returns nothing when `schema` is within the subset. */
export function checkSchema(schema, at = '#') {
  if (!isSchema(schema)) throw new Error(`${at}: a schema must be an object`);
  for (const k of Object.keys(schema)) {
    if (!KEYWORDS.has(k)) throw new Error(`${at}: keyword '${k}' is outside the validated subset`);
  }
  const types = typeList(schema.type);
  for (const t of types) if (typeof t !== 'string' || !TYPES.has(t)) throw new Error(`${at}: unknown type '${String(t)}'`);
  if (types.includes('object') && !('additionalProperties' in schema)) throw new Error(`${at}: an object schema must state additionalProperties`);
  if (schema.properties !== undefined) {
    if (!isSchema(schema.properties)) throw new Error(`${at}: properties must be an object`);
    for (const [k, s] of Object.entries(schema.properties)) checkSchema(s, `${at}/properties/${k}`);
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required)) throw new Error(`${at}: required must be an array`);
    for (const k of schema.required) {
      if (!isSchema(schema.properties) || !(String(k) in schema.properties)) throw new Error(`${at}: required '${String(k)}' is not a property`);
    }
  }
  const ap = schema.additionalProperties;
  if (ap !== undefined && typeof ap !== 'boolean') checkSchema(ap, `${at}/additionalProperties`);
  if (schema.items !== undefined) checkSchema(schema.items, `${at}/items`);
  if (schema.enum !== undefined && !Array.isArray(schema.enum)) throw new Error(`${at}: enum must be an array`);
  if (schema.anyOf !== undefined) {
    if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0) throw new Error(`${at}: anyOf must be a non-empty array`);
    schema.anyOf.forEach((s, i) => checkSchema(s, `${at}/anyOf/${i}`));
  }
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

const typeMatches = (t, v) => {
  const actual = typeOf(v);
  return t === actual || (t === 'number' && actual === 'integer');
};

/** The validation errors for `value` (a JSON value: round-trip it first) against `schema`; empty when valid. */
export function validate(schema, value, at = '$') {
  const errors = [];
  if (schema.type !== undefined) {
    const types = typeList(schema.type);
    if (!types.some((t) => typeMatches(t, value))) {
      errors.push(`${at}: expected ${types.join('|')}, got ${typeOf(value)}`);
      return errors;
    }
  }
  if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) {
    errors.push(`${at}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }
  if (isSchema(value)) {
    const props = isSchema(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const k of required) if (!(String(k) in value)) errors.push(`${at}: missing required '${String(k)}'`);
    for (const [k, v] of Object.entries(value)) {
      const ps = props[k];
      if (k in props && isSchema(ps)) errors.push(...validate(ps, v, `${at}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${at}: unexpected property '${k}'`);
      else if (isSchema(schema.additionalProperties)) errors.push(...validate(schema.additionalProperties, v, `${at}.${k}`));
    }
  }
  if (Array.isArray(value) && isSchema(schema.items)) {
    value.forEach((v, i) => errors.push(...validate(schema.items, v, `${at}[${i}]`)));
  }
  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf.map((s) => (isSchema(s) ? validate(s, value, at) : [`${at}: invalid anyOf branch`]));
    if (!branches.some((br) => br.length === 0)) {
      errors.push(`${at}: matches no anyOf branch — ${branches.map((br, i) => `#${i}: ${br.slice(0, 3).join('; ')}`).join(' | ')}`);
    }
  }
  return errors;
}
