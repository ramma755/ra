from pathlib import Path
import unittest

from ai_code_review.reviewer import CodeReviewer


class CodeReviewerTest(unittest.TestCase):
    def test_sample_diff_reports_security_and_reliability_findings(self):
        sample_diff = Path("examples/sample_pr.diff")
        findings = CodeReviewer().review_path(sample_diff)
        categories = {finding.category for finding in findings}

        self.assertIn("security", categories)
        self.assertIn("reliability", categories)
        self.assertIn("testability", categories)


if __name__ == "__main__":
    unittest.main()
