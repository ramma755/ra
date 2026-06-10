from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ComplementaryFilter:
    """Fuse fast gyro integration with slower accelerometer angle estimates."""

    alpha: float = 0.96
    angle: float = 0.0

    def update(self, gyro_rate: float, accelerometer_angle: float, dt: float) -> float:
        if not 0 <= self.alpha <= 1:
            raise ValueError("alpha must be between 0 and 1")

        gyro_angle = self.angle + gyro_rate * dt
        self.angle = self.alpha * gyro_angle + (1 - self.alpha) * accelerometer_angle
        return self.angle
