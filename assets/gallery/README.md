# assets/gallery -- artwork image destination

Web-ready artwork images live here, and nowhere else. One file per work. Every file in this folder is referenced by an entry in `content/artworks.json`, and the build renders the `<img>` tag from that entry.

> 画廊作品的网页版图片只放在这里，不放别处。每件作品一个文件。本目录中的每个文件都对应 `content/artworks.json` 中的一条记录，构建过程依据该记录渲染 `<img>` 标签。

## File contract

- Filename: `<medium-slug>-<nnn>.jpg`, for example `painting-001.jpg`. Lowercase ASCII, no spaces. The prefix is the `medium` slug from `content/gallery.json`, so the filename says which page the work renders on.
- Format: JPEG. Use PNG only for a work that genuinely needs it (flat line art, transparency).
- Size: long edge at most 1200 px, quality 78, under roughly 400 KB per file. The grid renders cards between 240 px and 400 px wide, so 1200 px still covers a 2x display on the widest card.
- Orientation must be baked into the pixels, and the EXIF orientation tag must read 1. A phone photo stores a landscape buffer plus a rotate tag; if that tag survives, the browser rotates an image that is already upright.
- Original files are **not** committed. Git keeps every version of a binary forever, and `index.html` already pulls 67.6 MB of images. Originals stay in the owner's own storage.

> ## 文件约定
>
> - 文件名：`<媒介-slug>-<序号>.jpg`，例如 `painting-001.jpg`。小写 ASCII，不含空格。前缀取自 `content/gallery.json` 中的 `medium` slug，因此文件名本身即说明该作品渲染在哪个页面。
> - 格式：JPEG。仅在确有必要时使用 PNG（纯线稿、需要透明通道）。
> - 尺寸：长边不超过 1200 px，质量 78，单文件约 400 KB 以内。网格中卡片宽度在 240 px 到 400 px 之间，1200 px 足以覆盖最宽卡片的 2 倍屏。
> - 旋转必须烘焙进像素，且 EXIF orientation 标签必须为 1。手机照片会存储横向缓冲区外加一个旋转标签；若该标签残留，浏览器会把本已正立的图片再次旋转。
> - 原始文件**不**提交入库。Git 会永久保留二进制文件的每一个版本，而 `index.html` 已经引用了 67.6 MB 的图片。原图保留在所有者自己的存储中。

## Intake procedure

Run from the repo root, once per source image. `sips` ships with macOS, so this needs nothing installed.

```
# 1. Decode to JPEG at full resolution.
sips -s format jpeg "<source-file>" --out /tmp/work.jpg

# 2. If the source is a phone photo with EXIF orientation 6, bake the rotation
#    in. Orientation 8 needs -r 270 and orientation 3 needs -r 180.
sips -r 90 /tmp/work.jpg --out /tmp/upright.jpg

# 3. Crop to the edges of the work, so the wall and the room are not in frame.
#    -c takes height then width; --cropOffset takes top then left.
sips -c <height> <width> --cropOffset <top> <left> /tmp/upright.jpg --out /tmp/cropped.jpg

# 4. Resize into place.
sips -s format jpeg -s formatOptions 78 -Z 1200 /tmp/cropped.jpg \
  --out assets/gallery/painting-001.jpg
```

Do **not** take `imageWidth` and `imageHeight` from `sips -g pixelWidth`. For a rotated phone photo it reports the stored buffer, which is the two numbers the other way round. Read them from the file itself, or add the entry with any values and let `npm test` tell you the right ones: the suite parses each committed JPEG and fails on a declared size that disagrees with the bytes, or on a leftover orientation tag.

Then add one object per work to the `artworks` array in `content/artworks.json` and run `npm run build`.

> ## 入库流程
>
> 在仓库根目录执行，每张源图一次。`sips` 是 macOS 自带工具，无需安装任何依赖。步骤见上方英文代码块：1) 全分辨率解码为 JPEG；2) 若源文件是 EXIF orientation 为 6 的手机照片，将旋转烘焙进像素（orientation 8 用 `-r 270`，orientation 3 用 `-r 180`）；3) 裁切到作品边缘，不要让墙面与房间入画；4) 缩放并写入目标位置。
>
> **不要**用 `sips -g pixelWidth` 取 `imageWidth` 与 `imageHeight`。对于经过旋转的手机照片，它报告的是存储缓冲区的尺寸，两个数字正好颠倒。请直接从文件本身读取，或先随意填入数值再让 `npm test` 告知正确值：测试套件会解析每个已提交的 JPEG，若声明尺寸与字节不符、或残留 orientation 标签，即判定失败。
>
> 随后在 `content/artworks.json` 的 `artworks` 数组中为每件作品添加一个对象，再运行 `npm run build`。

## Metadata needed per work

Required: `medium` (one of the seven slugs in `content/gallery.json`), `titleEn`, `titleZh`.

`year` is optional. Supply it when the work is dated; omit it for an undated work and the card renders `n.d.`, the standard notation. Do not guess a year to fill the field, and do not use the photograph's capture date, which records when the work was photographed rather than when it was made.

Optional, and what makes the filter bar work: `sizeRange` (`small` | `medium` | `large` | `very-large`), `colors` (array), `style` (`abstract` | `figurative` | `realist`), `dimensionsEn` / `dimensionsZh`. A facet with fewer than two distinct values across a page's works is omitted from that page's filter bar rather than offered as a dead control. `sizeRange` needs the work's physical measurements, so it stays unset until those are known.

`altEn` / `altZh` are required too, but they are written from the image, not supplied.

> ## 每件作品所需的元数据
>
> 必填：`medium`（`content/gallery.json` 中七个 slug 之一）、`titleEn`、`titleZh`。
>
> `year` 为选填。作品有纪年时填写；无纪年则省略，卡片会渲染为 `n.d.`（国际通行的"无年份"标注）。不要为了填满字段而猜测年份，也不要使用照片的拍摄日期——那记录的是作品被拍摄的时间，而非创作时间。
>
> 选填，且决定筛选栏是否生效：`sizeRange`（`small` | `medium` | `large` | `very-large`）、`colors`（数组）、`style`（`abstract` | `figurative` | `realist`）、`dimensionsEn` / `dimensionsZh`。某个筛选维度在该页作品中不足两个不同取值时，会从该页筛选栏中省略，而不是作为失效控件出现。`sizeRange` 需要作品的实际物理尺寸，因此在尺寸未知前保持未设置。
>
> `altEn` / `altZh` 同为必填，但由图片本身撰写，无需提供。
