import { lowerStruct, lowerType, type Scope } from "./lower.ts";
import { jsonValue, named, type Decl, type Property, type StructDecl, type UnionCase, type UnionDecl } from "./model.ts";
import { camelCase, nestedTypeName, pascalCase, propertyName } from "./naming.ts";
import { refName, resolve, type SchemaNode } from "./schema.ts";

interface Variant {
  readonly branch: SchemaNode;
  readonly object: SchemaNode;
}

const unknownStructName = "Unknown";

export function lowerUnion(parent: Scope, name: string, branches: readonly SchemaNode[], open: boolean): UnionDecl {
  const variants = branches.map((branch): Variant => ({ branch, object: resolve(parent.document, branch) }));
  const discriminator = findDiscriminator(variants);
  if (discriminator === null) {
    if (open) {
      throw new Error(`${name}: an open union needs a discriminator property`);
    }
    return { kind: "union", name, discriminator: null, cases: variants.map((variant) => untaggedCase(parent, name, variant)), unknown: null, nested: [] };
  }
  const nested: Decl[] = [];
  const cases = variants.map((variant) => taggedCase(parent, nested, variant, discriminator));
  if (open && cases.some((item) => item.swiftName === "unknown")) {
    throw new Error(`${name}: a case named unknown would clash with the open union's fallback`);
  }
  const unknown = open ? unknownStruct(parent, name, variants, discriminator) : null;
  return {
    kind: "union",
    name,
    discriminator: { jsonName: discriminator, swiftName: propertyName(discriminator) },
    cases,
    unknown,
    nested,
  };
}

function tagsOf(object: SchemaNode, key: string): readonly string[] | null {
  if (!(object.required ?? []).includes(key)) {
    return null;
  }
  const property = object.properties?.[key];
  if (typeof property?.const === "string") {
    return [property.const];
  }
  return property?.enum ?? null;
}

function findDiscriminator(variants: readonly Variant[]): string | null {
  const [first] = variants;
  const candidates = Object.keys(first?.object.properties ?? {});
  for (const key of candidates) {
    const tagLists = variants.map((variant) => tagsOf(variant.object, key));
    const tags = tagLists.flatMap((list) => list ?? []);
    if (tagLists.every((list) => list !== null) && new Set(tags).size === tags.length) {
      return key;
    }
  }
  return null;
}

function taggedCase(parent: Scope, nested: Decl[], variant: Variant, key: string): UnionCase {
  const tags = tagsOf(variant.object, key) ?? [];
  const [firstTag] = tags;
  if (firstTag === undefined) {
    throw new Error(`${parent.owner}: a union variant has no discriminator value`);
  }
  let typeName: string;
  if (variant.branch.$ref === undefined) {
    typeName = pascalCase(firstTag);
    nested.push(lowerStruct(parent.document, typeName, variant.object));
  } else {
    typeName = refName(variant.branch.$ref);
  }
  const tagIsConstant = variant.object.properties?.[key]?.const !== undefined;
  return { swiftName: camelCase(firstTag), typeName, tags, tagIsConstant };
}

function untaggedCase(parent: Scope, union: string, variant: Variant): UnionCase {
  const scope: Scope = { ...parent, owner: union, nested: [] };
  const type = lowerType(scope, variant.branch, union);
  if (type.kind !== "named" || scope.nested.length > 0) {
    throw new Error(`${union}: untagged union variants must be primitives or references`);
  }
  return { swiftName: camelCase(type.name), typeName: type.name, tags: [], tagIsConstant: false };
}

// Keeps the envelope that every variant shares typed; whatever differs between variants stays raw JSON.
function unknownStruct(parent: Scope, union: string, variants: readonly Variant[], key: string): StructDecl {
  if (variants.some((variant) => variant.branch.$ref === `#/$defs/${unknownStructName}`)) {
    throw new Error(`${union}: a variant is already named ${unknownStructName}`);
  }
  const scope: Scope = { ...parent, owner: `${union}.${unknownStructName}`, nested: [] };
  const sharedKeys = Object.keys(variants[0]?.object.properties ?? {}).filter((name) =>
    variants.every((variant) => (variant.object.required ?? []).includes(name)),
  );
  const properties = sharedKeys.map((jsonName): Property => {
    const schemas = variants.map((variant) => JSON.stringify(variant.object.properties?.[jsonName]));
    const shared = new Set(schemas).size === 1 ? variants[0]?.object.properties?.[jsonName] : undefined;
    let type = jsonValue;
    if (jsonName === key) {
      type = named("String");
    } else if (shared !== undefined) {
      type = lowerType(scope, shared, nestedTypeName(jsonName));
    }
    return { jsonName, swiftName: propertyName(jsonName), type, required: true, constant: null };
  });
  if (scope.nested.length > 0) {
    throw new Error(`${union}: the shared envelope cannot declare inline types`);
  }
  return { kind: "struct", name: unknownStructName, properties, nested: [] };
}
