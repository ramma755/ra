from __future__ import annotations

from dataclasses import dataclass
from random import Random
from statistics import mean

from drone_control.pid import PIDController
from drone_control.sensor_fusion import ComplementaryFilter


@dataclass
class DroneState:
    roll: float = 8.0
    pitch: float = -6.0
    altitude: float = 4.0
    roll_rate: float = 0.0
    pitch_rate: float = 0.0
    climb_rate: float = 0.0


@dataclass
class SimulationSample:
    time: float
    roll: float
    pitch: float
    altitude: float
    stabilization_error: float


class QuadcopterSimulator:
    def __init__(self, seed: int = 7) -> None:
        self.random = Random(seed)
        self.state = DroneState()
        self.roll_filter = ComplementaryFilter()
        self.pitch_filter = ComplementaryFilter()
        self.roll_pid = PIDController(0.8, 0.05, 0.12, -12.0, 12.0)
        self.pitch_pid = PIDController(0.8, 0.05, 0.12, -12.0, 12.0)
        self.altitude_pid = PIDController(1.1, 0.08, 0.2, -8.0, 8.0)

    def run(
        self,
        seconds: float,
        target_roll: float,
        target_pitch: float,
        target_altitude: float,
        dt: float = 0.02,
    ) -> list[SimulationSample]:
        samples: list[SimulationSample] = []
        steps = int(seconds / dt)

        for step in range(steps):
            samples.append(
                self._step(
                    time=step * dt,
                    target_roll=target_roll,
                    target_pitch=target_pitch,
                    target_altitude=target_altitude,
                    dt=dt,
                )
            )

        return samples

    def _step(
        self,
        time: float,
        target_roll: float,
        target_pitch: float,
        target_altitude: float,
        dt: float,
    ) -> SimulationSample:
        measured_roll = self.roll_filter.update(
            gyro_rate=self.state.roll_rate + self.random.uniform(-0.04, 0.04),
            accelerometer_angle=self.state.roll + self.random.uniform(-0.35, 0.35),
            dt=dt,
        )
        measured_pitch = self.pitch_filter.update(
            gyro_rate=self.state.pitch_rate + self.random.uniform(-0.04, 0.04),
            accelerometer_angle=self.state.pitch + self.random.uniform(-0.35, 0.35),
            dt=dt,
        )

        roll_correction = self.roll_pid.update(target_roll, measured_roll, dt)
        pitch_correction = self.pitch_pid.update(target_pitch, measured_pitch, dt)
        throttle_correction = self.altitude_pid.update(
            target_altitude, self.state.altitude, dt
        )

        self._apply_physics(roll_correction, pitch_correction, throttle_correction, dt)

        stabilization_error = (
            abs(target_roll - self.state.roll)
            + abs(target_pitch - self.state.pitch)
            + abs(target_altitude - self.state.altitude)
        ) / 3

        return SimulationSample(
            time=time,
            roll=self.state.roll,
            pitch=self.state.pitch,
            altitude=self.state.altitude,
            stabilization_error=stabilization_error,
        )

    def _apply_physics(
        self,
        roll_correction: float,
        pitch_correction: float,
        throttle_correction: float,
        dt: float,
    ) -> None:
        wind_roll = self.random.uniform(-0.18, 0.18)
        wind_pitch = self.random.uniform(-0.18, 0.18)

        self.state.roll_rate += (roll_correction - 0.35 * self.state.roll_rate) * dt
        self.state.pitch_rate += (pitch_correction - 0.35 * self.state.pitch_rate) * dt
        self.state.climb_rate += (
            throttle_correction - 0.28 * self.state.climb_rate
        ) * dt

        self.state.roll += (self.state.roll_rate + wind_roll) * dt
        self.state.pitch += (self.state.pitch_rate + wind_pitch) * dt
        self.state.altitude = max(0.0, self.state.altitude + self.state.climb_rate * dt)


def summarize(samples: list[SimulationSample]) -> dict[str, float]:
    if not samples:
        raise ValueError("samples cannot be empty")

    midpoint = max(1, len(samples) // 2)
    initial_error = mean(sample.stabilization_error for sample in samples[:midpoint])
    final_error = mean(sample.stabilization_error for sample in samples[midpoint:])
    reduction = (initial_error - final_error) / initial_error * 100

    return {
        "initial_error": round(initial_error, 3),
        "final_error": round(final_error, 3),
        "error_reduction_percent": round(reduction, 1),
        "final_roll": round(samples[-1].roll, 3),
        "final_pitch": round(samples[-1].pitch, 3),
        "final_altitude": round(samples[-1].altitude, 3),
    }
