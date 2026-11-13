// The subset of JSON Schema that `protocol.schema.json` uses, plus Pica's `x-pica-*` maps.
export interface SchemaNode {
  readonly $ref?: string;
  readonly type?: string | readonly string[];
  readonly const?: string | boolean | number;
  readonly enum?: readonly string[];
  readonly properties?: Readonly<Record<string, SchemaNode>>;
  readonly required?: readonly string[];
  readonly items?: SchemaNode;
  readonly additionalProperties?: SchemaNode;
  readonly anyOf?: readonly SchemaNode[];
  readonly oneOf?: readonly SchemaNode[];
}

export interface Ref {
  readonly $ref: string;
}

export interface ProtocolDocument {
  readonly "x-pica-protocol-version": { readonly major: number; readonly minor: number };
  readonly "x-pica-methods": Readonly<Record<string, { readonly direction: string; readonly params: Ref; readonly result: Ref }>>;
  readonly "x-pica-notifications": Readonly<Record<string, { readonly params: Ref }>>;
  readonly "x-pica-events": Readonly<Record<string, Ref>>;
  readonly "x-pica-rpc-error-numbers": Readonly<Record<string, number>>;
  readonly $defs: Readonly<Record<string, SchemaNode>>;
}

const refPrefix = "#/$defs/";

export function refName(ref: string): string {
  if (!ref.startsWith(refPrefix)) {
    throw new Error(`unsupported $ref ${ref}`);
  }
  return ref.slice(refPrefix.length);
}

export function isNullSchema(node: SchemaNode): boolean {
  return node.type === "null";
}

export function isAnySchema(node: SchemaNode): boolean {
  return Object.keys(node).length === 0;
}

export function resolve(document: ProtocolDocument, node: SchemaNode): SchemaNode {
  if (node.$ref === undefined) {
    return node;
  }
  const target = document.$defs[refName(node.$ref)];
  if (target === undefined) {
    throw new Error(`$ref ${node.$ref} has no definition`);
  }
  return target;
}
