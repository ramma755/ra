# dynamo/release-gate

Audit a staged Python release bundle against `manifest.json`, `policy.json`, and embedded wheel/sdist metadata.

## Trap design

Seven manifested entries: six on-disk wheels plus one missing path. One wheel's manifest sha256/size are intentionally wrong (do not trust `SHA256SUMS`, which lists the real digest). Zip/tar member order lists decoy metadata before the selected/primary path. Dual `Tag:` lines punish last-Tag solvers. Requires-Dist uses extras and markers that must be stripped. Missing manifest paths emit only MISSING_ARTIFACT (no sidecar/checksum cascade). Agents must also honor exempt `*.asc`, count `.buildmeta`, ignore `_internal/`, and apply eighteen rules for 31 blocking issues.

## Local verification

```bash
harbor run -p . --agent oracle   # reward 1.0
harbor run -p . --agent nop      # reward < 1.0
```
