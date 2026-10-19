"""Compatibility entry point for the illustrated radar guide."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name("build-radar-guide.py")),run_name="__main__")
