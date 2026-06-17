---
name: ffmpeg-video-processing
description: Use when working with video or audio files via ffmpeg or ffprobe, including compression, transcoding, trimming, resizing, frame-rate changes, audio extraction, muxing, concat, subtitle burn-in, watermarking, and media inspection. Also use when the user needs a target-size MP4, WebM, or GIF, or when ffmpeg is missing and you must ask the user to provide a binary path or confirm downloading an official build.
version: 1.0.0

---

# Ffmpeg Video Processing

## Overview

Use ffprobe to inspect media first, then choose the simplest encoding path that meets the size or quality goal. Prefer deterministic recipes over ad hoc parameter guessing.

## Workflow

1. Inspect input with `ffprobe` before changing anything.
2. Decide whether the task is size-first or quality-first.
3. If ffmpeg is not found, stop and ask the user to provide the executable path or confirm download of an official build.
4. Prefer a two-pass encode for fixed-size MP4 output. Prefer CRF for quality-first output.
5. Keep audio and container overhead in mind when converting a target file size into a bitrate.

## Decision Guide

- Use `ffprobe` for duration, resolution, frame rate, stream codecs, and bitrates.
- Use two-pass H.264/AAC MP4 when the user gives a target file size.
- Use CRF when the user asks for "smaller but still good" and does not require a strict size.
- Use copy mode only when rewrapping is sufficient and no transcoding is needed.
- Use `scale`, `fps`, `trim`, `concat`, `subtitles`, `drawtext`, or `overlay` filters when the request is about editing rather than pure compression.

## Fixed-Size Compression

1. Measure duration from `ffprobe`.
2. Convert target size to average total bitrate.
3. Reserve audio bitrate first, then subtract a small container margin.
4. Encode video with two passes.
5. Re-check the final size and adjust bitrate upward or downward if needed.

See [ffmpeg-recipes.md](references/ffmpeg-recipes.md) for formulas and command templates.

## Missing FFmpeg Handling

- If `ffmpeg` or `ffprobe` is not available, ask the user to provide the executable path.
- If the user wants a download, ask for confirmation before downloading an official build.
- Do not guess a path or silently switch to a different encoder.
- If the user already provided a path, use that exact binary path for all commands.

## Resources (optional)

Create only the resource directories this skill actually needs. Delete this section if no resources are required.

### scripts/
Executable code (Python/Bash/etc.) that can be run directly to perform specific operations.

**Examples from other skills:**
- PDF skill: `fill_fillable_fields.py`, `extract_form_field_info.py` - utilities for PDF manipulation
- DOCX skill: `document.py`, `utilities.py` - Python modules for document processing

**Appropriate for:** Python scripts, shell scripts, or any executable code that performs automation, data processing, or specific operations.

**Note:** Scripts may be executed without loading into context, but can still be read by Codex for patching or environment adjustments.

### references/
Documentation and reference material intended to be loaded into context to inform Codex's process and thinking.

**Examples from other skills:**
- Product management: `communication.md`, `context_building.md` - detailed workflow guides
- BigQuery: API reference documentation and query examples
- Finance: Schema documentation, company policies

**Appropriate for:** In-depth documentation, API references, database schemas, comprehensive guides, or any detailed information that Codex should reference while working.

### assets/
Files not intended to be loaded into context, but rather used within the output Codex produces.

**Examples from other skills:**
- Brand styling: PowerPoint template files (.pptx), logo files
- Frontend builder: HTML/React boilerplate project directories
- Typography: Font files (.ttf, .woff2)

**Appropriate for:** Templates, boilerplate code, document templates, images, icons, fonts, or any files meant to be copied or used in the final output.

---

**Not every skill requires all three types of resources.**
