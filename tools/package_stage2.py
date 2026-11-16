import argparse
import subprocess
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from fetch_face_models import MODELS


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--with-face-models", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    selected = subprocess.check_output(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=root
    ).decode("utf-8").split("\0")
    paths = set()
    for name in selected:
        path = Path(name)
        if not name or path.parts[0] in {".venv", "data", "dist", "artifacts", "model_lab", "runs"}:
            continue
        if path.is_absolute() or ".." in path.parts or not (root / path).is_file():
            raise ValueError(f"Invalid or missing source file: {name}")
        paths.add(path)
    if args.with_face_models:
        paths.update(Path("models", "face", name) for name in MODELS)
    output = root / "artifacts" / "PixelHome-stage2-source.zip"
    output.parent.mkdir(exist_ok=True)
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for path in sorted(paths):
            archive.write(root / path, path.as_posix())
    with ZipFile(output) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("Source ZIP failed CRC verification")
    print(f"{output} ({len(paths)} files)")


if __name__ == "__main__":
    main()
