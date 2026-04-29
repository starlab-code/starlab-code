const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const desktopDir = path.resolve(__dirname, "..");
const pngPath = path.join(desktopDir, "assets", "logo.png");
const icoPath = path.join(desktopDir, "assets", "logo.ico");

function readPngSize(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new Error(`${pngPath} is not a PNG file.`);
  }
  if (buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error(`${pngPath} does not have a valid PNG IHDR chunk.`);
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function pngToIco(pngBuffer, width, height) {
  const headerSize = 6;
  const directorySize = 16;
  const imageOffset = headerSize + directorySize;
  const icoBuffer = Buffer.alloc(imageOffset + pngBuffer.length);

  icoBuffer.writeUInt16LE(0, 0);
  icoBuffer.writeUInt16LE(1, 2);
  icoBuffer.writeUInt16LE(1, 4);
  icoBuffer.writeUInt8(width >= 256 ? 0 : width, 6);
  icoBuffer.writeUInt8(height >= 256 ? 0 : height, 7);
  icoBuffer.writeUInt8(0, 8);
  icoBuffer.writeUInt8(0, 9);
  icoBuffer.writeUInt16LE(1, 10);
  icoBuffer.writeUInt16LE(32, 12);
  icoBuffer.writeUInt32LE(pngBuffer.length, 14);
  icoBuffer.writeUInt32LE(imageOffset, 18);
  pngBuffer.copy(icoBuffer, imageOffset);

  return icoBuffer;
}

function escapePowerShellString(value) {
  return String(value).replace(/'/g, "''");
}

function createSquareIconPng(sourcePath, outputPath) {
  const script = `
Add-Type -AssemblyName System.Drawing
$sourcePath = '${escapePowerShellString(sourcePath)}'
$outputPath = '${escapePowerShellString(outputPath)}'
$source = [System.Drawing.Image]::FromFile($sourcePath)
try {
  $canvasSize = 256
  $bitmap = New-Object System.Drawing.Bitmap $canvasSize, $canvasSize, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $scale = [Math]::Min($canvasSize / $source.Width, $canvasSize / $source.Height)
      $drawWidth = [Math]::Round($source.Width * $scale)
      $drawHeight = [Math]::Round($source.Height * $scale)
      $x = [Math]::Floor(($canvasSize - $drawWidth) / 2)
      $y = [Math]::Floor(($canvasSize - $drawHeight) / 2)
      $graphics.DrawImage($source, $x, $y, $drawWidth, $drawHeight)
    } finally {
      $graphics.Dispose()
    }
    $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $bitmap.Dispose()
  }
} finally {
  $source.Dispose()
}
`;

  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(`Failed to prepare 256x256 PNG icon.\n${result.stderr || result.stdout}`);
  }
}

if (!fs.existsSync(pngPath)) {
  throw new Error(`Missing ${pngPath}. Add your PNG logo before building the desktop app.`);
}

const pngBuffer = fs.readFileSync(pngPath);
const { width, height } = readPngSize(pngBuffer);
const normalizedPngPath = path.join(os.tmpdir(), "starlab-code-logo-256.png");

if (width !== height) {
  console.warn(`Warning: ${path.relative(desktopDir, pngPath)} is ${width}x${height}. Creating a transparent 256x256 icon canvas.`);
}
if (width < 256 || height < 256) {
  console.warn(`Warning: ${path.relative(desktopDir, pngPath)} is smaller than 256x256 on one side. The app icon may look softer after scaling.`);
}

createSquareIconPng(pngPath, normalizedPngPath);
const normalizedPngBuffer = fs.readFileSync(normalizedPngPath);
fs.writeFileSync(icoPath, pngToIco(normalizedPngBuffer, 256, 256));
console.log(`Prepared desktop icon: ${path.relative(desktopDir, icoPath)}`);
