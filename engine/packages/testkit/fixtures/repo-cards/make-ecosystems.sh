#!/bin/sh
# Builds deterministic single-commit repositories, one per ecosystem, for the R-09 repo card tests.
# Usage: make-ecosystems.sh <empty directory>
# Creates node, python, go and swift inside it.
set -eu

root="$1"
mkdir -p "$root"
cd "$root"

export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME="Pica Fixture"
export GIT_AUTHOR_EMAIL="fixture@pica.test"
export GIT_COMMITTER_NAME="Pica Fixture"
export GIT_COMMITTER_EMAIL="fixture@pica.test"
export GIT_AUTHOR_DATE="@1700000000 +0000"
export GIT_COMMITTER_DATE="@1700000000 +0000"

# write <path> <content>
write() {
  mkdir -p "$(dirname "$1")"
  printf '%s\n' "$2" > "$1"
}

commit_all() {
  git add -A
  git commit --quiet --no-verify -m "Initial commit"
}

new_repo() {
  git init --quiet --initial-branch=main "$1"
  git -C "$1" config core.autocrlf false
}

new_repo node
(
  cd node
  write package.json '{
  "name": "@acme/web",
  "private": true,
  "type": "module",
  "bin": { "acme": "./dist/cli.js" },
  "main": "./dist/index.js",
  "scripts": { "build": "tsc -b", "test": "vitest run", "lint": "eslint ." }
}'
  write pnpm-lock.yaml "lockfileVersion: '9.0'"
  write pnpm-workspace.yaml 'packages:
  - "packages/*"'
  write tsconfig.json '{ "compilerOptions": { "strict": true } }'
  write src/index.ts 'export const version = "1.0.0";'
  write src/cli.ts 'import { version } from "./index.ts";
console.log(version);'
  write src/routes/home.tsx 'export function Home() { return null; }'
  write packages/ui/package.json '{ "name": "@acme/ui", "scripts": { "test": "vitest run" } }'
  write packages/ui/src/button.ts 'export const button = "button";'
  write scripts/release.sh 'echo release'
  write vendor/legacy.js 'module.exports = {};'
  write .github/CODEOWNERS '# Web platform
*                 @acme/web
/packages/ui/     @acme/design @dana
/scripts/         @acme/release  # release tooling'
  write README.md '# Acme web'
  commit_all
)

new_repo python
(
  cd python
  write pyproject.toml '[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "acme-tool"
dependencies = ["requests>=2"]

[project.optional-dependencies]
dev = ["pytest>=8"]

[project.scripts]
acme-tool = "acme_tool.cli:main"'
  write src/acme_tool/__init__.py '__version__ = "1.0.0"'
  write src/acme_tool/__main__.py 'from acme_tool.cli import main
main()'
  write src/acme_tool/cli.py 'def main() -> None:
    print("acme")'
  write src/acme_tool/client.py 'import requests'
  write tests/test_cli.py 'def test_main() -> None:
    assert True'
  write Makefile 'lint:
	ruff check .

test: lint
	pytest'
  write CODEOWNERS '* @acme/data'
  commit_all
)

new_repo go
(
  cd go
  write go.mod 'module github.com/acme/api

go 1.23'
  write go.sum ''
  write cmd/server/main.go 'package main

func main() {}'
  write cmd/worker/main.go 'package main

func main() {}'
  write internal/api/handler.go 'package api'
  write internal/api/handler_test.go 'package api'
  write internal/store/store.go 'package store'
  write scripts/gen.sh 'go generate ./...'
  write Makefile '.PHONY: build test

build:
	go build -o bin/ ./cmd/...

test:
	go test -race ./...'
  write docs/CODEOWNERS '*        @acme/backend
/docs/   @acme/writers'
  commit_all
)

new_repo swift
(
  cd swift
  write Package.swift '// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Acme",
    targets: [
        .target(name: "AcmeKit"),
        .executableTarget(name: "acme-cli", dependencies: ["AcmeKit"]),
        .testTarget(name: "AcmeKitTests", dependencies: ["AcmeKit"]),
    ]
)'
  write Sources/AcmeKit/Kit.swift 'public struct Kit {}'
  write Sources/AcmeKit/Store.swift 'struct Store {}'
  write Sources/acme-cli/main.swift 'import AcmeKit
print("acme")'
  write Tests/AcmeKitTests/KitTests.swift 'import Testing'
  write .build/debug.yaml 'cached: true'
  commit_all
)
