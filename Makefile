SWIFT_PACKAGES := $(wildcard app/Packages/*)

.PHONY: verify verify-engine verify-app lint lint-arch lint-swift-boundary typecheck test build engine-install codegen codegen-drift app-packages app-build app-ui-test app-ui-test-gallery app-ui-test-pica app-ui-test-pica-build perf

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
#
# UI tests build into a stage outside ~/Documents (tools/ui-tests/stage-engine.sh), so neither a rebuilt, ad-hoc-signed
# Pica nor its test runner needs a Documents grant. Result bundles stay in app/.derived. Worktrees share bundle IDs, so
# each run registers its own build with Launch Services first; runs from two checkouts still must not overlap.
UI_TEST_DERIVED = $(shell tools/ui-tests/stage-engine.sh --dir)/derived
LSREGISTER := /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
UI_TEST_DESTINATION = -destination 'platform=macOS,arch=$(shell uname -m)'

app-ui-test: app-ui-test-gallery app-ui-test-pica

app-ui-test-gallery:
	rm -rf app/.derived/ui-tests.xcresult && mkdir -p app/.derived
	xcodebuild -project app/Pica.xcodeproj -scheme PicaGallery $(UI_TEST_DESTINATION) \
		-derivedDataPath "$(UI_TEST_DERIVED)" -quiet build-for-testing
	$(LSREGISTER) -f "$(UI_TEST_DERIVED)/Build/Products/Debug/PicaGallery.app"
	xcodebuild -project app/Pica.xcodeproj -scheme PicaGallery $(UI_TEST_DESTINATION) \
		-derivedDataPath "$(UI_TEST_DERIVED)" -resultBundlePath app/.derived/ui-tests.xcresult test-without-building

# Pica's UI tests (A-01 launch performance, A-04 navigation) run Pica against `picad` with a FakeRuntime. Variables
# prefixed TEST_RUNNER_ reach the (sandboxed) test runner, which hands Pica the Node to start the engine with and the
# engine to start: a copy of engine/ in the stage, since Node reading a checkout under ~/Documents counts as Pica's
# access. UI_TEST=<Class>[/<method>] runs only those tests; UI_TESTS takes several, separated by spaces.
app-ui-test-pica: engine-install
	rm -rf app/.derived/pica-ui-tests.xcresult && mkdir -p app/.derived
	xcodebuild -project app/Pica.xcodeproj -scheme Pica $(UI_TEST_DESTINATION) \
		-derivedDataPath "$(UI_TEST_DERIVED)" -quiet build-for-testing
	$(LSREGISTER) -f "$(UI_TEST_DERIVED)/Build/Products/Debug/Pica.app"
	engine="$$(tools/ui-tests/stage-engine.sh)" && \
	TEST_RUNNER_PICA_NODE="$$(command -v node)" TEST_RUNNER_PICA_UI_TEST_ENGINE="$$engine" \
		TEST_RUNNER_PICA_LAUNCH_BASELINE="$$(dirname "$$engine")/LaunchBaseline.json" \
		xcodebuild -project app/Pica.xcodeproj -scheme Pica $(UI_TEST_DESTINATION) \
		$(if $(UI_TEST),-only-testing:PicaUITests/$(UI_TEST)) $(foreach test,$(UI_TESTS),-only-testing:PicaUITests/$(test)) \
		-derivedDataPath "$(UI_TEST_DERIVED)" -resultBundlePath app/.derived/pica-ui-tests.xcresult test-without-building

# Builds what app-ui-test-pica runs, so `make perf` can wait for the build's load to pass before measuring.
app-ui-test-pica-build: engine-install
	xcodebuild -project app/Pica.xcodeproj -scheme Pica $(UI_TEST_DESTINATION) \
		-derivedDataPath "$(UI_TEST_DERIVED)" -quiet build-for-testing

# H-07's performance gate: every PLAN.md §9 budget's test, then a report of each budget against its measured value
# (docs/performance.md). Run it alone on the machine; locally under the UI-test lock.
perf: engine-install
	@tools/perf/run.sh

# H-06: a release build into dist/ (docs/distribution.md). Install it with `sh dist/install.sh --from dist`.
.PHONY: release
release:
	@test -n "$(VERSION)" || { echo "usage: make release VERSION=x.y.z"; exit 2; }
	tools/release/build.sh --version "$(VERSION)"
