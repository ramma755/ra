import unittest

from drone_control.simulator import QuadcopterSimulator, summarize


class QuadcopterSimulatorTest(unittest.TestCase):
    def test_simulation_reduces_stabilization_error(self):
        simulator = QuadcopterSimulator(seed=3)
        samples = simulator.run(
            seconds=8,
            target_roll=0,
            target_pitch=0,
            target_altitude=10,
        )
        summary = summarize(samples)

        self.assertGreater(summary["error_reduction_percent"], 20)
        self.assertLess(summary["final_error"], summary["initial_error"])


if __name__ == "__main__":
    unittest.main()
