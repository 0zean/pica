SWIFT_PACKAGES := $(wildcard app/Packages/*)

.PHONY: verify lint typecheck test build engine-install app-packages app-build

verify: lint typecheck test build

engine-install:
	cd engine && pnpm install --frozen-lockfile

lint: engine-install
	cd engine && pnpm lint

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
