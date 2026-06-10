# Autonomous Drone Control System

Resume source: "Developed embedded software for a quadcopter's flight
controller, incorporating sensor fusion algorithms and PID controllers. Reduced
stabilization error by 30%."

This starter models the control loop in Python so it can be run without drone
hardware. It includes:

- PID controllers for roll, pitch, and altitude
- A complementary filter that fuses gyro and accelerometer angle estimates
- A repeatable simulator that applies disturbance and reports stabilization
  error

## Run

```bash
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -e .
drone-sim --seconds 8
```

## Try different targets

```bash
drone-sim --target-roll 3 --target-pitch -2 --target-altitude 12
```
