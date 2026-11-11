# Demo assets

- **NARRATION_SCRIPT.md** — timed voice-over for the 3-minute demo
- **slides/** — 1920x1080 title cards used in the slideshow
- **out/gcp-native-dev-demo-3min.mp4** — assembled 3:00 demo video (local build; large file, generate with scripts below)

## Rebuild the video

```bash
cd docs/demo
# requires ImageMagick + ffmpeg
# slides already under slides/
# segments under out/segments/
ffmpeg -f concat -safe 0 -i out/concat.txt -c copy out/gcp-native-dev-demo-3min.mp4
```

The full MP4 is ~37MB and is kept local unless uploaded via Git LFS.
