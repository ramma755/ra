from __future__ import annotations

from dataclasses import dataclass


@dataclass
class PIDController:
    """Small PID controller with output clamping for flight control loops."""

    kp: float
    ki: float
    kd: float
    minimum: float
    maximum: float
    integral: float = 0.0
    previous_error: float = 0.0

    def update(self, target: float, measured: float, dt: float) -> float:
        if dt <= 0:
            raise ValueError("dt must be greater than zero")

        error = target - measured
        self.integral += error * dt
        derivative = (error - self.previous_error) / dt
        self.previous_error = error

        output = self.kp * error + self.ki * self.integral + self.kd * derivative
        return max(self.minimum, min(self.maximum, output))
