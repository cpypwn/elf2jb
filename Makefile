PS5_PAYLOAD_SDK ?= /workspace/toolchains/ps5-payload-sdk
HOST_CC ?= cc
QUICKJS := vendor/quickjs
RUNTIME_SOURCES := src/runtime.c build/assets.c $(QUICKJS)/quickjs.c $(QUICKJS)/dtoa.c $(QUICKJS)/libregexp.c $(QUICKJS)/libunicode.c $(QUICKJS)/cutils.c vendor/sha256/sha256.c
RUNTIME_FLAGS := -std=gnu11 -O2 -I$(QUICKJS) -Ivendor/sha256 -DCONFIG_VERSION=\"2026-06-04\" -D_GNU_SOURCE -Wno-macro-redefined
NATIVE_OBJECTS := $(patsubst %.c,build/native/%.o,$(RUNTIME_SOURCES))
PS5_OBJECTS := $(patsubst %.c,build/ps5/%.o,$(RUNTIME_SOURCES))

.PHONY: all native test clean runtime-native runtime-test browser-test shortcut-test catalog-test pages-test
all: build/elf2jb-preflight.elf build/elf2jb-host.elf

build/elf2jb-open-browser.elf: src/open_browser.c | build
	$(PS5_PAYLOAD_SDK)/bin/prospero-clang -std=gnu11 -O2 -Wall -Wextra -Werror -o $@ $< -lSceSystemService -lSceUserService

build/elf2jb-shortcut.elf: build/ps5/src/media_shortcut_main.o build/ps5/src/media_shortcut.o build/ps5/build/assets.o
	$(PS5_PAYLOAD_SDK)/bin/prospero-clang -o $@ $^

build/assets.c: scripts/embed.py $(shell find runtime upstream assets -type f) build/elf2jb-open-browser.elf | build
	python3 scripts/embed.py

build/elf2jb-host.elf: $(PS5_OBJECTS)
	$(PS5_PAYLOAD_SDK)/bin/prospero-clang -pthread -o $@ $^

build/elf2jb-host: $(NATIVE_OBJECTS)
	$(HOST_CC) -pthread -o $@ $^ -lm

build/native/%.o: %.c
	mkdir -p $(dir $@)
	$(HOST_CC) $(RUNTIME_FLAGS) -c -o $@ $<

build/ps5/%.o: %.c
	mkdir -p $(dir $@)
	$(PS5_PAYLOAD_SDK)/bin/prospero-clang $(RUNTIME_FLAGS) -Wno-unreachable-code-generic-assoc -c -o $@ $<

runtime-native: build/elf2jb-host

runtime-test: runtime-native
	build/elf2jb-host $(CURDIR) $(CURDIR)/tests/runtime-tests.cjs
	python3 tests/host_smoke.py

build/browser-helper-native: src/open_browser.c tests/browser_api_stubs.c | build
	$(HOST_CC) -std=gnu11 -D_GNU_SOURCE -DELF2JB_BROWSER_WAIT_MS=1000 -O2 -Wall -Wextra -Werror -o $@ $^

browser-test: build/browser-helper-native
	python3 tests/browser_helper.py

build/media-shortcut-driver: tests/media_shortcut_driver.c src/media_shortcut.c src/media_shortcut.h build/assets.c
	$(HOST_CC) -std=gnu11 -D_GNU_SOURCE -Wall -Wextra -Werror -Isrc -o $@ tests/media_shortcut_driver.c src/media_shortcut.c build/assets.c

shortcut-test: build/media-shortcut-driver
	python3 tests/media_shortcut.py

catalog-test:
	python3 tests/payload_catalog.py

pages-test:
	python3 tests/pages.py

build/native/src/runtime.o build/native/src/media_shortcut.o build/ps5/src/runtime.o build/ps5/src/media_shortcut.o: src/media_shortcut.h

build:
	mkdir -p $@

build/elf2jb-preflight.elf: src/preflight.c | build
	$(PS5_PAYLOAD_SDK)/bin/prospero-clang -std=c11 -O2 -Wall -Wextra -Werror -pthread -o $@ $<

native: build/elf2jb-preflight
build/elf2jb-preflight: src/preflight.c | build
	$(HOST_CC) -std=c11 -D_POSIX_C_SOURCE=200809L -O2 -Wall -Wextra -Werror -pthread -o $@ $<

test: native
	python3 tests/preflight.py

clean:
	rm -f build/elf2jb-preflight build/elf2jb-preflight.elf
