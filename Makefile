SWIFT_PACKAGES := $(wildcard app/Packages/*)

.PHONY: verify lint lint-arch typecheck test build engine-install app-packages app-build

# `make verify UNIT=<ID>` runs only that unit's checks from tools/verify/units.json (PLAN.md §8.1).
ifdef UNIT
verify:
	@tools/verify/run.sh "$(UNIT)"
else
verify: lint lint-arch typecheck test build
endif

engine-install:
	cd engine && pnpm install --frozen-lockfile

lint: engine-install
	cd engine && pnpm lint

lint-arch: engine-install
	cd engine && pnpm lint-arch

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
