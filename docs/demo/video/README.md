# Demo video

## Status (important)

`gcp-native-dev-demo-3min.mp4` on GitHub is currently a **Git LFS pointer** (about 133 bytes of text), **not** the playable video.

If you download it from the web UI or `raw.githubusercontent.com` without Git LFS, you get:

```
version https://git-lfs.github.com/spec/v1
oid sha256:c7300ee214777b20351e36b987bbf05671dff054757bf56e55cc8c75cae56065
size 37805570
```

That file will not play (size mismatch / invalid MP4).

| What you want | Size | How to get it |
|---------------|------|----------------|
| Full 1080p demo | ~37 MB | `git lfs pull` after an LFS upload of the real file |
| Local sandbox copy | ~37 MB | `docs/demo/video/gcp-native-dev-demo-3min.mp4` in the build environment |

## Verify you have the real file

```bash
# Should print ~37805570 and show video codec info
wc -c docs/demo/video/gcp-native-dev-demo-3min.mp4
ffprobe docs/demo/video/gcp-native-dev-demo-3min.mp4

# If you see "version https://git-lfs..." the LFS object was never uploaded
head -1 docs/demo/video/gcp-native-dev-demo-3min.mp4
```

## Upload the real binary (maintainer)

```bash
git clone https://github.com/futureimadmin/gcp-native-dev.git
cd gcp-native-dev
git lfs install

# Copy the real 37MB file over the pointer path, then:
git add docs/demo/video/gcp-native-dev-demo-3min.mp4
git commit -m "Upload full demo MP4 via Git LFS"
git push
git lfs push origin main
```

OID: `sha256:c7300ee214777b20351e36b987bbf05671dff054757bf56e55cc8c75cae56065`  
Expected size: `37805570` bytes
