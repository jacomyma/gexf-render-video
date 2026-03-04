# gexf-render-video

A CLI toolkit for generating videos from dynamic GEXF network files. This tool slices temporal network data, computes layouts for each time window, and renders the result as a video.

## Overview

This toolkit consists of three sequential CLI commands that work together:

1. **slice-gexf** - Slices a dynamic GEXF file into temporal windows
2. **layout-slices** - Computes network layouts for each slice
3. **render-video** - Renders the slices as a video file

## Installation

```bash
npm install
```

## Quick Start

```bash
# 1. Slice your GEXF file
node slice-gexf.js -i data/test.gexf

# 2. Compute layouts for the slices
node layout-slices.js

# 3. Render the video
node render-video.js
```

This will create a `video.mp4` file with your network visualization.

## CLI Commands

### 1. slice-gexf

Slices a dynamic GEXF file over time into multiple temporal windows.

**Usage:**
```bash
node slice-gexf.js -i <input.gexf> [options]
```

**Required Options:**
- `-i, --input <file>` - GEXF file input (required)

**Optional Parameters:**
- `-r, --range <number>` - Temporal range (window) for each slice. In seconds for date/dateTime formats, or unitless for integer/double formats. Defaults to 1 week (604800 seconds) for date formats or 1 for numeric formats.
- `-s, --step <number>` - Time step between slices. In seconds for date/dateTime formats, or unitless for integer/double formats. Defaults to 1 day (86400 seconds) for date formats or 0.1 for numeric formats.

**Output:**
- `slices.json` - JSON file containing all temporal slices

**Example:**
```bash
# Use default settings (1 week windows, 1 day steps)
node slice-gexf.js -i data/test.gexf

# Custom temporal range and step
node slice-gexf.js -i data/test.gexf -r 86400 -s 3600
```

**Notes:**
- Requires a dynamic GEXF file (mode="dynamic")
- Supports timeformat: "date", "dateTime", "integer", or "double"
- Supports timerepresentation: "interval" or "timestamp"
- Logs are saved to `log/slice-gexf.log`

---

### 2. layout-slices

Computes network layouts for each slice using Force Atlas 2 and noverlap algorithms.

**Usage:**
```bash
node layout-slices.js [options]
```

**Optional Parameters:**
- `-i, --input <file>` - Slices JSON file (default: `slices.json`)
- `-s, --sample <slice>` - Sample a single slice for testing layout parameters. Outputs `sampled-slice.gexf` for inspection in Gephi or other GEXF viewers.

**Layout Parameters:**
- `--nodesizemin <number>` - Minimal node size (default: 10)
- `--nodesizefactor <number>` - Node size scaling factor based on (in-)degree (default: 2)
- `--nodesizepower <number>` - Node size exponent; values > 1 create exponential growth (default: 1)

**Force Atlas 2 Parameters:**
- `--strongergravity <boolean>` - Use stronger gravity mode (default: true)
- `--gravity <number>` - Gravity strength (default: 1)
- `--iterationsfactor <number>` - Multiplier for layout iterations (default: 10)
- `--barneshut <boolean>` - Use Barnes-Hut approximation for better performance (default: true)
- `--scaling <number>` - Scaling factor for the layout (default: 1)
- `--linlog <boolean>` - Use lin-log mode for scales (default: true)
- `--preventoverlap <boolean>` - Prevent node overlap during layout (default: true)

**Output:**
- `slices-layout.json` - JSON file with layout coordinates for all slices
- `sampled-slice.gexf` - (when using `-s`) GEXF file of sampled slice for testing

**Examples:**
```bash
# Use default settings
node layout-slices.js

# Test layout on a single slice first
node layout-slices.js -s 50

# Customize node sizes and layout
node layout-slices.js --nodesizemin 5 --nodesizefactor 3 --gravity 2
```

**Notes:**
- Implements temporal layout stabilization by inheriting positions from previous slices
- Logs progress every 100 slices
- Logs are saved to `log/layout-slices.log`

---

### 3. render-video

Renders the slices with layouts as a video file.

**Usage:**
```bash
node render-video.js [options]
```

**Optional Parameters:**
- `-i, --input <file>` - Slices with layout JSON file (default: `slices-layout.json`)
- `-o, --output <file>` - Output video filename (default: `video.mp4`)
- `-s, --sample <slice>` - Render a single slice as `sample-frame.png` for testing
- `-l, --limit <number>` - Render only the first N frames for preview
- `-r, --reuse` - Reuse previously rendered frames from the `/frames/` folder
- `--fpi <number>` - Frames per image; controls video speed. At 30 FPS output, FPI=1 shows 30 images/sec, FPI=3 shows 10 images/sec, FPI=10 shows 3 images/sec (default: 3)

**Output:**
- `video.mp4` (or specified filename) - H.264 encoded video at 3840×2160 (4K) resolution
- `frames/*.jpg` - Individual frame files saved in the frames directory
- `sample-frame.png` - (when using `-s`) PNG of sampled frame for testing

**Examples:**
```bash
# Render complete video with defaults
node render-video.js

# Test a single frame first
node render-video.js -s 100

# Create a preview of first 50 frames
node render-video.js -l 50

# Render with custom output name and speed
node render-video.js -o network-animation.mp4 --fpi 5

# Reuse previously rendered frames
node render-video.js -r
```

**Video Settings:**
- Resolution: 3840×2160 (4K UHD)
- Frame rate: 30 FPS
- Codec: H.264
- Quantization: 12 (higher quality, lower compression)

**Notes:**
- Frames are cached as JPG files in the `/frames/` directory
- Use `-r` flag to skip re-rendering frames that already exist
- Logs progress every 10 slices
- Logs are saved to `log/render-video.log`

---

## Workflow Tips

### Testing and Tuning

When working with new data, use the sampling options to test settings efficiently:

```bash
# 1. Test a single slice's layout
node layout-slices.js -s 50

# 2. Open sampled-slice.gexf in Gephi to verify layout
# 3. Adjust layout parameters and repeat until satisfied

# 4. Test a single frame render
node render-video.js -s 50

# 5. Verify sample-frame.png looks good
# 6. Create a short preview
node render-video.js -l 100

# 7. Once satisfied, render the full video
node layout-slices.js
node render-video.js
```

### Resuming Interrupted Renders

If video rendering is interrupted:

```bash
# Reuse already rendered frames
node render-video.js -r
```

### Performance Optimization

For large networks:
- Use `--barneshut true` in layout-slices (default)
- Consider increasing `--step` in slice-gexf to reduce the number of slices
- Use `-l` option during testing to avoid rendering all frames

## Logs

All commands generate detailed logs in the `log/` directory:
- `log/slice-gexf.log`
- `log/layout-slices.log`
- `log/render-video.log`

Check these files for detailed progress information and troubleshooting.

## Requirements

- Node.js with ES modules support
- Dependencies are defined in `package.json` and include:
  - graphology (network library)
  - d3 (data visualization)
  - canvas (image rendering)
  - h264-mp4-encoder (video encoding)
  - commander (CLI framework)
  - winston (logging)

## License

See [LICENSE](LICENSE) file for details.