import { jsonValue, named, type Decl, type EnumDecl, type Property, type StructDecl, type SwiftType } from "./model.ts";
import { camelCase, nestedTypeName, propertyName } from "./naming.ts";
import { isAnySchema, isNullSchema, refName, type ProtocolDocument, type SchemaNode } from "./schema.ts";
import { lowerUnion } from "./lower-union.ts";

// Collects the types declared inline under one named declaration.
export interface Scope {
  readonly document: ProtocolDocument;
  readonly owner: string;
  readonly nested: Decl[];
}

const primitives: Readonly<Record<string, string>> = {
  string: "String",
  integer: "Int",
  number: "Double",
  boolean: "Bool",
};

export function lowerDefinition(document: ProtocolDocument, name: string, node: SchemaNode, openUnions: ReadonlySet<string>): Decl {
  const scope: Scope = { document, owner: name, nested: [] };
  if (node.oneOf !== undefined || nonNullBranches(node).length > 1) {
    return lowerUnion(scope, name, node.oneOf ?? nonNullBranches(node), openUnions.has(name));
  }
  if (node.enum !== undefined) {
    return lowerEnum(name, node.enum);
  }
  if (node.properties !== undefined) {
    return lowerStruct(document, name, node);
  }
  const target = lowerType(scope, node, name);
  if (scope.nested.length > 0) {
    throw new Error(`${name}: an alias cannot declare inline types`);
  }
  return { kind: "alias", name, target };
}

export function lowerStruct(document: ProtocolDocument, name: string, node: SchemaNode): StructDecl {
  const scope: Scope = { document, owner: name, nested: [] };
  const required = new Set(node.required ?? []);
  const properties = Object.entries(node.properties ?? {}).map(([jsonName, schema]): Property => {
    const isRequired = required.has(jsonName);
    const constant = lowerConstant(name, jsonName, schema, isRequired);
    const type = schema.const === undefined ? lowerType(scope, schema, nestedTypeName(jsonName)) : constantType(schema.const);
    return {
      jsonName,
      swiftName: propertyName(jsonName),
      type: isRequired || type.kind === "optional" ? type : { kind: "optional", wrapped: type },
      required: isRequired,
      constant,
    };
  });
  return { kind: "struct", name, properties, nested: scope.nested };
}

export function lowerEnum(name: string, values: readonly string[]): EnumDecl {
  const cases = values.map((value) => ({ swiftName: camelCase(value), value }));
  const names = new Set(cases.map((item) => item.swiftName));
  if (names.size !== cases.length) {
    throw new Error(`${name}: enum values collide after conversion to Swift case names`);
  }
  return { kind: "enum", name, cases };
}

export function lowerType(scope: Scope, node: SchemaNode, hint: string): SwiftType {
  if (node.$ref !== undefined) {
    return named(refName(node.$ref));
  }
  if (isAnySchema(node)) {
    return jsonValue;
  }
  if (Array.isArray(node.type)) {
    return lowerNullableTypeList(scope, node, node.type, hint);
  }
  if (node.anyOf !== undefined) {
    return lowerAnyOf(scope, node.anyOf, hint);
  }
  if (node.oneOf !== undefined || node.enum !== undefined || node.properties !== undefined) {
    return declareNested(scope, node, hint);
  }
  return lowerSimpleType(scope, node, hint);
}

function lowerSimpleType(scope: Scope, node: SchemaNode, hint: string): SwiftType {
  if (node.type === "array") {
    return { kind: "array", items: lowerType(scope, required(node.items, scope, "items"), `${hint}Item`) };
  }
  if (node.type === "object") {
    const values = node.additionalProperties ?? {};
    return { kind: "dictionary", values: lowerType(scope, values, `${hint}Value`) };
  }
  const primitive = typeof node.type === "string" ? primitives[node.type] : undefined;
  if (primitive === undefined) {
    throw new Error(`${scope.owner}: unsupported schema ${JSON.stringify(node)}`);
  }
  return named(primitive);
}

function lowerNullableTypeList(scope: Scope, node: SchemaNode, types: readonly string[], hint: string): SwiftType {
  const nonNull = types.filter((type) => type !== "null");
  const [only] = nonNull;
  if (only === undefined || nonNull.length > 1) {
    throw new Error(`${scope.owner}: unsupported type list ${JSON.stringify(types)}`);
  }
  const base = lowerType(scope, { ...node, type: only }, hint);
  return types.includes("null") ? optional(scope, base) : base;
}

function lowerAnyOf(scope: Scope, branches: readonly SchemaNode[], hint: string): SwiftType {
  const nonNull = branches.filter((branch) => !isNullSchema(branch));
  const [only] = nonNull;
  const base = only !== undefined && nonNull.length === 1 ? lowerType(scope, only, hint) : declareNested(scope, { anyOf: nonNull }, hint);
  return nonNull.length < branches.length ? optional(scope, base) : base;
}

function declareNested(scope: Scope, node: SchemaNode, hint: string): SwiftType {
  if (scope.document.$defs[hint] !== undefined) {
    throw new Error(`${scope.owner}: inline type ${hint} would shadow the definition of the same name`);
  }
  if (node.enum !== undefined) {
    scope.nested.push(lowerEnum(hint, node.enum));
  } else if (node.properties !== undefined) {
    scope.nested.push(lowerStruct(scope.document, hint, node));
  } else {
    scope.nested.push(lowerUnion(scope, hint, node.oneOf ?? node.anyOf ?? [], false));
  }
  return named(hint);
}

function optional(scope: Scope, wrapped: SwiftType): SwiftType {
  if (wrapped.kind === "optional") {
    throw new Error(`${scope.owner}: nested optionals are not supported`);
  }
  return { kind: "optional", wrapped };
}

function nonNullBranches(node: SchemaNode): readonly SchemaNode[] {
  return (node.anyOf ?? []).filter((branch) => !isNullSchema(branch));
}

function constantType(value: string | boolean | number): SwiftType {
  if (typeof value === "string") {
    return named("String");
  }
  return named(typeof value === "boolean" ? "Bool" : "Double");
}

function lowerConstant(owner: string, jsonName: string, schema: SchemaNode, isRequired: boolean): string | boolean | null {
  if (typeof schema.const === "number" || (schema.const !== undefined && !isRequired)) {
    throw new Error(`${owner}.${jsonName}: only required string and boolean constants are supported`);
  }
  return schema.const ?? null;
}

function required<T>(value: T | undefined, scope: Scope, what: string): T {
  if (value === undefined) {
    throw new Error(`${scope.owner}: schema is missing ${what}`);
  }
  return value;
}
