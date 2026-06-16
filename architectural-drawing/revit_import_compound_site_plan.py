"""Import the generated compound site plan DXF into a Revit drafting view.

Usage:
1. Generate/keep `compound_site_plan.dxf` from this folder.
2. Copy this script and the DXF to a Windows machine with Autodesk Revit.
3. Update DXF_PATH below to the absolute path of the DXF.
4. Run the script from pyRevit or RevitPythonShell.

The DXF uses centimeters, preserving the handwritten dimensions from the
attached sketch: the outer compound is 4800 cm by 4600 cm, and the building
dimension strings remain visible as annotation.
"""

import os

import clr
from Autodesk.Revit.DB import (  # type: ignore
    DWGImportOptions,
    ElementId,
    FilteredElementCollector,
    ImportColorMode,
    ImportPlacement,
    ImportUnit,
    Transaction,
    ViewDrafting,
    ViewFamily,
    ViewFamilyType,
)


DXF_PATH = r"C:\Path\To\compound_site_plan.dxf"
VIEW_NAME = "Compound Site Plan - Imported Sketch Layout"


def get_document():
    try:
        from pyrevit import revit  # type: ignore

        return revit.doc
    except Exception:
        return __revit__.ActiveUIDocument.Document  # noqa: F821


def get_drafting_view_type(doc):
    for view_type in FilteredElementCollector(doc).OfClass(ViewFamilyType):
        if view_type.ViewFamily == ViewFamily.Drafting:
            return view_type
    raise RuntimeError("No drafting view type was found in this Revit project.")


def unique_view_name(doc, base_name):
    names = {
        view.Name
        for view in FilteredElementCollector(doc).OfClass(ViewDrafting)
    }
    if base_name not in names:
        return base_name
    index = 2
    while "{} ({})".format(base_name, index) in names:
        index += 1
    return "{} ({})".format(base_name, index)


def main():
    if not os.path.exists(DXF_PATH):
        raise RuntimeError("DXF file does not exist: {}".format(DXF_PATH))

    doc = get_document()
    transaction = Transaction(doc, "Import compound site plan DXF")
    transaction.Start()
    try:
        view_type = get_drafting_view_type(doc)
        view = ViewDrafting.Create(doc, view_type.Id)
        view.Name = unique_view_name(doc, VIEW_NAME)
        view.Scale = 100

        options = DWGImportOptions()
        options.ColorMode = ImportColorMode.Preserved
        options.Placement = ImportPlacement.Origin
        options.Unit = ImportUnit.Centimeter
        options.ThisViewOnly = True
        options.VisibleLayersOnly = False

        imported_element_id = clr.Reference[ElementId]()
        if not doc.Import(DXF_PATH, options, view, imported_element_id):
            raise RuntimeError("Revit reported that the DXF import failed.")

        transaction.Commit()
        print("Imported {} into drafting view: {}".format(DXF_PATH, view.Name))
    except Exception:
        transaction.RollBack()
        raise


if __name__ == "__main__":
    main()
