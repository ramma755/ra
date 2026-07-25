An Apache-style access log is at /app/access.log. Parse it and write a JSON summary to /app/report.json.

The report must be a single JSON object with exactly these keys:
- "total_requests": integer, the number of non-empty log lines.
- "unique_ips": integer, the count of distinct client IP addresses (the first whitespace-separated field on each line).
- "top_path": string, the request path that appears most often across all requests (the path from the HTTP request line, e.g. "/index.html").

Do not modify /app/access.log.

You have 120 seconds to complete this task. Do not cheat by using online solutions or hints specific to this task.
