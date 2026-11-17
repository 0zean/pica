SWIFT_PACKAGES := $(wildcard app/Packages/*)

.PHONY: verify verify-engine verify-app lint lint-arch lint-swift-boundary typecheck test build engine-install codegen codegen-drift app-packages app-build app-ui-test app-ui-test-gallery app-ui-test-pica

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

# AppShell's tests start `picad` with a FakeRuntime (A-01): they need the engine's packages and Node on PATH.
app-packages: engine-install
	@set -e; for package in $(SWIFT_PACKAGES); do \
		swift build --package-path $$package; \
		if [ -d $$package/Tests ]; then swift test --package-path $$package; fi; \
	done

app-build:
	xcodebuild -project app/Pica.xcodeproj -scheme Pica -configuration Debug \
		-derivedDataPath app/.derived -quiet CODE_SIGNING_ALLOWED=NO build

# UI tests need macOS automation mode and run only locally, not in CI. Run
# `automationmodetool enable-automationmode-without-authentication` once, or approve the prompt.
app-ui-test: app-ui-test-gallery app-ui-test-pica

app-ui-test-gallery:
	rm -rf app/.derived/ui-tests.xcresult
	xcodebuild -project app/Pica.xcodeproj -scheme PicaGallery -destination 'platform=macOS,arch=$(shell uname -m)' \
		-derivedDataPath app/.derived -resultBundlePath app/.derived/ui-tests.xcresult test

# Pica's UI tests (A-01 launch performance, A-04 navigation) run Pica against `picad` with a FakeRuntime. Variables
# prefixed TEST_RUNNER_ reach the (sandboxed) test runner, which hands Pica the Node to start the engine with.
# UI_TEST=<Class>[/<method>] runs only those tests.
app-ui-test-pica: engine-install
	rm -rf app/.derived/pica-ui-tests.xcresult
	TEST_RUNNER_PICA_NODE="$$(command -v node)" xcodebuild -project app/Pica.xcodeproj -scheme Pica \
		-destination 'platform=macOS,arch=$(shell uname -m)' \
		$(if $(UI_TEST),-only-testing:PicaUITests/$(UI_TEST)) \
		-derivedDataPath app/.derived -resultBundlePath app/.derived/pica-ui-tests.xcresult test
