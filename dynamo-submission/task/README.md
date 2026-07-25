# dynamo/release-gate

Audit a staged Python release bundle against `manifest.json`, `policy.json`, and embedded wheel/sdist metadata.

## Trap design

All three manifested wheels pass SHA-256 verification. Failures require PEP 440 comparison against manifest entry versions and `release_version`, PEP 427 filename-version parsing, PEP 503 project-name normalization, Requires-Dist set matching across wheels, cp310 tag below minimum Python 3.11, forbidden `manylinux2014` tag, sdist manifest/metadata issues, and an unmanifested signature sidecar.

## Local verification

```bash
harbor run -p . --agent oracle   # reward 1.0
harbor run -p . --agent nop      # reward < 1.0
```
