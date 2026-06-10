import unittest

from telemetry_dashboard.generator import TelemetryGenerator


class TelemetryGeneratorTest(unittest.TestCase):
    def test_snapshot_contains_expected_fields(self):
        snapshot = TelemetryGenerator().snapshot(count=3, step=2)

        self.assertEqual(len(snapshot), 3)
        self.assertIn("altitude_km", snapshot[0])
        self.assertIn("velocity_mps", snapshot[0])
        self.assertIn("phase", snapshot[0])

    def test_phase_progression(self):
        generator = TelemetryGenerator()

        self.assertEqual(generator.frame_at(0).phase, "liftoff")
        self.assertEqual(generator.frame_at(20).phase, "max-q")
        self.assertEqual(generator.frame_at(50).phase, "upper-stage")


if __name__ == "__main__":
    unittest.main()
