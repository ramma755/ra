# AI Code Review Tool

Resume source: "Created a prototype tool that leverages large language models
to assist in code reviews. Designed prompts and evaluation criteria, and
integrated the tool with GitHub pull requests."

This local prototype does not require an LLM API key. It demonstrates the
workflow with deterministic review rules and prompt templates that can be
replaced by an LLM provider later.

## Features

- Reviews Python files or unified diffs
- Scores findings by severity
- Uses structured review criteria for correctness, reliability, maintainability,
  security, and testability
- Emits plain text, Markdown, or a GitHub pull request comment payload

## Run

```bash
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -e .
ai-review examples/sample_pr.diff --format markdown
```

## GitHub payload example

```bash
ai-review examples/sample_pr.diff --format github-comment
```
