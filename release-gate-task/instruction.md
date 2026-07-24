A Python library release bundle is staged under /app/bundle/. The manifest at /app/bundle/manifest.json lists the artifacts that are supposed to ship, /app/bundle/policy.json states release-policy rules, and the built files live in /app/bundle/artifacts/.

Audit the bundle and write /app/release_gate.json. Do not modify any file under /app/bundle/.

The report must be a single JSON object with exactly these keys:
- "release_version": string, copied from manifest.json release_version.
- "gate_passed": boolean, true only when there are zero blocking issues.
- "blocking_issue_count": integer, the number of entries in blocking_issues.
- "blocking_issues": array of objects, each with keys "code" (string), "path" (string), and "detail" (string). Sort the array ascending by (code, path, detail) as UTF-8 strings.
- "manifested_artifact_count": integer, the number of entries in manifest.json artifacts.
- "disk_artifact_count": integer, the number of regular files directly under /app/bundle/artifacts/ (not subdirectories).

Path convention: "path" is always the artifact basename (filename only) for file-specific issues, or the empty string "" for manifest-level issues.

When the same root cause triggers multiple rules, emit every applicable issue — do not deduplicate. In particular, if a .tar.gz file is present on disk but absent from manifest.json while policy.require_sdist_in_manifest is true, you must emit both SDIST_MISSING_FROM_MANIFEST and UNMANIFESTED_ARTIFACT.

Use packaging.version.Version for PEP 440 version comparisons. Normalize each Requires-Dist line with packaging.requirements.Requirement and compare sets across wheels as sorted tuples of "{name.lower()}=={specifier}" strings (omit "==" when the requirement has no specifier).

Emit a blocking issue for every rule violation below (the same file may trigger multiple issues). Use the exact detail template shown (substitute only the braced values):

1. UNMANIFESTED_ARTIFACT — file on disk not listed in manifest.
   detail: file exists under artifacts/ but is not listed in manifest.json

2. MISSING_ARTIFACT — manifest entry missing on disk.
   detail: manifest entry is absent from artifacts/

3. CHECKSUM_MISMATCH — SHA-256 (lowercase hex) of file bytes != manifest sha256.
   detail: sha256 {computed} != manifest {expected}

4. SIZE_MISMATCH — byte length != manifest size_bytes.
   detail: size {actual} != manifest {expected}

5. METADATA_VERSION_MISMATCH — for a manifested .whl, METADATA Version is not PEP 440-equal to that entry's version field in manifest.json.
   detail: METADATA Version {metadata_version} is not PEP 440-equal to manifest version {manifest_version}

6. FORBIDDEN_WHEEL_TAG — for a manifested .whl, the wheel tag (last three hyphen-separated segments before .whl) contains a policy.json forbidden_tag_substrings entry.
   detail: wheel tag contains forbidden substring '{substring}'

7. PYTHON_TAG_BELOW_MINIMUM — for a manifested .whl whose tag contains cpNNN, derive CPython 3.N (e.g. cp310 → 3.10) and compare to policy.minimum_python_version using PEP 440 Version ordering.
   detail: wheel tag implies Python 3.{minor}, below policy minimum_python_version {policy_version}

8. REQUIRES_DIST_MISMATCH — when policy.requires_dist_must_match_across_wheels is true, a manifested .whl's normalized Requires-Dist set differs from the first manifested .whl in manifest.json artifacts array order.
   detail: Requires-Dist set differs from {reference_basename}

9. SDIST_MISSING_FROM_MANIFEST — policy.require_sdist_in_manifest is true and no manifest artifacts.path ends in .tar.gz.
   detail: policy requires a .tar.gz entry in manifest.json but none is listed

10. SDIST_METADATA_VERSION_MISMATCH — for every .tar.gz under artifacts/, PKG-INFO Version is not PEP 440-equal to manifest.json release_version.
    detail: PKG-INFO Version {pkginfo_version} is not PEP 440-equal to release_version {release_version}

You have 900 seconds to complete this task. Do not cheat by using online solutions or hints specific to this task.
