"""Generate Revit-ready CAD/vector deliverables from the attached site sketch.

The source units are centimeters. The generated DXF sets INSUNITS to
centimeters so it can be imported into Revit at the intended scale.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from xml.sax.saxutils import escape


ROOT = Path(__file__).resolve().parent
DXF_PATH = ROOT / "compound_site_plan.dxf"
SVG_PATH = ROOT / "compound_site_plan.svg"


@dataclass(frozen=True)
class Line:
    x1: float
    y1: float
    x2: float
    y2: float
    layer: str = "A-WALL"
    dashed: bool = False


@dataclass(frozen=True)
class Rect:
    x: float
    y: float
    w: float
    h: float
    layer: str = "A-WALL"
    fill: str = "none"
    stroke_width: float = 8.0


@dataclass(frozen=True)
class Text:
    x: float
    y: float
    value: str
    height: float = 55.0
    layer: str = "A-ANNO-TEXT"
    rotation: float = 0.0
    anchor: str = "middle"


@dataclass(frozen=True)
class Arc:
    cx: float
    cy: float
    radius: float
    start: float
    end: float
    layer: str = "A-DOOR"


@dataclass(frozen=True)
class Poly:
    points: tuple[tuple[float, float], ...]
    layer: str = "A-SITE"
    closed: bool = False
    dashed: bool = False


Entity = Line | Rect | Text | Arc | Poly


LAYERS = {
    "A-SITE": ("7", "#111111"),
    "A-WALL": ("1", "#111111"),
    "A-DOOR": ("3", "#6b4e16"),
    "A-WINDOW": ("5", "#2b70b8"),
    "A-ANNO-TEXT": ("6", "#26358c"),
    "A-DIMS": ("2", "#111111"),
    "A-HATCH": ("8", "#b8b8b8"),
    "A-FIXTURE": ("4", "#555555"),
    "A-PARKING": ("9", "#666666"),
}


def rect_lines(x: float, y: float, w: float, h: float, layer: str = "A-WALL") -> list[Line]:
    return [
        Line(x, y, x + w, y, layer),
        Line(x + w, y, x + w, y + h, layer),
        Line(x + w, y + h, x, y + h, layer),
        Line(x, y + h, x, y, layer),
    ]


def add_room(
    entities: list[Entity],
    x: float,
    y: float,
    w: float,
    h: float,
    label: str,
    *,
    height: float = 62,
) -> None:
    entities.extend(rect_lines(x, y, w, h))
    entities.append(Text(x + w / 2, y + h / 2, label, height=height))


def add_door(
    entities: list[Entity],
    x: float,
    y: float,
    width: float,
    *,
    orientation: str,
) -> None:
    """Add a symbolic door leaf and swing arc."""
    if orientation == "north":
        entities.append(Line(x, y, x + width, y, "A-DOOR"))
        entities.append(Line(x, y, x, y + width, "A-DOOR"))
        entities.append(Arc(x, y, width, 0, 90))
    elif orientation == "south":
        entities.append(Line(x, y, x + width, y, "A-DOOR"))
        entities.append(Line(x, y, x, y - width, "A-DOOR"))
        entities.append(Arc(x, y, width, -90, 0))
    elif orientation == "east":
        entities.append(Line(x, y, x, y + width, "A-DOOR"))
        entities.append(Line(x, y, x + width, y, "A-DOOR"))
        entities.append(Arc(x, y, width, 0, 90))
    elif orientation == "west":
        entities.append(Line(x, y, x, y + width, "A-DOOR"))
        entities.append(Line(x, y, x - width, y, "A-DOOR"))
        entities.append(Arc(x, y, width, 90, 180))
    else:
        raise ValueError(f"Unknown door orientation: {orientation}")


def add_window(
    entities: list[Entity],
    x1: float,
    y1: float,
    x2: float,
    y2: float,
) -> None:
    entities.append(Line(x1, y1, x2, y2, "A-WINDOW"))
    if abs(y2 - y1) < abs(x2 - x1):
        entities.append(Line(x1, y1 + 18, x2, y2 + 18, "A-WINDOW"))
    else:
        entities.append(Line(x1 + 18, y1, x2 + 18, y2, "A-WINDOW"))


def add_dimension(
    entities: list[Entity],
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    label: str,
    *,
    offset: float = 0,
    text_offset: float = 34,
) -> None:
    dx = x2 - x1
    dy = y2 - y1
    horizontal = abs(dx) >= abs(dy)
    if horizontal:
        yy = y1 + offset
        entities.append(Line(x1, yy, x2, yy, "A-DIMS"))
        entities.append(Line(x1, yy - 35, x1, yy + 35, "A-DIMS"))
        entities.append(Line(x2, yy - 35, x2, yy + 35, "A-DIMS"))
        entities.append(Text((x1 + x2) / 2, yy + text_offset, label, height=44, layer="A-DIMS"))
    else:
        xx = x1 + offset
        entities.append(Line(xx, y1, xx, y2, "A-DIMS"))
        entities.append(Line(xx - 35, y1, xx + 35, y1, "A-DIMS"))
        entities.append(Line(xx - 35, y2, xx + 35, y2, "A-DIMS"))
        entities.append(Text(xx + text_offset, (y1 + y2) / 2, label, height=44, layer="A-DIMS", rotation=90))


def hatch_open_area(entities: list[Entity]) -> None:
    """Add light diagonal hatch lines representing the paved/open compound area."""
    spacing = 170
    for start_x in range(-4600, 5000, spacing):
        x1 = max(0, start_x)
        y1 = max(0, -start_x)
        x2 = min(4800, start_x + 4600)
        y2 = min(4600, 4600 - max(0, -start_x))
        if x2 > 0 and y2 > 0:
            entities.append(Line(x1, y1, x2, y2, "A-HATCH"))


def build_entities() -> list[Entity]:
    entities: list[Entity] = []
    hatch_open_area(entities)

    # Compound boundary and principal outdoor features.
    entities.extend(rect_lines(0, 0, 4800, 4600, "A-SITE"))
    entities.append(Text(2400, 4685, "COMPOUND / SITE PLAN FROM PROVIDED SKETCH", height=68))

    entities.extend(rect_lines(4200, 4100, 360, 260, "A-SITE"))
    entities.append(Text(4380, 4230, "SECURITY\nHOUSE", height=42))

    entities.append(Line(4700, 2960, 4700, 4070, "A-SITE"))
    entities.append(Line(4300, 3480, 4700, 4020, "A-DOOR", dashed=True))
    entities.append(Line(4300, 3480, 4700, 3020, "A-DOOR", dashed=True))
    entities.append(Text(4590, 3560, "GATE", height=70, rotation=90))

    entities.extend(rect_lines(1900, 2840, 950, 1220, "A-PARKING"))
    entities.append(Text(2375, 3450, "PARKING\nSTRUCTURE", height=78, rotation=90))

    # Ancillary upper-left building block.
    entities.extend(rect_lines(280, 3330, 1420, 930))
    add_room(entities, 350, 3890, 360, 280, "OUTSIDE\nTOILET", height=36)
    add_room(entities, 700, 3330, 210, 820, "WASHROOM", height=38)
    add_room(entities, 910, 3330, 300, 820, "BEDROOM", height=43)
    add_room(entities, 1210, 3330, 320, 820, "SITTING\nROOM", height=43)
    add_room(entities, 1530, 3330, 170, 820, "KITCHEN", height=38)
    for xx in (760, 970, 1280, 1570):
        add_door(entities, xx, 3330, 85, orientation="north")
    add_window(entities, 475, 4260, 600, 4260)
    add_window(entities, 1550, 4150, 1680, 4150)

    # Main building footprint and interior layout.
    main_x, main_y = 2100, 450
    entities.extend(rect_lines(main_x, main_y, 1400, 1550))

    add_room(entities, 2100, 450, 350, 560, "LAUNDRY", height=54)
    add_room(entities, 2450, 450, 360, 560, "KITCHEN", height=55)
    add_room(entities, 2310, 820, 175, 175, "KITCHEN\nSTORE", height=31)
    add_room(entities, 2810, 450, 180, 300, "WASHROOM", height=31)
    add_room(entities, 2990, 450, 180, 300, "WASHROOM", height=31)
    add_room(entities, 3170, 450, 330, 300, "RM 1", height=55)
    add_room(entities, 2810, 750, 690, 610, "RM 2", height=64)
    add_room(entities, 2450, 1010, 360, 350, "MAIN\nHALL", height=55)
    add_room(entities, 2100, 1360, 350, 170, "WASHROOM", height=32)
    add_room(entities, 2450, 1360, 1060, 170, "PASSAGE", height=43)
    add_room(entities, 2100, 1530, 700, 470, "RM 4", height=64)
    add_room(entities, 2800, 1530, 190, 220, "WASHROOM", height=31)
    add_room(entities, 2990, 1530, 510, 470, "RM 3", height=64)

    entities.append(Text(2630, 1235, "MAIN\nHALL", height=60))
    entities.append(Text(3485, 1240, "PASSAGE", height=42, rotation=90))

    # Main entrance porch/passage projection from the hand sketch.
    entities.extend(rect_lines(3500, 1120, 420, 360, "A-SITE"))
    entities.append(Text(3710, 1300, "MAIN\nENTRANCE", height=45))
    entities.append(Line(3500, 1120, 3500, 900, "A-SITE"))
    entities.append(Text(3550, 1000, "PASSAGE", height=39, rotation=90))

    # Doors.
    add_door(entities, 3500, 1230, 120, orientation="west")
    add_door(entities, 3170, 750, 115, orientation="north")
    add_door(entities, 2990, 750, 95, orientation="north")
    add_door(entities, 2810, 750, 95, orientation="north")
    add_door(entities, 2450, 1010, 110, orientation="north")
    add_door(entities, 2450, 450, 100, orientation="north")
    add_door(entities, 2100, 740, 100, orientation="east")
    add_door(entities, 2100, 1450, 90, orientation="east")
    add_door(entities, 2450, 1530, 120, orientation="north")
    add_door(entities, 2990, 1530, 120, orientation="north")
    add_door(entities, 3180, 1360, 110, orientation="north")

    # Windows on main block.
    add_window(entities, 2210, 2000, 2440, 2000)
    add_window(entities, 2550, 2000, 2750, 2000)
    add_window(entities, 3060, 2000, 3320, 2000)
    add_window(entities, 3500, 1660, 3500, 1880)
    add_window(entities, 3500, 810, 3500, 1000)
    add_window(entities, 3200, 450, 3420, 450)
    add_window(entities, 2500, 450, 2680, 450)
    add_window(entities, 2100, 520, 2100, 680)

    # Simple washroom fixtures.
    for x in (2860, 3040):
        entities.append(Rect(x, 500, 72, 95, "A-FIXTURE", fill="none", stroke_width=4))
        entities.append(Line(x + 36, 595, x + 36, 705, "A-FIXTURE"))
    entities.append(Rect(2215, 1410, 115, 70, "A-FIXTURE", fill="none", stroke_width=4))
    entities.append(Rect(2860, 1585, 70, 95, "A-FIXTURE", fill="none", stroke_width=4))
    entities.append(Rect(2285, 600, 100, 65, "A-FIXTURE", fill="none", stroke_width=4))

    # Visible handwritten dimensions.
    add_dimension(entities, 0, -100, 4800, -100, "4800", text_offset=-48)
    add_dimension(entities, -110, 0, -110, 4600, "4600", text_offset=-62)
    add_dimension(entities, 2100, 270, 2450, 270, "350", text_offset=-42)
    add_dimension(entities, 2450, 270, 2674, 270, "224", text_offset=-42)
    add_dimension(entities, 2674, 270, 3074, 270, "400", text_offset=-42)
    add_dimension(entities, 3074, 270, 3457, 270, "383", text_offset=-42)
    add_dimension(entities, 3660, 450, 3660, 710, "260", text_offset=42)
    add_dimension(entities, 3660, 710, 3660, 1104, "394", text_offset=42)
    add_dimension(entities, 3660, 1104, 3660, 1451, "347", text_offset=42)
    add_dimension(entities, 3660, 1451, 3660, 1871, "420", text_offset=42)
    add_dimension(entities, 610, 2050, 1042, 2050, "432", text_offset=42)
    add_dimension(entities, 1042, 2050, 1389, 2050, "347", text_offset=42)
    add_dimension(entities, 1389, 2050, 2009, 2050, "620", text_offset=42)

    return entities


def dxf_pair(code: int, value: str | int | float) -> str:
    return f"{code}\n{value}\n"


def dxf_text(entity: Text) -> str:
    return (
        dxf_pair(0, "TEXT")
        + dxf_pair(8, entity.layer)
        + dxf_pair(10, round(entity.x, 3))
        + dxf_pair(20, round(entity.y, 3))
        + dxf_pair(30, 0)
        + dxf_pair(40, entity.height)
        + dxf_pair(1, entity.value.replace("\n", " / "))
        + dxf_pair(50, entity.rotation)
        + dxf_pair(7, "STANDARD")
        + dxf_pair(72, 1 if entity.anchor == "middle" else 0)
        + dxf_pair(11, round(entity.x, 3))
        + dxf_pair(21, round(entity.y, 3))
        + dxf_pair(31, 0)
    )


def dxf_line(entity: Line) -> str:
    return (
        dxf_pair(0, "LINE")
        + dxf_pair(8, entity.layer)
        + dxf_pair(10, round(entity.x1, 3))
        + dxf_pair(20, round(entity.y1, 3))
        + dxf_pair(30, 0)
        + dxf_pair(11, round(entity.x2, 3))
        + dxf_pair(21, round(entity.y2, 3))
        + dxf_pair(31, 0)
        + (dxf_pair(6, "DASHED") if entity.dashed else "")
    )


def dxf_arc(entity: Arc) -> str:
    return (
        dxf_pair(0, "ARC")
        + dxf_pair(8, entity.layer)
        + dxf_pair(10, round(entity.cx, 3))
        + dxf_pair(20, round(entity.cy, 3))
        + dxf_pair(30, 0)
        + dxf_pair(40, round(entity.radius, 3))
        + dxf_pair(50, entity.start)
        + dxf_pair(51, entity.end)
    )


def dxf_poly(entity: Poly) -> str:
    data = dxf_pair(0, "POLYLINE") + dxf_pair(8, entity.layer) + dxf_pair(66, 1)
    data += dxf_pair(70, 1 if entity.closed else 0)
    for x, y in entity.points:
        data += dxf_pair(0, "VERTEX") + dxf_pair(8, entity.layer) + dxf_pair(10, x) + dxf_pair(20, y) + dxf_pair(30, 0)
    data += dxf_pair(0, "SEQEND")
    return data


def write_dxf(entities: Iterable[Entity]) -> None:
    layers = "".join(
        dxf_pair(0, "LAYER")
        + dxf_pair(2, name)
        + dxf_pair(70, 0)
        + dxf_pair(62, color)
        + dxf_pair(6, "CONTINUOUS")
        for name, (color, _hex_color) in LAYERS.items()
    )
    data = (
        dxf_pair(0, "SECTION")
        + dxf_pair(2, "HEADER")
        + dxf_pair(9, "$ACADVER")
        + dxf_pair(1, "AC1009")
        + dxf_pair(9, "$INSUNITS")
        + dxf_pair(70, 5)
        + dxf_pair(0, "ENDSEC")
        + dxf_pair(0, "SECTION")
        + dxf_pair(2, "TABLES")
        + dxf_pair(0, "TABLE")
        + dxf_pair(2, "LAYER")
        + dxf_pair(70, len(LAYERS))
        + layers
        + dxf_pair(0, "ENDTAB")
        + dxf_pair(0, "ENDSEC")
        + dxf_pair(0, "SECTION")
        + dxf_pair(2, "ENTITIES")
    )
    for entity in entities:
        if isinstance(entity, Line):
            data += dxf_line(entity)
        elif isinstance(entity, Rect):
            for line in rect_lines(entity.x, entity.y, entity.w, entity.h, entity.layer):
                data += dxf_line(line)
        elif isinstance(entity, Text):
            data += dxf_text(entity)
        elif isinstance(entity, Arc):
            data += dxf_arc(entity)
        elif isinstance(entity, Poly):
            data += dxf_poly(entity)
    data += dxf_pair(0, "ENDSEC") + dxf_pair(0, "EOF")
    DXF_PATH.write_text(data, encoding="ascii")


def svg_arc_path(arc: Arc) -> str:
    from math import cos, radians, sin

    sx = arc.cx + arc.radius * cos(radians(arc.start))
    sy = arc.cy + arc.radius * sin(radians(arc.start))
    ex = arc.cx + arc.radius * cos(radians(arc.end))
    ey = arc.cy + arc.radius * sin(radians(arc.end))
    large = 1 if abs(arc.end - arc.start) > 180 else 0
    sweep = 1
    return f"M {sx:.2f} {sy:.2f} A {arc.radius:.2f} {arc.radius:.2f} 0 {large} {sweep} {ex:.2f} {ey:.2f}"


def write_svg(entities: Iterable[Entity]) -> None:
    width, height = 5200, 5000
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-250 -250 {width} {height}">',
        "<title>Compound Site Plan from Provided Sketch</title>",
        "<desc>Revit-ready architectural plan preserving the visible rooms, site features, labels, doors, windows, and dimensions from the attached hand sketch.</desc>",
        '<rect x="-250" y="-250" width="5200" height="5000" fill="#f8f6ee"/>',
        '<g transform="translate(0 4600) scale(1 -1)">',
    ]
    for entity in entities:
        if isinstance(entity, Line):
            _color_code, color = LAYERS[entity.layer]
            dash = ' stroke-dasharray="55 35"' if entity.dashed else ""
            lines.append(
                f'<line x1="{entity.x1}" y1="{entity.y1}" x2="{entity.x2}" y2="{entity.y2}" '
                f'stroke="{color}" stroke-width="7" fill="none"{dash}/>'
            )
        elif isinstance(entity, Rect):
            _color_code, color = LAYERS[entity.layer]
            lines.append(
                f'<rect x="{entity.x}" y="{entity.y}" width="{entity.w}" height="{entity.h}" '
                f'stroke="{color}" stroke-width="{entity.stroke_width}" fill="{entity.fill}"/>'
            )
        elif isinstance(entity, Arc):
            _color_code, color = LAYERS[entity.layer]
            lines.append(f'<path d="{svg_arc_path(entity)}" stroke="{color}" stroke-width="6" fill="none"/>')
        elif isinstance(entity, Poly):
            _color_code, color = LAYERS[entity.layer]
            points = " ".join(f"{x},{y}" for x, y in entity.points)
            tag = "polygon" if entity.closed else "polyline"
            dash = ' stroke-dasharray="55 35"' if entity.dashed else ""
            lines.append(f'<{tag} points="{points}" stroke="{color}" stroke-width="7" fill="none"{dash}/>')
    lines.append("</g>")

    # Text is drawn in a second group so it remains upright after y-axis inversion.
    lines.append('<g font-family="Arial, Helvetica, sans-serif" font-weight="600" text-anchor="middle">')
    for entity in entities:
        if not isinstance(entity, Text):
            continue
        _color_code, color = LAYERS[entity.layer]
        x = entity.x
        y = 4600 - entity.y
        rotate = f' transform="rotate({-entity.rotation} {x} {y})"' if entity.rotation else ""
        anchor = entity.anchor
        lines.append(
            f'<text x="{x}" y="{y}" font-size="{entity.height}" fill="{color}" '
            f'text-anchor="{anchor}"{rotate}>'
        )
        for idx, part in enumerate(entity.value.split("\n")):
            dy = 0 if idx == 0 else entity.height * 1.05
            lines.append(f'<tspan x="{x}" dy="{dy}">{escape(part)}</tspan>')
        lines.append("</text>")
    lines.append("</g>")
    lines.append("</svg>")
    SVG_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    entities = build_entities()
    write_dxf(entities)
    write_svg(entities)
    print(f"Wrote {DXF_PATH.relative_to(ROOT.parent)}")
    print(f"Wrote {SVG_PATH.relative_to(ROOT.parent)}")


if __name__ == "__main__":
    main()
