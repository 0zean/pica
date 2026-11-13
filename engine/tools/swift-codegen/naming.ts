const keywords = new Set([
  "Any", "Self", "as", "associatedtype", "await", "break", "case", "catch", "class", "continue", "default",
  "defer", "deinit", "do", "else", "enum", "extension", "fallthrough", "false", "fileprivate", "for", "func",
  "guard", "if", "import", "in", "init", "inout", "internal", "is", "let", "nil", "open", "operator",
  "private", "precedencegroup", "protocol", "public", "repeat", "rethrows", "return", "self", "static",
  "struct", "subscript", "super", "switch", "throw", "throws", "true", "try", "typealias", "var", "where", "while",
]);

// Names that cannot be used as a nested type because Swift gives them a meaning after a dot.
const reservedTypeNames = new Set(["Type", "Protocol", "Self", "Any"]);

function words(text: string): string[] {
  return text.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0);
}

// "session.state_changed" → "SessionStateChanged"; "statusChanged" → "StatusChanged".
export function pascalCase(text: string): string {
  const result = words(text)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  if (result.length === 0) {
    throw new Error(`cannot derive a Swift name from "${text}"`);
  }
  return /^[0-9]/.test(result) ? `V${result}` : result;
}

export function camelCase(text: string): string {
  const pascal = pascalCase(text);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function nestedTypeName(propertyName: string): string {
  const name = pascalCase(propertyName);
  return reservedTypeNames.has(name) ? `${name}Value` : name;
}

export function identifier(name: string): string {
  return keywords.has(name) ? `\`${name}\`` : name;
}

export function propertyName(jsonName: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(jsonName) ? jsonName : camelCase(jsonName);
}

export function swiftString(value: string): string {
  const escaped = Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    if (character === "\\" || character === '"') {
      return `\\${character}`;
    }
    return code < 0x20 ? `\\u{${code.toString(16)}}` : character;
  }).join("");
  return `"${escaped}"`;
}
