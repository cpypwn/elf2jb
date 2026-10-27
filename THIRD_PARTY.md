# Source provenance

The host engine in `upstream/` is retained unchanged from
https://gitlab.com/kurumuz/ns2jb at
`efcc2ca263606bc795d62da332505903ea158b5c`.
Its original README and payload hash manifest are included.

`vendor/quickjs/` contains the QuickJS interpreter from
https://github.com/bellard/quickjs at
`19d6bd865e709e2b5717fb4f2290c0cecc57ee4b` (VERSION 2026-06-04).
Its MIT license is included in that directory.

`vendor/sha256/` contains Brad Conte's SHA-256 implementation from
https://github.com/B-Con/crypto-algorithms at
`cfbde48414baacf51fc7c74f275190881f037d32`.
The upstream README, including its public-domain statement, is included.
It computes artifact hashes; entropy comes from the platform's
`arc4random_buf`, not this library.

The ELF is built and linked with the PS5 payload SDK at
https://github.com/ps5-payload-dev/sdk, commit
`a7685ce8e97ce1f8a4f38253a41d54241c9124f1` (GPL-3.0-or-later).
The new runtime glue and PS5 entrypoint use GPL-3.0-or-later.
The root `LICENSE` applies to that new code; third-party files retain
their original notices.

The mac2jb icon assets are the original PNG representations from
https://github.com/cpypwn/mac2jb/releases/tag/v0.4.3 (MIT). Their license,
release archive checksum and exact asset checksums are in `assets/`.
The Media shortcut mechanism follows the title-specific AppInstUtil API
and category/deeplink metadata used by itsPLK's Payload Manager at
`3f881e8e569eba3054d1784a1962439b2eee92c2` (GPL-3.0).
The new installer uses its own title ID, files and error-handling code.
