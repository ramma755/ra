#!/usr/bin/env python3
"""Generate an AutoCAD-compatible floor plan from the supplied hand sketch.

The drawing is intentionally kept dependency-free so it can be regenerated in
any basic Python environment. Coordinates use millimetres and follow the sketch
orientation: 4800 wide by 4600 deep.
"""

from __future__ import annotations

import html
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "drawings"
DXF_PATH = OUT_DIR / "floor_plan_autocad.dxf"
SVG_PATH = OUT_DIR / "floor_plan_preview.svg"


LAYERS = {
    "SITE": {"color": 7, "svg": "#111111", "width": 2.2},
    "WALLS": {"color": 7, "svg": "#111111", "width": 3.0},
    "PARTITIONS": {"color": 7, "svg": "#111111", "width": 1.7},
    "DOORS": {"color": 7, "svg": "#111111", "width": 1.5},
    "WINDOWS": {"color": 5, "svg": "#1f4e79", "width": 1.4},
    "FIXTURES": {"color": 7, "svg": "#111111", "width": 1.2},
    "HATCH": {"color": 8, "svg": "#b8b8b8", "width": 0.8},
    "DIMENSIONS": {"color": 7, "svg": "#111111", "width": 1.0},
    "TEXT": {"color": 7, "svg": "#111111", "width": 1.0},
}


class Drawing:
    def __init__(self) -> None:
        self.entities: list[dict[str, object]] = []

    def line(
        self,
        x1: float,
        y1: float,
        x2: float,
        y2: float,
        layer: str = "WALLS",
    ) -> None:
        self.entities.append(
            {"type": "line", "x1": x1, "y1": y1, "x2": x2, "y2": y2, "layer": layer}
        )

    def rect(
        self,
        x1: float,
        y1: float,
        x2: float,
        y2: float,
        layer: str = "WALLS",
    ) -> None:
        self.line(x1, y1, x2, y1, layer)
        self.line(x2, y1, x2, y2, layer)
        self.line(x2, y2, x1, y2, layer)
        self.line(x1, y2, x1, y1, layer)

    def polyline(
        self,
        points: list[tuple[float, float]],
        layer: str = "WALLS",
        closed: bool = True,
    ) -> None:
        for (x1, y1), (x2, y2) in zip(points, points[1:]):
            self.line(x1, y1, x2, y2, layer)
        if closed:
            x1, y1 = points[-1]
            x2, y2 = points[0]
            self.line(x1, y1, x2, y2, layer)

    def arc(
        self,
        cx: float,
        cy: float,
        radius: float,
        start: float,
        end: float,
        layer: str = "DOORS",
    ) -> None:
        self.entities.append(
            {
                "type": "arc",
                "cx": cx,
                "cy": cy,
                "radius": radius,
                "start": start,
                "end": end,
                "layer": layer,
            }
        )

    def text(
        self,
        value: str,
        x: float,
        y: float,
        height: float = 85,
        layer: str = "TEXT",
        rotation: float = 0,
        center: bool = True,
    ) -> None:
        self.entities.append(
            {
                "type": "text",
                "value": value,
                "x": x,
                "y": y,
                "height": height,
                "rotation": rotation,
                "center": center,
                "layer": layer,
            }
        )

    def circle(self, cx: float, cy: float, radius: float, layer: str = "FIXTURES") -> None:
        self.entities.append(
            {"type": "circle", "cx": cx, "cy": cy, "radius": radius, "layer": layer}
        )


def point_at(cx: float, cy: float, radius: float, angle: float) -> tuple[float, float]:
    radians = math.radians(angle)
    return cx + radius * math.cos(radians), cy + radius * math.sin(radians)


def door(
    d: Drawing,
    hinge: tuple[float, float],
    radius: float,
    closed_angle: float,
    open_angle: float,
) -> None:
    hx, hy = hinge
    x2, y2 = point_at(hx, hy, radius, open_angle)
    d.line(hx, hy, x2, y2, "DOORS")
    start, end = sorted((closed_angle, open_angle))
    if abs(open_angle - closed_angle) > 180:
        start, end = end, start + 360
    d.arc(hx, hy, radius, start, end, "DOORS")


def window_h(d: Drawing, x1: float, x2: float, y: float) -> None:
    d.line(x1, y - 16, x2, y - 16, "WINDOWS")
    d.line(x1, y + 16, x2, y + 16, "WINDOWS")
    d.line(x1, y - 16, x1, y + 16, "WINDOWS")
    d.line(x2, y - 16, x2, y + 16, "WINDOWS")


