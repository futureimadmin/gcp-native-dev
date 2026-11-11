# Demo video

## Files

| File | Description |
|------|-------------|
| `gcp-native-dev-demo-3min.mp4` | Full 1080p 3:00 demo (Git LFS, ~37 MB) |
| `gcp-native-dev-demo-3min-hd.mp4` | Compressed 720p version (~0.5 MB, regular git) |

## Fetch with Git LFS

```bash
git lfs install
git clone https://github.com/futureimadmin/gcp-native-dev.git
cd gcp-native-dev
git lfs pull
```

## Upload the binary (maintainers)

If the pointer is present but the object is missing:

```bash
git lfs install
git lfs track "*.mp4"
# place the real file at docs/demo/video/gcp-native-dev-demo-3min.mp4
git add docs/demo/video/gcp-native-dev-demo-3min.mp4 .gitattributes
git commit -m "Add demo video via LFS"
git push
git lfs push origin main
```

OID (sha256): `c7300ee214777b20351e36b987bbf05671dff054757bf56e55cc8c75cae56065`  
Size: 37805570 bytes
