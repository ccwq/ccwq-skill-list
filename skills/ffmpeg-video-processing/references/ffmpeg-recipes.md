# FFmpeg Recipes

## Inspection

```bash
ffprobe -v error -show_entries format=duration,size,bit_rate -show_entries stream=index,codec_type,codec_name,width,height,avg_frame_rate,bit_rate -of json input.mp4
```

## Target Size Formula

Use this when the user asks for a file near a specific size.

```text
target_total_bps = target_size_bytes * 8 / duration_seconds
video_bps = target_total_bps - audio_bps - container_margin_bps
```

Practical defaults:
- Audio: `64k` to `128k`
- Container margin: `32k` to `96k`
- Codec: `libx264` for broad compatibility

## Two-Pass MP4

```bash
ffmpeg -y -i input.mp4 -c:v libx264 -preset slow -b:v 5500k -pass 1 -passlogfile ffmpeg-pass -an -f mp4 NUL
ffmpeg -y -i input.mp4 -c:v libx264 -preset slow -b:v 5500k -pass 2 -passlogfile ffmpeg-pass -c:a aac -b:a 96k -movflags +faststart output.mp4
```

## Common Edits

Trim:

```bash
ffmpeg -y -ss 00:00:03 -to 00:00:08 -i input.mp4 -c copy output.mp4
```

Resize:

```bash
ffmpeg -y -i input.mp4 -vf "scale=1280:-2" -c:v libx264 -crf 22 -preset medium -c:a aac -b:a 128k output.mp4
```

Mute audio:

```bash
ffmpeg -y -i input.mp4 -c:v copy -an output.mp4
```

Extract audio:

```bash
ffmpeg -y -i input.mp4 -vn -c:a aac output.m4a
```

Burn subtitles:

```bash
ffmpeg -y -i input.mp4 -vf "subtitles=subtitles.srt" -c:v libx264 -crf 20 -preset medium -c:a aac -b:a 128k output.mp4
```

## Missing Binary Rule

If `ffmpeg` or `ffprobe` cannot be found, stop and ask the user to provide the binary path or confirm download of an official build.
