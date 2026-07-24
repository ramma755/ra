# dynamo/log-report

Fixed Terminal-Bench 2 (Harbor) task: parse an Apache-style access log into a JSON summary report.

## Structure

- `task.toml` — Harbor task metadata and configuration
- `instruction.md` — Agent prompt with numbered success criteria
- `environment/` — Docker image with pinned base and input data
- `solution/` — Oracle reference solution
- `tests/` — Verifier that checks actual report values

## Verify locally

Requires Docker and [Harbor](https://github.com/laude-institute/harbor):

```bash
uv tool install harbor
harbor run -p log-report -a oracle   # should PASS (reward 1)
harbor run -p log-report --agent nop # should FAIL (reward 0)
```

## Fixes applied

- **task.toml**: `artifacts` corrected to `["/app/report.json"]` array with matching path
- **Dockerfile**: Pinned approved Python base by digest; removed leaked `solution_hint.py`
- **instruction.md**: Clear output path, JSON schema, and timeout line
- **tests**: Assert real computed values; write reward and ctrf to `/logs/verifier/`
