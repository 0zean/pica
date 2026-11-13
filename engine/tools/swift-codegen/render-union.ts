import type { UnionCase, UnionDecl } from "./model.ts";
import { identifier, swiftString } from "./naming.ts";
import { conformances, indent, joinBlocks } from "./lines.ts";
import { renderDecl } from "./render.ts";
import { renderStruct } from "./render-struct.ts";

const unknownCase = { swiftName: "unknown", typeName: "Unknown" };

export function renderUnion(decl: UnionDecl): string[] {
  const allCases = decl.unknown === null ? decl.cases : [...decl.cases, unknownCase];
  const body = joinBlocks([
    allCases.map((item) => `case ${identifier(item.swiftName)}(${item.typeName})`),
    decl.discriminator === null ? renderUntaggedCodable(decl) : renderTaggedCodable(decl, decl.discriminator),
    ...decl.nested.map(renderDecl),
    decl.unknown === null ? [] : renderStruct(decl.unknown),
  ]);
  return [`public enum ${decl.name}: ${conformances} {`, ...indent(body), "}"];
}

function renderEncodeSwitch(decl: UnionDecl, encodeValue: string): string[] {
  const names = decl.unknown === null ? decl.cases.map((item) => item.swiftName) : [...decl.cases.map((item) => item.swiftName), "unknown"];
  return ["switch self {", ...names.map((name) => `case .${identifier(name)}(let value): ${encodeValue}`), "}"];
}

function renderTaggedCodable(decl: UnionDecl, discriminator: { jsonName: string; swiftName: string }): string[] {
  const key = identifier(discriminator.swiftName);
  const keyCase = discriminator.swiftName === discriminator.jsonName ? `case ${key}` : `case ${key} = ${swiftString(discriminator.jsonName)}`;
  const tagCases = decl.cases.map(
    (item) => `case ${item.tags.map(swiftString).join(", ")}: self = .${identifier(item.swiftName)}(try ${item.typeName}(from: decoder))`,
  );
  const fallback =
    decl.unknown === null
      ? `default: throw DecodingError.dataCorruptedError(forKey: .${key}, in: container, debugDescription: "unknown ${decl.name} ${discriminator.jsonName} \\(tag)")`
      : "default: self = .unknown(try Unknown(from: decoder))";
  return joinBlocks([
    [`public var ${key}: String {`, ...indent(["switch self {", ...renderTagAccessors(decl, key), "}"]), "}"],
    ["private enum DiscriminatorKey: String, CodingKey {", ...indent([keyCase]), "}"],
    [
      "public init(from decoder: any Decoder) throws {",
      ...indent([
        "let container = try decoder.container(keyedBy: DiscriminatorKey.self)",
        `let tag = try container.decode(String.self, forKey: .${key})`,
        "switch tag {",
        ...tagCases,
        fallback,
        "}",
      ]),
      "}",
    ],
    ["public func encode(to encoder: any Encoder) throws {", ...indent(renderEncodeSwitch(decl, "try value.encode(to: encoder)")), "}"],
  ]);
}

function renderTagAccessors(decl: UnionDecl, key: string): string[] {
  const accessors = decl.cases.map((item: UnionCase) =>
    item.tagIsConstant
      ? `case .${identifier(item.swiftName)}: ${item.typeName}.${key}`
      : `case .${identifier(item.swiftName)}(let value): value.${key}.rawValue`,
  );
  return decl.unknown === null ? accessors : [...accessors, `case .unknown(let value): value.${key}`];
}

// Variants are tried in schema order; the first that decodes wins.
function renderUntaggedCodable(decl: UnionDecl): string[] {
  const attempts = decl.cases.flatMap((item, index) => [
    `${index === 0 ? "if" : "} else if"} let value = try? container.decode(${item.typeName}.self) {`,
    `    self = .${identifier(item.swiftName)}(value)`,
  ]);
  return joinBlocks([
    [
      "public init(from decoder: any Decoder) throws {",
      ...indent([
        "let container = try decoder.singleValueContainer()",
        ...attempts,
        "} else {",
        `    throw DecodingError.dataCorruptedError(in: container, debugDescription: "${decl.name} matches none of its variants")`,
        "}",
      ]),
      "}",
    ],
    [
      "public func encode(to encoder: any Encoder) throws {",
      ...indent(["var container = encoder.singleValueContainer()", ...renderEncodeSwitch(decl, "try container.encode(value)")]),
      "}",
    ],
  ]);
}