def window_v(d: Drawing, x: float, y1: float, y2: float) -> None:
    d.line(x - 16, y1, x - 16, y2, "WINDOWS")
    d.line(x + 16, y1, x + 16, y2, "WINDOWS")
    d.line(x - 16, y1, x + 16, y1, "WINDOWS")
    d.line(x - 16, y2, x + 16, y2, "WINDOWS")


def hatch_rect(d: Drawing, x1: float, y1: float, x2: float, y2: float, spacing: float = 120) -> None:
    """Add light diagonal hatch lines to represent paved/open external areas."""
    start = x1 - (y2 - y1)
    stop = x2
    k = start
    while k <= stop:
        xa = max(x1, k)
        ya = y1 + max(0, x1 - k)
        xb = min(x2, k + (y2 - y1))
        yb = y1 + (xb - k)
        if xb > xa:
            d.line(xa, ya, xb, yb, "HATCH")
        k += spacing


def dimension_h(d: Drawing, x1: float, x2: float, y: float, label: str) -> None:
    d.line(x1, y, x2, y, "DIMENSIONS")
    d.line(x1, y - 45, x1, y + 45, "DIMENSIONS")
    d.line(x2, y - 45, x2, y + 45, "DIMENSIONS")
    d.line(x1 - 35, y - 35, x1 + 35, y + 35, "DIMENSIONS")
    d.line(x2 - 35, y - 35, x2 + 35, y + 35, "DIMENSIONS")
    d.text(label, (x1 + x2) / 2, y + 55, 70, "DIMENSIONS")


def dimension_v(d: Drawing, y1: float, y2: float, x: float, label: str) -> None:
    d.line(x, y1, x, y2, "DIMENSIONS")
    d.line(x - 45, y1, x + 45, y1, "DIMENSIONS")
    d.line(x - 45, y2, x + 45, y2, "DIMENSIONS")
    d.line(x - 35, y1 - 35, x + 35, y1 + 35, "DIMENSIONS")
    d.line(x - 35, y2 - 35, x + 35, y2 + 35, "DIMENSIONS")
    d.text(label, x - 55, (y1 + y2) / 2, 70, "DIMENSIONS", rotation=90)


def toilet(d: Drawing, x: float, y: float) -> None:
    d.rect(x - 55, y - 35, x + 55, y + 55, "FIXTURES")
    d.circle(x, y - 55, 42, "FIXTURES")


def sink(d: Drawing, x: float, y: float) -> None:
    d.rect(x - 85, y - 45, x + 85, y + 45, "FIXTURES")
    d.circle(x, y, 20, "FIXTURES")


