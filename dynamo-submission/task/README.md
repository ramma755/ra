# dynamo/release-gate

Audit a staged Python release bundle against `manifest.json`, `policy.json`, and embedded wheel/sdist metadata.

## Trap design

All four manifested wheels pass SHA-256 verification. Failures require RFC 822 METADATA unfolding, PEP 440 comparisons against manifest entry versions and `release_version`, PEP 427 filename-version parsing, embedded `WHEEL` Tag vs filename tag comparison, PEP 503 name normalization, signature sidecar policy, Requires-Dist set matching (reference wheel uses a folded certifi line), cp310 tag below minimum Python 3.11, forbidden `manylinux2014` tag, sdist manifest/metadata issues, and unmanifested decoys (`SHA256SUMS`, orphan `.asc`).

## Local verification

```bash
harbor run -p . --agent oracle   # reward 1.0
harbor run -p . --agent nop      # reward < 1.0
```
