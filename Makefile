SWIFT_PACKAGES := $(wildcard app/Packages/*)

.PHONY: verify verify-engine verify-app lint lint-arch lint-swift-boundary typecheck test build engine-install codegen codegen-drift app-packages app-build app-ui-test

# `make verify UNIT=<ID>` runs only that unit's checks from tools/verify/units.json (PLAN.md §8.1).
ifdef UNIT
verify:
	@tools/verify/run.sh "$(UNIT)"
else
verify: verify-engine verify-app app-ui-test
endif

# The CI subsets (PLAN.md §8.1): verify-engine runs on Linux, verify-app on macOS when app or protocol files change.
verify-engine: lint lint-arch lint-swift-boundary typecheck codegen-drift test

verify-app: build

engine-install:
	cd engine && pnpm install --frozen-lockfile

# Regenerates protocol.schema.json from the zod schemas, then the Swift types in PicaProtocol from it (D-05).
codegen: engine-install
	cd engine && pnpm protocol-schema && pnpm swift-codegen

codegen-drift: codegen
	@tools/codegen/check-drift.sh

lint: engine-install
	cd engine && pnpm lint

lint-arch: engine-install
	cd engine && pnpm lint-arch

# PLAN.md §4.3: Swift never runs git or calls GitHub. A grep over app/, so it runs on Linux too.
lint-swift-boundary:
	@tools/lint/swift-boundary.sh

typecheck: engine-install
	cd engine && pnpm typecheck

test: engine-install
	cd engine && pnpm test

build: app-packages app-build

app-packages:
	@set -e; for package in $(SWIFT_PACKAGES); do \
		swift build --package-path $$package; \
		if [ -d $$package/Tests ]; then swift test --package-path $$package; fi; \
	done

app-build:
	xcodebuild -project app/Pica.xcodeproj -scheme Pica -configuration Debug \
		-derivedDataPath app/.derived -quiet CODE_SIGNING_ALLOWED=NO build

# UI tests need macOS automation mode and run only locally, not in CI. Run
# `automationmodetool enable-automationmode-without-authentication` once, or approve the prompt.
app-ui-test:
	rm -rf app/.derived/ui-tests.xcresult
	xcodebuild -project app/Pica.xcodeproj -scheme PicaGallery -destination 'platform=macOS,arch=$(shell uname -m)' \
		-derivedDataPath app/.derived -resultBundlePath app/.derived/ui-tests.xcresult test