def build_plan() -> Drawing:
    d = Drawing()

    # Site boundary and paved/open areas.
    d.rect(0, 0, 4800, 4600, "SITE")
    hatch_rect(d, 80, 80, 4720, 4520)

    # Large open court/void shown blank in the sketch.
    d.rect(260, 890, 1730, 3150, "SITE")
    d.text("OPEN COURT", 995, 2040, 90, "TEXT")

    # Parking structure.
    d.rect(2250, 3400, 3330, 4380, "WALLS")
    d.text("PARKING", 2790, 3935, 115, "TEXT", rotation=90)
    d.text("STRUCTURE", 2660, 3935, 115, "TEXT", rotation=90)

    # Top-left service rooms.
    service_rooms = [
        ("OUTSIDE\nTOILET", 150, 4050, 650, 4550),
        ("WASHROOM", 650, 3650, 950, 4550),
        ("BEDROOM", 950, 3650, 1300, 4550),
        ("SITTING\nROOM", 1300, 3650, 1650, 4550),
        ("KITCHEN", 1650, 3650, 2100, 4550),
    ]
    for label, x1, y1, x2, y2 in service_rooms:
        d.rect(x1, y1, x2, y2, "WALLS")
        parts = label.split("\n")
        for index, part in enumerate(parts):
            d.text(part, (x1 + x2) / 2, (y1 + y2) / 2 + (len(parts) - 1 - index) * 90, 70, "TEXT", rotation=90)
    door(d, (820, 3650), 210, 270, 180)
    door(d, (1110, 3650), 210, 270, 180)
    door(d, (1460, 3650), 210, 270, 180)
    door(d, (1850, 3650), 210, 270, 180)
    window_v(d, 150, 4200, 4440)
    window_h(d, 1680, 4550, 2030)

    # Security house and gate.
    d.rect(4300, 4250, 4750, 4550, "WALLS")
    d.text("SECURITY", 4525, 4435, 65, "TEXT")
    d.text("HOUSE", 4525, 4350, 65, "TEXT")
    d.line(4400, 3450, 4400, 4250, "SITE")
    for y in range(3470, 4250, 115):
        d.line(4400, y, 4720, min(y + 90, 4250), "DOORS")
    d.text("GATE", 4585, 3850, 115, "TEXT", rotation=90)

    # Main residential building, drawn as a compound of rooms from the sketch.
    d.rect(1300, 700, 4050, 2200, "WALLS")
    d.rect(2050, 1700, 3300, 2850, "WALLS")
    d.rect(2350, 2650, 4050, 3600, "WALLS")
    d.rect(3820, 1900, 4620, 2500, "WALLS")

    # Internal room divisions.
    d.line(1850, 700, 1850, 1700, "PARTITIONS")
    d.line(2600, 700, 2600, 1700, "PARTITIONS")
    d.line(1300, 1350, 1850, 1350, "PARTITIONS")
    d.line(3450, 700, 3450, 1200, "PARTITIONS")
    d.line(2600, 1200, 4050, 1200, "PARTITIONS")
    d.line(3025, 700, 3025, 1200, "PARTITIONS")
    d.line(3300, 1200, 3300, 2850, "PARTITIONS")
    d.line(3300, 2200, 4050, 2200, "PARTITIONS")
    d.line(3100, 2650, 3100, 3600, "PARTITIONS")
    d.line(2350, 2850, 4050, 2850, "PARTITIONS")
    d.line(3400, 2850, 3400, 3220, "PARTITIONS")
    d.line(3820, 1900, 3820, 2500, "PARTITIONS")

    # Room labels.
    labels = [
        ("LAUNDRY", 1575, 995, 85, 90),
        ("KITCHEN\nSTORE", 1575, 1490, 58, 90),
        ("KITCHEN", 2225, 1180, 90, 0),
        ("MAIN\nHALL", 2650, 2260, 95, 90),
        ("RM 2", 3675, 1690, 100, 0),
        ("RM 1", 3750, 965, 90, 0),
        ("WASHROOM", 2810, 965, 58, 90),
        ("WASHROOM", 3235, 965, 58, 90),
        ("RM 4", 2725, 3205, 95, 0),
        ("RM 3", 3720, 3225, 95, 0),
        ("WASHROOM", 2525, 2745, 58, 0),
        ("WASHROOM", 3250, 3035, 58, 90),
        ("PASSAGE", 3675, 2400, 75, 0),
        ("PASSAGE", 4060, 2185, 70, 90),
        ("MAIN\nENTRANCE", 4270, 2245, 70, 90),
    ]
    for value, x, y, height, rotation in labels:
        parts = value.split("\n")
        for index, part in enumerate(parts):
            d.text(part, x, y + (len(parts) - 1 - index) * height * 1.1, height, "TEXT", rotation=rotation)

    # Doors in the main building and entrance.
    door(d, (1800, 1350), 260, 0, 90)
    door(d, (1850, 960), 250, 180, 90)
    door(d, (2600, 1520), 260, 180, 90)
    door(d, (3300, 1880), 300, 180, 270)
    door(d, (3460, 1200), 270, 270, 180)
    door(d, (3900, 1200), 260, 270, 180)
    door(d, (3300, 2520), 280, 180, 90)
    door(d, (3100, 2890), 250, 180, 90)
    door(d, (2350, 3000), 260, 0, 90)
    door(d, (3820, 2200), 270, 180, 90)
    door(d, (4500, 2200), 320, 180, 90)
    door(d, (1500, 700), 280, 0, 90)
    door(d, (2060, 700), 270, 0, 90)

    # Windows distributed to match the visible window marks in the sketch.
    window_h(d, 3550, 3900, 700)
    window_h(d, 2700, 3020, 700)
    window_h(d, 2140, 2470, 700)
    window_h(d, 2500, 2830, 3600)
    window_h(d, 3420, 3830, 3600)
    window_v(d, 4050, 3050, 3380)
    window_v(d, 4050, 1450, 1780)
    window_v(d, 1300, 860, 1150)
    window_v(d, 1300, 1740, 2040)
    window_h(d, 1550, 2200, 2200)
    window_v(d, 4620, 2040, 2360)

    # Basic sanitary/kitchen fixtures so washrooms and service rooms remain clear.
    toilet(d, 2830, 835)
    sink(d, 2840, 1110)
    toilet(d, 3260, 835)
    sink(d, 3270, 1110)
    toilet(d, 3260, 2945)
    sink(d, 3350, 3120)
    sink(d, 2260, 810)
    sink(d, 1740, 760)

    # Dimensioning copied from the hand drawing.
    dimension_h(d, 0, 4800, -230, "4800")
    dimension_v(d, 0, 4600, -230, "4600")
    dimension_h(d, 1300, 1650, 360, "350")
    dimension_h(d, 1650, 1874, 360, "224")
    dimension_h(d, 1874, 2274, 360, "400")
    dimension_h(d, 2274, 2657, 360, "383")
    dimension_h(d, 260, 692, 3230, "432")
    dimension_h(d, 692, 1039, 3230, "347")
    dimension_h(d, 1039, 1659, 3230, "620")
    dimension_v(d, 0, 260, 5020, "260")
    dimension_v(d, 260, 624, 5020, "364")
    dimension_v(d, 624, 971, 5020, "347")
    dimension_v(d, 971, 1391, 5020, "420")

    # Drawing title.
    d.text("ARCHITECTURAL FLOOR PLAN FROM PROVIDED SKETCH", 2400, -520, 90, "TEXT")
    d.text("AutoCAD DXF | Units: millimetres | Scale reference from sketch dimensions", 2400, -660, 60, "TEXT")

    return d


