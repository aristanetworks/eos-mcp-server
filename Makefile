.PHONY: all build typecheck test test-integration clean pack install-deps

VERSION := $(shell node -p "require('./package.json').version")

all: typecheck test build pack install

install-deps:
	npm ci

build:
	npm run build

typecheck:
	npm run typecheck

test:
	npm test

test-integration:
	INTEGRATION=1 npm test

clean:
	rm -rf dist *.tgz

pack: clean build
	npm pack
	@echo "Packaged eos-mcp-server-$(VERSION).tgz"

install:
	npm install -g ./eos-mcp-server-$(VERSION).tgz
