"""Prove unused video decoding is unavailable; do not infer it from a missing label."""
import re
from pathlib import Path


def verify(build_information, ffmpeg_available, library_paths):
    if not isinstance(build_information, str) or "Video I/O:" not in build_information:
        raise ValueError("OpenCV capability evidence is missing")
    # Upstream CMake omits FFMPEG entirely when both WITH_FFMPEG and
    # HAVE_FFMPEG are false. Require a real runtime backend probe as well.
    flags = re.findall(r"^\s*FFMPEG:\s*(\S+)", build_information, re.MULTILINE)
    if any(flag != "NO" for flag in flags) or ffmpeg_available is not False:
        raise ValueError("Unused FFmpeg backend is present or not proven unavailable")
    if any(re.search(r"(?:lib)?(?:avcodec|avformat|avutil|avdevice|swscale|swresample)(?:[-.]|$)", Path(path).name, re.I)
           for path in library_paths):
        raise ValueError("Unused FFmpeg libraries remain in runtime")


if __name__ == "__main__":
    import cv2
    build = cv2.getBuildInformation()
    # Real OpenCV registry probe, not caller-provided metadata or a mock.
    available = cv2.videoio_registry.hasBackend(cv2.CAP_FFMPEG)
    libraries = [str(path) for path in Path("/opt/venv").rglob("*") if path.is_file()]
    verify(build, available, libraries)
    print("REAL_FFMPEG_BACKEND_AND_LIBRARY_ABSENCE_PASSED", "explicit-NO" if "FFMPEG:" in build else "upstream-disabled-label-omitted")
