A Python release bundle is under `/app/bundle/` (`manifest.json`, `policy.json`, `artifacts/`). Audit it and write `/app/release_gate.json`. Do not modify `/app/bundle/`.

The report is one JSON object with exactly:
- `release_version`: string from `manifest.json` `release_version`
- `gate_passed`: boolean, true only with zero blocking issues
- `blocking_issue_count`: integer, length of `blocking_issues`
- `blocking_issues`: array of `{code, path, detail}` objects, sorted ascending by (`code`, `path`, `detail`) as UTF-8 strings
- `manifested_artifact_count`: integer, `manifest.json` `artifacts` length
- `disk_artifact_count`: integer, regular files directly under `/app/bundle/artifacts/` (not subdirectories)

`path` is the artifact basename for file issues, or `""` for manifest-level issues.

Emit every applicable issue — do not deduplicate. If a `.tar.gz` is on disk but not in `manifest.json` while `policy.require_sdist_in_manifest` is true, emit both `SDIST_MISSING_FROM_MANIFEST` and `UNMANIFESTED_ARTIFACT`.

Use PEP 440 for versions. Compute SHA-256 from on-disk bytes only (ignore auxiliary checksum files such as `SHA256SUMS`). Unfold RFC 822 continuation lines in `METADATA`/`PKG-INFO` (leading-space lines append to the prior header). For each manifested wheel, read only `{project}-{manifest_entry.version}.dist-info/METADATA` (ignore other `*.dist-info` trees). Strip PEP 508 environment markers from each unfolded `Requires-Dist` before normalizing to lowercase name plus `=={specifier}` when present (else name only); compare sorted sets across wheels. Skip `UNMANIFESTED_ARTIFACT` for disk files matching any `policy.unmanifested_exempt_globs` entry (shell glob rules).

Use the exact detail template for each violation (substitute only braced values):

1. `UNMANIFESTED_ARTIFACT` — disk file not in manifest (unless exempt by `unmanifested_exempt_globs`).
   detail: `file exists under artifacts/ but is not listed in manifest.json`

2. `MISSING_ARTIFACT` — manifest entry missing on disk.
   detail: `manifest entry is absent from artifacts/`

3. `CHECKSUM_MISMATCH` — file SHA-256 (lowercase hex) != manifest `sha256`.
   detail: `sha256 {computed} != manifest {expected}`

4. `SIZE_MISMATCH` — byte length != manifest `size_bytes`.
   detail: `size {actual} != manifest {expected}`

5. `METADATA_VERSION_MISMATCH` — selected wheel `METADATA` `Version` not PEP 440-equal to manifest entry `version`.
   detail: `METADATA Version {metadata_version} is not PEP 440-equal to manifest version {manifest_version}`

6. `FORBIDDEN_WHEEL_TAG` — manifested `.whl` tag (last three hyphen segments before `.whl`) contains a `forbidden_tag_substrings` entry.
   detail: `wheel tag contains forbidden substring '{substring}'`

7. `PYTHON_TAG_BELOW_MINIMUM` — manifested `.whl` with `cpNNN` in tag: derive CPython `3.N` (`cp310` → `3.10`) and compare to `minimum_python_version` via PEP 440.
   detail: `wheel tag implies Python 3.{minor}, below policy minimum_python_version {policy_version}`

8. `REQUIRES_DIST_MISMATCH` — when `requires_dist_must_match_across_wheels` is true, normalized `Requires-Dist` differs from the first manifest `.whl`.
   detail: `Requires-Dist set differs from {reference_basename}`

9. `SDIST_MISSING_FROM_MANIFEST` — `require_sdist_in_manifest` true and no manifest path ends in `.tar.gz`.
   detail: `policy requires a .tar.gz entry in manifest.json but none is listed`

10. `SDIST_METADATA_VERSION_MISMATCH` — every `.tar.gz` `PKG-INFO` `Version` not PEP 440-equal to `release_version`.
    detail: `PKG-INFO Version {pkginfo_version} is not PEP 440-equal to release_version {release_version}`

11. `WHEEL_RELEASE_VERSION_MISMATCH` — selected wheel `METADATA` `Version` not PEP 440-equal to `release_version`.
    detail: `METADATA Version {metadata_version} is not PEP 440-equal to release_version {release_version}`

12. `WHEEL_FILENAME_VERSION_MISMATCH` — manifested `.whl` filename version (second hyphen field per PEP 427) not PEP 440-equal to manifest entry `version`.
    detail: `wheel filename version {filename_version} is not PEP 440-equal to manifest version {manifest_version}`

13. `METADATA_NAME_MISMATCH` — PEP 503-normalized selected `METADATA` `Name` != normalized `manifest.json` `project`.
    detail: `METADATA Name {metadata_name} normalizes to {normalized_metadata_name}, manifest project {project_name} normalizes to {normalized_project_name}`

14. `MANIFEST_ARTIFACT_RELEASE_VERSION_MISMATCH` — manifest entry `version` not PEP 440-equal to `release_version`.
    detail: `manifest artifact version {artifact_version} is not PEP 440-equal to release_version {release_version}`

15. `WHEEL_INTERNAL_TAG_MISMATCH` — embedded `WHEEL` `Tag:` != filename-derived wheel tag.
    detail: `WHEEL file Tag {internal_tag} differs from filename wheel tag {filename_tag}`

16. `MISSING_SIGNATURE_SIDECAR` — when `require_wheel_signature_sidecars` is true, `{basename}.asc` missing from `artifacts/`.
    detail: `missing required signature sidecar {sidecar_basename}`