def dxf_pair(code: int, value: object) -> str:
    return f"{code}\n{value}\n"


def write_dxf(drawing: Drawing, path: Path) -> None:
    parts: list[str] = []
    parts.append(dxf_pair(0, "SECTION"))
    parts.append(dxf_pair(2, "HEADER"))
    parts.append(dxf_pair(9, "$ACADVER"))
    parts.append(dxf_pair(1, "AC1009"))
    parts.append(dxf_pair(9, "$INSUNITS"))
    parts.append(dxf_pair(70, 4))
    parts.append(dxf_pair(0, "ENDSEC"))
    parts.append(dxf_pair(0, "SECTION"))
    parts.append(dxf_pair(2, "TABLES"))
    parts.append(dxf_pair(0, "TABLE"))
    parts.append(dxf_pair(2, "LAYER"))
    parts.append(dxf_pair(70, len(LAYERS)))
    for name, layer in LAYERS.items():
        parts.append(dxf_pair(0, "LAYER"))
        parts.append(dxf_pair(2, name))
        parts.append(dxf_pair(70, 0))
        parts.append(dxf_pair(62, layer["color"]))
        parts.append(dxf_pair(6, "CONTINUOUS"))
    parts.append(dxf_pair(0, "ENDTAB"))
    parts.append(dxf_pair(0, "ENDSEC"))
    parts.append(dxf_pair(0, "SECTION"))
    parts.append(dxf_pair(2, "ENTITIES"))

    for entity in drawing.entities:
        layer = entity["layer"]
        if entity["type"] == "line":
            parts.extend(
                [
                    dxf_pair(0, "LINE"),
                    dxf_pair(8, layer),
                    dxf_pair(10, f"{entity['x1']:.3f}"),
                    dxf_pair(20, f"{entity['y1']:.3f}"),
                    dxf_pair(30, "0.0"),
                    dxf_pair(11, f"{entity['x2']:.3f}"),
                    dxf_pair(21, f"{entity['y2']:.3f}"),
                    dxf_pair(31, "0.0"),
                ]
            )
        elif entity["type"] == "arc":
            parts.extend(
                [
                    dxf_pair(0, "ARC"),
                    dxf_pair(8, layer),
                    dxf_pair(10, f"{entity['cx']:.3f}"),
                    dxf_pair(20, f"{entity['cy']:.3f}"),
                    dxf_pair(30, "0.0"),
                    dxf_pair(40, f"{entity['radius']:.3f}"),
                    dxf_pair(50, f"{entity['start']:.3f}"),
                    dxf_pair(51, f"{entity['end']:.3f}"),
                ]
            )
        elif entity["type"] == "circle":
            parts.extend(
                [
                    dxf_pair(0, "CIRCLE"),
                    dxf_pair(8, layer),
                    dxf_pair(10, f"{entity['cx']:.3f}"),
                    dxf_pair(20, f"{entity['cy']:.3f}"),
                    dxf_pair(30, "0.0"),
                    dxf_pair(40, f"{entity['radius']:.3f}"),
                ]
            )
        elif entity["type"] == "text":
            parts.extend(
                [
                    dxf_pair(0, "TEXT"),
                    dxf_pair(8, layer),
                    dxf_pair(10, f"{entity['x']:.3f}"),
                    dxf_pair(20, f"{entity['y']:.3f}"),
                    dxf_pair(30, "0.0"),
                    dxf_pair(40, f"{entity['height']:.3f}"),
                    dxf_pair(1, str(entity["value"])),
                    dxf_pair(50, f"{entity['rotation']:.3f}"),
                    dxf_pair(7, "STANDARD"),
                ]
            )
            if entity["center"]:
                parts.extend(
                    [
                        dxf_pair(72, 1),
                        dxf_pair(73, 2),
                        dxf_pair(11, f"{entity['x']:.3f}"),
                        dxf_pair(21, f"{entity['y']:.3f}"),
                        dxf_pair(31, "0.0"),
                    ]
                )

    parts.append(dxf_pair(0, "ENDSEC"))
    parts.append(dxf_pair(0, "EOF"))
    path.write_text("".join(parts), encoding="ascii")


