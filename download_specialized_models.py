import shutil
import urllib.request
import hashlib
from pathlib import Path


DRONE_URL = "https://huggingface.co/marie-kjelberg/drone-detector/resolve/main/yolo11n_drone.pt?download=true"
JAVAY_FIRE_EXTINGUISHER_URL = "https://github.com/Javayhu/Real-Time_Fire_Extinguisher_Detection_System/raw/main/best3.pt"
JAVAY_FIRE_EXTINGUISHER_SHA256 = "9f03f76db1b14a974d5b7f5db36a6a20f5ab77536ea90e5f3eb3927aef6fe50f"


def download(url, destination):
    request = urllib.request.Request(url, headers={"User-Agent": "PixelHome/1.0"})
    with urllib.request.urlopen(request) as response, destination.open("wb") as output:
        shutil.copyfileobj(response, output)


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    root = Path(__file__).resolve().parent
    model_dir = root / "models" / "baseline"
    model_dir.mkdir(parents=True, exist_ok=True)
    drone_path = model_dir / "drone_yolo11n.pt"
    extinguisher_path = model_dir / "fire_extinguisher_yolov8.pt"
    if not drone_path.exists():
        print("Downloading drone detector...")
        download(DRONE_URL, drone_path)
    if not extinguisher_path.exists():
        print("Downloading Javay fire-extinguisher detector...")
        download(JAVAY_FIRE_EXTINGUISHER_URL, extinguisher_path)
        digest = file_sha256(extinguisher_path)
        if digest != JAVAY_FIRE_EXTINGUISHER_SHA256:
            extinguisher_path.unlink(missing_ok=True)
            raise RuntimeError(f"Fire extinguisher checksum mismatch: {digest}")
    print(f"Ready: {drone_path.relative_to(root)}, {extinguisher_path.relative_to(root)}")


if __name__ == "__main__":
    main()
