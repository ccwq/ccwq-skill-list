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

## References

- [ffmpeg-recipes.md](references/ffmpeg-recipes.md)：码率计算公式与命令模板。
