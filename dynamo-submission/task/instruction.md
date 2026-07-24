A Python library release bundle is staged under /app/bundle/. The manifest at /app/bundle/manifest.json lists the artifacts that are supposed to ship, and /app/bundle/policy.json states release-policy rules. The built files themselves live in /app/bundle/artifacts/.

Audit the bundle and write /app/release_gate.json. Do not modify any file under /app/bundle/.

The report must be a single JSON object with exactly these keys:
- "release_version": string, copied from manifest.json release_version.
- "gate_passed": boolean, true only when there are zero blocking issues.
- "blocking_issue_count": integer, the number of entries in blocking_issues.
- "blocking_issues": array of objects, each with keys "code" (string), "path" (string), and "detail" (string). Sort the array ascending by (code, path, detail) as UTF-8 strings.
- "manifested_artifact_count": integer, the number of entries in manifest.json artifacts.
- "disk_artifact_count": integer, the number of regular files directly under /app/bundle/artifacts/ (not subdirectories).

Emit a blocking issue for every rule violation below (the same file may trigger multiple issues):
1. UNMANIFESTED_ARTIFACT — a file exists under /app/bundle/artifacts/ but its basename is not listed in manifest.json artifacts.path.
2. MISSING_ARTIFACT — a manifest.json entry has no matching file under /app/bundle/artifacts/.
3. CHECKSUM_MISMATCH — a manifested file's SHA-256 digest (lowercase hex) does not equal the manifest sha256 field.
4. SIZE_MISMATCH — a manifested file's byte length does not equal the manifest size_bytes field.
5. METADATA_VERSION_MISMATCH — for a manifested .whl file, the Version field in {name}-{version}.dist-info/METADATA does not equal that entry's version field in manifest.json.
6. FORBIDDEN_WHEEL_TAG — for a manifested .whl file, the wheel tag (the last three hyphen-separated segments of the filename before .whl) contains any substring listed in policy.json forbidden_tag_substrings.
7. SDIST_MISSING_FROM_MANIFEST — policy.json require_sdist_in_manifest is true and manifest.json contains no artifacts.path ending in .tar.gz.
8. SDIST_METADATA_VERSION_MISMATCH — for every .tar.gz file under /app/bundle/artifacts/, the Version field in the top-level PKG-INFO member inside the archive does not equal manifest.json release_version.

You have 900 seconds to complete this task. Do not cheat by using online solutions or hints specific to this task.
