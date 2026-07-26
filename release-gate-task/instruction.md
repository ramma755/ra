A Python release bundle is under `/app/bundle/` (`manifest.json`, `policy.json`, `artifacts/`). Audit it and write `/app/release_gate.json`. Do not modify `/app/bundle/`.

Report keys: `release_version` (from manifest), `gate_passed` (true iff zero issues), `blocking_issue_count`, `blocking_issues` (`{code,path,detail}` sorted by (`code`,`path`,`detail`) UTF-8), `manifested_artifact_count`, `disk_artifact_count` (regular files directly under `/app/bundle/artifacts/` only). Subdirectory files (e.g. `/app/bundle/artifacts/_internal/README.txt`) are neither counted nor reported as `UNMANIFESTED_ARTIFACT`.

`path` is the artifact basename, or `""` for manifest-level issues. Emit every applicable issue (no dedup). If a `.tar.gz` is on disk but absent from `manifest.json` while `policy.require_sdist_in_manifest` is true, emit both `SDIST_MISSING_FROM_MANIFEST` and `UNMANIFESTED_ARTIFACT`.

Use PEP 440. Hash on-disk bytes only (ignore `SHA256SUMS`). Unfold RFC 822 continuations in `METADATA`/`PKG-INFO`. Wheels: select `{project}-{manifest_entry.version}.dist-info/METADATA` with the literal manifest `version` string (do not normalize the path) for rules 5 and 8–15; scan other `*.dist-info/METADATA` for rule 17. Rule 15 uses only the first `Tag:` in that dist-info `WHEEL`. `.tar.gz`: primary `{basename_without_suffix}/PKG-INFO` for rule 10; other `*/PKG-INFO` for rule 18. Strip PEP 508 markers and extras from `Requires-Dist`, then normalize to lowercase name plus `=={specifier}` (`{specifier}` = packaging SpecifierSet string) or name only; compare sorted sets to the first manifest `.whl`. Skip `UNMANIFESTED_ARTIFACT` when the basename matches `policy.unmanifested_exempt_globs`.

Exact detail templates (substitute braced values only):

1. `UNMANIFESTED_ARTIFACT` — regular file directly under `/app/bundle/artifacts/` not in `manifest.json` (unless exempt). Ignore subdirectory files.
   detail: `file exists under artifacts/ but is not listed in manifest.json`

2. `MISSING_ARTIFACT` — manifest entry missing on disk.
   detail: `manifest entry is absent from artifacts/`

3. `CHECKSUM_MISMATCH` — SHA-256 (lowercase hex) != manifest `sha256`.
   detail: `sha256 {computed} != manifest {expected}`

4. `SIZE_MISMATCH` — byte length != manifest `size_bytes`.
   detail: `size {actual} != manifest {expected}`

5. `METADATA_VERSION_MISMATCH` — selected `METADATA` `Version` not PEP 440-equal to manifest entry `version`.
   detail: `METADATA Version {metadata_version} is not PEP 440-equal to manifest version {manifest_version}`

6. `FORBIDDEN_WHEEL_TAG` — filename wheel tag (last three hyphen segments before `.whl`) contains a `forbidden_tag_substrings` entry.
   detail: `wheel tag contains forbidden substring '{substring}'`

7. `PYTHON_TAG_BELOW_MINIMUM` — `cpNNN` in tag implies CPython `3.N` below `minimum_python_version` (includes `abi3`).
   detail: `wheel tag implies Python 3.{minor}, below policy minimum_python_version {policy_version}`

8. `REQUIRES_DIST_MISMATCH` — when `requires_dist_must_match_across_wheels` is true, normalized set differs from the first manifest `.whl`.
   detail: `Requires-Dist set differs from {reference_basename}`

9. `SDIST_MISSING_FROM_MANIFEST` — `require_sdist_in_manifest` true and no manifest path ends in `.tar.gz`.
   detail: `policy requires a .tar.gz entry in manifest.json but none is listed`

10. `SDIST_METADATA_VERSION_MISMATCH` — primary `PKG-INFO` `Version` not PEP 440-equal to `release_version`.
    detail: `PKG-INFO Version {pkginfo_version} is not PEP 440-equal to release_version {release_version}`

11. `WHEEL_RELEASE_VERSION_MISMATCH` — selected `METADATA` `Version` not PEP 440-equal to `release_version`.
    detail: `METADATA Version {metadata_version} is not PEP 440-equal to release_version {release_version}`

12. `WHEEL_FILENAME_VERSION_MISMATCH` — filename version (second hyphen field, PEP 427) not PEP 440-equal to manifest entry `version`.
    detail: `wheel filename version {filename_version} is not PEP 440-equal to manifest version {manifest_version}`

13. `METADATA_NAME_MISMATCH` — PEP 503-normalized selected `Name` != normalized `project`.
    detail: `METADATA Name {metadata_name} normalizes to {normalized_metadata_name}, manifest project {project_name} normalizes to {normalized_project_name}`

14. `MANIFEST_ARTIFACT_RELEASE_VERSION_MISMATCH` — manifest entry `version` not PEP 440-equal to `release_version`.
    detail: `manifest artifact version {artifact_version} is not PEP 440-equal to release_version {release_version}`

15. `WHEEL_INTERNAL_TAG_MISMATCH` — first `WHEEL` `Tag:` != filename wheel tag.
    detail: `WHEEL file Tag {internal_tag} differs from filename wheel tag {filename_tag}`

16. `MISSING_SIGNATURE_SIDECAR` — when `require_wheel_signature_sidecars` is true, `{basename}.asc` missing.
    detail: `missing required signature sidecar {sidecar_basename}`

17. `STALE_DIST_INFO_VERSION_MISMATCH` — other `*.dist-info/METADATA` `Version` not PEP 440-equal to manifest entry `version`. `{dist_info_name}` is the directory basename without `.dist-info` (e.g. `widgetlib-2.0.9.dist-info/` → `widgetlib-2.0.9`).
    detail: `stale dist-info {dist_info_name} Version {stale_version} is not PEP 440-equal to manifest version {manifest_version}`

18. `STALE_PKGINFO_VERSION_MISMATCH` — non-primary `PKG-INFO` `Version` not PEP 440-equal to `release_version`.
    detail: `stale PKG-INFO at {member_path} Version {pkginfo_version} is not PEP 440-equal to release_version {release_version}`
