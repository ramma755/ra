from __future__ import annotations

import math
from dataclasses import asdict, dataclass


@dataclass
class TelemetryFrame:
    mission_time: float
    altitude_km: float
    velocity_mps: float
    acceleration_g: float
    engine_temp_c: float
    fuel_percent: float
    phase: str

    def to_dict(self) -> dict[str, float | str]:
        return asdict(self)


class TelemetryGenerator:
    def frame_at(self, mission_time: float) -> TelemetryFrame:
        phase = self._phase_for_time(mission_time)
        altitude_km = max(0.0, 0.075 * mission_time**1.42)
        velocity_mps = 120 + 32 * mission_time + 70 * math.sin(mission_time / 7)
        acceleration_g = 1.1 + 0.35 * math.sin(mission_time / 3)
        engine_temp_c = 540 + 95 * math.sin(mission_time / 9) + mission_time * 1.8
        fuel_percent = max(0.0, 100 - mission_time * 0.72)

        return TelemetryFrame(
            mission_time=round(mission_time, 2),
            altitude_km=round(altitude_km, 3),
            velocity_mps=round(velocity_mps, 2),
            acceleration_g=round(acceleration_g, 3),
            engine_temp_c=round(engine_temp_c, 1),
            fuel_percent=round(fuel_percent, 2),
            phase=phase,
        )

    def snapshot(self, count: int = 24, step: float = 1.5) -> list[dict[str, float | str]]:
        return [self.frame_at(index * step).to_dict() for index in range(count)]

    @staticmethod
    def _phase_for_time(mission_time: float) -> str:
        if mission_time < 10:
            return "liftoff"
        if mission_time < 35:
            return "max-q"
        if mission_time < 70:
            return "upper-stage"
        return "coast"
