# Compound Site Architectural Drawing

This folder contains a Revit-ready architectural drawing recreated from the attached hand sketch.

## Deliverables

- `compound_site_plan.dxf` - CAD file for import into Autodesk Revit. Units are centimeters.
- `compound_site_plan.svg` - preview/vector copy of the plan for quick review.
- `generate_site_plan.py` - reproducible source used to generate the DXF and SVG.
- `revit_import_compound_site_plan.py` - optional pyRevit/RevitPythonShell helper that imports the DXF into a Revit drafting view.

## Features included from the sketch

- 4800 cm by 4600 cm compound boundary.
- Security house and right-side gate with swing lines.
- Parking structure in the upper central yard.
- Upper-left ancillary rooms: outside toilet, washroom, bedroom, sitting room, and kitchen.
- Main building with RM 1, RM 2, RM 3, RM 4, main hall, passage, main entrance, kitchen, laundry, kitchen store, and washrooms.
- Doors, door swings, windows, washroom fixtures, exterior hatch/open paved area, labels, and the visible dimension strings.

## Revit workflow

1. Open Autodesk Revit and create/open the target project.
2. Use **Insert > Import CAD** and select `compound_site_plan.dxf`.
3. Set import units to **Centimeter**.
4. Place the import at origin/current view. The drawing is organized by CAD layers such as `A-WALL`, `A-DOOR`, `A-WINDOW`, `A-DIMS`, and `A-ANNO-TEXT`.
5. If desired, run `revit_import_compound_site_plan.py` from pyRevit/RevitPythonShell after updating `DXF_PATH` to the DXF location.

## Notes

The source photo is a hand sketch, so this drawing preserves the visible layout and labels while regularizing geometry into clean CAD lines. Before construction or permitting, verify dimensions and code requirements with a licensed architect or surveyor.
