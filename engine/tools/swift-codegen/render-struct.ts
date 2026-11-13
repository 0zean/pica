import type { Property, StructDecl } from "./model.ts";
import { identifier, swiftString } from "./naming.ts";
import { conformances, indent, joinBlocks, renderType } from "./lines.ts";
import { renderDecl } from "./render.ts";

// Codable is written out rather than synthesized so that a required nullable field encodes as `null`
// while an optional one is omitted, and so that constant fields are checked on decode.
export function renderStruct(decl: StructDecl): string[] {
  const constants = decl.properties.filter((property) => property.constant !== null);
  const stored = decl.properties.filter((property) => property.constant === null);
  const body = joinBlocks([
    constants.map((property) => `public static let ${identifier(property.swiftName)} = ${literal(property)}`),
    stored.map((property) => `public var ${identifier(property.swiftName)}: ${renderType(property.type)}`),
    renderInit(stored),
    renderCodingKeys(decl.properties),
    renderDecoder(decl.properties),
    renderEncoder(decl.properties),
    ...decl.nested.map(renderDecl),
  ]);
  return [`public struct ${decl.name}: ${conformances} {`, ...indent(body), "}"];
}

function literal(property: Property): string {
  return typeof property.constant === "string" ? swiftString(property.constant) : String(property.constant);
}

function renderInit(stored: readonly Property[]): string[] {
  if (stored.length === 0) {
    return ["public init() {}"];
  }
  const parameters = stored.map((property) => {
    const name = identifier(property.swiftName);
    const defaultValue = property.required ? "" : " = nil";
    return `${name}: ${renderType(property.type)}${defaultValue}`;
  });
  const assignments = stored.map((property) => `self.${identifier(property.swiftName)} = ${identifier(property.swiftName)}`);
  return [`public init(`, ...indent(parameters.map((line, index) => (index < parameters.length - 1 ? `${line},` : line))), ") {", ...indent(assignments), "}"];
}

function codingKeysType(properties: readonly Property[]): string {
  return properties.length === 0 ? "JSONKey" : "CodingKeys";
}

function renderCodingKeys(properties: readonly Property[]): string[] {
  if (properties.length === 0) {
    return [];
  }
  const cases = properties.map((property) =>
    property.swiftName === property.jsonName
      ? `case ${identifier(property.swiftName)}`
      : `case ${identifier(property.swiftName)} = ${swiftString(property.jsonName)}`,
  );
  return ["private enum CodingKeys: String, CodingKey {", ...indent(cases), "}"];
}

function decodeLine(property: Property): string {
  const name = identifier(property.swiftName);
  if (property.constant !== null) {
    return `try container.decodeConstant(Self.${name}, forKey: .${name})`;
  }
  const type = renderType(property.type);
  if (!property.required) {
    const wrapped = property.type.kind === "optional" ? renderType(property.type.wrapped) : type;
    return `${name} = try container.decodeIfPresent(${wrapped}.self, forKey: .${name})`;
  }
  return `${name} = try container.decode(${type}.self, forKey: .${name})`;
}

function encodeLine(property: Property): string {
  const name = identifier(property.swiftName);
  if (property.constant !== null) {
    return `try container.encode(Self.${name}, forKey: .${name})`;
  }
  const method = property.required ? "encode" : "encodeIfPresent";
  return `try container.${method}(${name}, forKey: .${name})`;
}

function renderDecoder(properties: readonly Property[]): string[] {
  const keys = codingKeysType(properties);
  const opening = properties.length === 0 ? `_ = try decoder.container(keyedBy: ${keys}.self)` : `let container = try decoder.container(keyedBy: ${keys}.self)`;
  return ["public init(from decoder: any Decoder) throws {", ...indent([opening, ...properties.map(decodeLine)]), "}"];
}

function renderEncoder(properties: readonly Property[]): string[] {
  const keys = codingKeysType(properties);
  const opening = properties.length === 0 ? `_ = encoder.container(keyedBy: ${keys}.self)` : `var container = encoder.container(keyedBy: ${keys}.self)`;
  return ["public func encode(to encoder: any Encoder) throws {", ...indent([opening, ...properties.map(encodeLine)]), "}"];
}
