# dynamo/release-gate

Audit a staged Python release bundle against `manifest.json`, `policy.json`, and embedded wheel/sdist metadata.

## Trap design

All three manifested wheels pass SHA-256 verification. Failures require PEP 440 version comparison (`2.0.9.post1` vs `2.0.9`), Requires-Dist set matching across wheels, cp310 tag below minimum Python 3.11, forbidden `manylinux2014` tag, and sdist manifest/metadata issues.

## Local verification

```bash
harbor run -p . --agent oracle   # reward 1.0
harbor run -p . --agent nop      # reward < 1.0
```
