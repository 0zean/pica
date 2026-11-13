// What the generator emits, independent of JSON Schema and of Swift syntax.
export type SwiftType =
  | { readonly kind: "named"; readonly name: string }
  | { readonly kind: "array"; readonly items: SwiftType }
  | { readonly kind: "dictionary"; readonly values: SwiftType }
  | { readonly kind: "optional"; readonly wrapped: SwiftType };

export interface Property {
  readonly jsonName: string;
  readonly swiftName: string;
  readonly type: SwiftType;
  readonly required: boolean;
  readonly constant: string | boolean | null;
}

export interface StructDecl {
  readonly kind: "struct";
  readonly name: string;
  readonly properties: readonly Property[];
  readonly nested: readonly Decl[];
}

export interface EnumDecl {
  readonly kind: "enum";
  readonly name: string;
  readonly cases: readonly { readonly swiftName: string; readonly value: string }[];
}

export interface AliasDecl {
  readonly kind: "alias";
  readonly name: string;
  readonly target: SwiftType;
}

export interface UnionCase {
  readonly swiftName: string;
  readonly typeName: string;
  // Discriminator values that select this case; empty for an untagged union.
  readonly tags: readonly string[];
  readonly tagIsConstant: boolean;
}

export interface UnionDecl {
  readonly kind: "union";
  readonly name: string;
  readonly discriminator: { readonly jsonName: string; readonly swiftName: string } | null;
  readonly cases: readonly UnionCase[];
  // Set for an open union: values with an unrecognised discriminator decode into this struct.
  readonly unknown: StructDecl | null;
  readonly nested: readonly Decl[];
}

export type Decl = StructDecl | EnumDecl | AliasDecl | UnionDecl;

export function named(name: string): SwiftType {
  return { kind: "named", name };
}

export const jsonValue = named("JSONValue");
