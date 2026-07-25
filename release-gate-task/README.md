# dynamo/release-gate

Audit a staged Python release bundle against `manifest.json`, `policy.json`, and embedded wheel/sdist metadata.

## Trap design

Five manifested wheels pass SHA-256. Failures need RFC 822 unfolding, `{project}-{manifest_version}.dist-info/METADATA` selection (decoy dist-info trees present), PEP 440 compares (`2.0.09` equals `2.0.9`), policy-exempt `*.asc` sidecars, ignoring `SHA256SUMS`, dotfile `.buildmeta`, cp312 as Requires-Dist reference (not universal), internal WHEEL Tag mismatch, cp39 abi3 below Python 3.11, and sdist manifest gaps.

## Local verification

```bash
harbor run -p . --agent oracle   # reward 1.0
harbor run -p . --agent nop      # reward < 1.0
```
