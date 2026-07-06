import os
import sys
from pathlib import Path


def resource_root():
    bundled = getattr(sys, "_MEIPASS", None)
    return Path(bundled) if bundled else Path(__file__).resolve().parent.parent


def data_root():
    if getattr(sys, "frozen", False):
        path = Path(os.getenv("LOCALAPPDATA", Path.home())) / "PixelHome"
    else:
        path = resource_root() / "data"
    path.mkdir(parents=True, exist_ok=True)
    return path
