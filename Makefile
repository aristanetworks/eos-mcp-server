.PHONY: all build typecheck lint static-policy test test-integration clean pack install-deps

VERSION := $(shell node -p "require('./package.json').version")

all: lint typecheck test pack install

install-deps:
	npm ci

build:
	npm run build

typecheck:
	npm run typecheck

lint:
	npm run lint

static-policy:
	npm run static-policy

test:
	npm test

test-integration:
	INTEGRATION=1 npm test

clean:
	rm -rf dist *.tgz

pack: clean
	npm pack
	@echo "Packaged eos-mcp-server-$(VERSION).tgz"

install:
	npm install -g ./eos-mcp-server-$(VERSION).tgz