def svg_y(y: float) -> float:
    return 5200 - y


def write_svg(drawing: Drawing, path: Path) -> None:
    width = 5600
    height = 6200
    x_offset = 350
    y_offset = 700
    body: list[str] = []

    for entity in drawing.entities:
        layer = str(entity["layer"])
        style = LAYERS[layer]
        stroke = style["svg"]
        stroke_width = style["width"]
        if entity["type"] == "line":
            body.append(
                f'<line x1="{entity["x1"] + x_offset:.2f}" y1="{svg_y(float(entity["y1"])) + y_offset:.2f}" '
                f'x2="{entity["x2"] + x_offset:.2f}" y2="{svg_y(float(entity["y2"])) + y_offset:.2f}" '
                f'stroke="{stroke}" stroke-width="{stroke_width}" fill="none" />'
            )
        elif entity["type"] == "arc":
            cx = float(entity["cx"])
            cy = float(entity["cy"])
            radius = float(entity["radius"])
            start = float(entity["start"])
            end = float(entity["end"])
            x1, y1 = point_at(cx, cy, radius, start)
            x2, y2 = point_at(cx, cy, radius, end)
            large_arc = 1 if abs(end - start) > 180 else 0
            sweep = 0
            body.append(
                f'<path d="M {x1 + x_offset:.2f} {svg_y(y1) + y_offset:.2f} '
                f'A {radius:.2f} {radius:.2f} 0 {large_arc} {sweep} '
                f'{x2 + x_offset:.2f} {svg_y(y2) + y_offset:.2f}" '
                f'stroke="{stroke}" stroke-width="{stroke_width}" fill="none" />'
            )
        elif entity["type"] == "circle":
            body.append(
                f'<circle cx="{float(entity["cx"]) + x_offset:.2f}" cy="{svg_y(float(entity["cy"])) + y_offset:.2f}" '
                f'r="{float(entity["radius"]):.2f}" stroke="{stroke}" stroke-width="{stroke_width}" fill="none" />'
            )
        elif entity["type"] == "text":
            rotation = -float(entity["rotation"])
            text = html.escape(str(entity["value"]))
            x = float(entity["x"]) + x_offset
            y = svg_y(float(entity["y"])) + y_offset
            anchor = "middle" if entity["center"] else "start"
            body.append(
                f'<text x="{x:.2f}" y="{y:.2f}" font-family="Arial, Helvetica, sans-serif" '
                f'font-size="{float(entity["height"]):.2f}" text-anchor="{anchor}" '
                f'dominant-baseline="middle" fill="{stroke}" '
                f'transform="rotate({rotation:.2f} {x:.2f} {y:.2f})">{text}</text>'
            )

    path.write_text(
        "\n".join(
            [
                '<?xml version="1.0" encoding="UTF-8"?>',
                f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
                '<rect width="100%" height="100%" fill="white" />',
                *body,
                "</svg>",
            ]
        ),
        encoding="utf-8",
    )


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    drawing = build_plan()
    write_dxf(drawing, DXF_PATH)
    write_svg(drawing, SVG_PATH)
    print(f"Wrote {DXF_PATH.relative_to(ROOT)}")
    print(f"Wrote {SVG_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
