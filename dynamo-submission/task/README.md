# dynamo/release-gate

Audit a staged Python release bundle (wheels + sdist) against `manifest.json` and `policy.json`, producing a release gate report at `/app/release_gate.json`.

## Trap design

The two wheels listed in the manifest both pass SHA-256 verification. A naive agent that stops after checksum validation will incorrectly set `gate_passed: true`. The real failures are policy and metadata issues: forbidden `manylinux2014` tag, sdist omitted from manifest, and PKG-INFO version skew.

## Local verification

```bash
harbor run -p . --agent oracle   # reward 1.0
harbor run -p . --agent nop      # reward < 1.0
```
