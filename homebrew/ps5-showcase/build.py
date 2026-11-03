import os
import shutil
import struct
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
ATLAS = Image.new("L", (1024, 2048))
DRAW = ImageDraw.Draw(ATLAS)
FONT_CANDIDATES = (
    Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
)
FONT_PATH = next((path for path in FONT_CANDIDATES if path.is_file()), None)
if FONT_PATH is None:
    raise SystemExit("A supported bold TrueType font is required")

rows = []
y = 2
for key, label, size in (
    ("FIRST", "hellow from ps5!", 100),
    ("SECOND", "~ cpypwn", 68),
):
    font = ImageFont.truetype(str(FONT_PATH), size)
    left, top, right, bottom = DRAW.textbbox((0, 0), label, font=font)
    width, height = right - left, bottom - top
    if width + 4 > 1024:
        raise SystemExit(f"{key} exceeds the text atlas width")
    DRAW.text((2 - left, y - top), label, font=font, fill=255)
    rows.append(f"const ivec4 TEXT_{key} = ivec4(2, {y}, {width}, {height});")
    y += height + 12

(ROOT / "assets/text.bin").write_bytes(ATLAS.tobytes())
(ROOT / "shaders/text.glsl").write_text("\n".join(rows) + "\n")
state = bytearray(1024)
struct.pack_into("<f", state, 960, 1.0)
(ROOT / "assets/state.bin").write_bytes(state)

icon = Image.new("RGBA", (256, 256), (5, 16, 21, 255))
draw = ImageDraw.Draw(icon)
draw.ellipse((25, 25, 231, 231), outline=(114, 240, 187, 255), width=8)
draw.ellipse((49, 49, 207, 207), outline=(74, 150, 222, 255), width=4)
font = ImageFont.truetype(str(FONT_PATH), 42)
label = "ps5"
left, top, right, bottom = draw.textbbox((0, 0), label, font=font)
draw.text(((256 - right + left) / 2 - left, (256 - bottom + top) / 2 - top), label, font=font, fill=(230, 255, 245, 255))
icon.save(ROOT / "assets/icon.png")

glslang = os.environ.get("GLSLANG") or shutil.which("glslangValidator")
spirv_val = os.environ.get("SPIRV_VAL") or shutil.which("spirv-val")
if not glslang or not spirv_val:
    raise SystemExit("Set GLSLANG and SPIRV_VAL to the shader tools")
for stage in ("vert", "frag", "comp"):
    source = ROOT / f"shaders/app.{stage}"
    output = ROOT / f"app.{stage}.spv"
    subprocess.run((glslang, "-V", "-Os", "-g0", "--target-env", "vulkan1.0", str(source), "-o", str(output)), check=True)
    subprocess.run((spirv_val, "--target-env", "vulkan1.0", str(output)), check=True)
