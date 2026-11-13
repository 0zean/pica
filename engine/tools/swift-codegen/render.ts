import type { AliasDecl, Decl, EnumDecl } from "./model.ts";
import { conformances, indent, renderType } from "./lines.ts";
import { identifier, swiftString } from "./naming.ts";
import { renderStruct } from "./render-struct.ts";
import { renderUnion } from "./render-union.ts";

export function renderDecl(decl: Decl): string[] {
  switch (decl.kind) {
    case "alias":
      return renderAlias(decl);
    case "enum":
      return renderEnum(decl);
    case "struct":
      return renderStruct(decl);
    case "union":
      return renderUnion(decl);
  }
}

function renderAlias(decl: AliasDecl): string[] {
  return [`public typealias ${decl.name} = ${renderType(decl.target)}`];
}

function renderEnum(decl: EnumDecl): string[] {
  const cases = decl.cases.map((item) =>
    item.swiftName === item.value ? `case ${identifier(item.swiftName)}` : `case ${identifier(item.swiftName)} = ${swiftString(item.value)}`,
  );
  return [`public enum ${decl.name}: String, CaseIterable, ${conformances} {`, ...indent(cases), "}"];
}
