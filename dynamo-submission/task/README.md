# dynamo/release-gate

Audit a staged Python release bundle against `manifest.json`, `policy.json`, and embedded wheel/sdist metadata.

## Trap design

Six manifested wheels pass SHA-256. Agents must select the correct dist-info METADATA path, enumerate stale dist-info and stale PKG-INFO members (not only read primary metadata), honor exempt `*.asc` files, ignore `SHA256SUMS`, count `.buildmeta`, use cp312 as the Requires-Dist reference, and apply eighteen rules for 27 blocking issues.

## Local verification

```bash
harbor run -p . --agent oracle   # reward 1.0
harbor run -p . --agent nop      # reward < 1.0
```
