# assets/gallery -- artwork image destination

Web-ready artwork images live here, and nowhere else. A work can have several photographs, so there is one file per photograph rather than one per work. Every file in this folder is referenced by an entry in the `images` array of `content/artworks.json`, and the build renders each `<img>` tag from that entry.

> 画廊作品的网页版图片只放在这里，不放别处。一件作品可以有多张照片，因此是每张照片一个文件，而非每件作品一个文件。本目录中的每个文件都被 `content/artworks.json` 中某条记录的 `images` 数组引用，构建过程依据这些记录渲染各个 `<img>` 标签。

## The three views, and the crop rule

Each image declares a `view`, and the view decides whether the photograph may be cropped.

- `front` -- the work photographed face on. **Crop to the edges of the work**, so the wall and the room are out of frame. Straightening a crooked or distant shot by cropping is expected here.
- `in-situ` -- the work where it hangs. **Never crop.** This framing is deliberate: the photograph is about how the work sits in the room, and a crop throws that away.
- `detail` -- one part of the work at close range. **Never crop.**

Order inside `images` is the order the carousel shows, and the first image is what the grid shows:

- A work with a face-on photograph leads with it. The build fails if a `front` image is not first.
- A work with no face-on photograph leads with its `in-situ` shot, then details. This is deliberate for a work the owner does not want a clean face-on reference image of.
- An `in-situ` photograph that shows several works at once is referenced by each of those works.

The hub page (`gallery.html`) picks photographs out of this folder too, through `heroSlides`, `aboutPanels` and a medium page's `cover` in `content/gallery.json`. Every hub slot has a fixed aspect ratio and crops the photograph to fill it, so only a `front` or `detail` view belongs in one; the build fails on an `in-situ` reference there. A medium with no published work renders `mediumEmptyCover` copy instead of a photograph, and never promises one.

> ## 三种视图与裁切规则
>
> 每张图片都声明一个 `view`，而该视图决定这张照片是否可以裁切。
>
> - `front` —— 作品的正面照。**裁切到作品边缘**，不要让墙面与房间入画。若原片拍歪或画面过小，在此通过裁切校正是预期做法。
> - `in-situ` —— 作品在其悬挂位置的实景照。**绝不裁切。** 这种取景是刻意的：照片要表达的是作品在房间中的摆放效果，裁切会把这一点丢掉。
> - `detail` —— 作品某一局部的近景。**绝不裁切。**
>
> `images` 中的顺序即轮播展示顺序，第一张就是网格中显示的那张：
>
> - 有正面照的作品以正面照为首。若 `front` 图片不在首位，构建会失败。
> - 没有正面照的作品以 `in-situ` 实景照为首，随后是细节图。对于不希望存在清晰正面参考图的作品，这是刻意安排。
> - 同时拍到多件作品的 `in-situ` 照片，会被其中每一件作品引用。
>
> 首页（`gallery.html`）也从本目录挑选照片，通过 `content/gallery.json` 中的 `heroSlides`、`aboutPanels` 以及各媒介页的 `cover` 指定。首页的每个图片位都有固定的宽高比，会把照片裁切填满该位置，因此只能放 `front` 或 `detail` 视图；若在此引用 `in-situ`，构建会失败。没有已发布作品的媒介渲染 `mediumEmptyCover` 文案，而不是照片，也绝不承诺会有照片。

## File contract

- Filename: `<artwork-id>-<n>.jpg`, for example `painting-001-1.jpg`, where `<n>` is the position in that work's `images` array. An in-situ photograph shared by several works is named `wall-<n>.jpg` instead, because it belongs to no single work.
- Format: JPEG. Use PNG only for a work that genuinely needs it (flat line art, transparency).
- Size: long edge at most 1200 px for a work's first photograph and 1000 px for the rest, under roughly 400 KB per file. The grid renders cards between 240 px and 400 px wide, so 1200 px still covers a 2x display on the widest card; a later carousel slide is only seen after a swipe.
- Orientation must be baked into the pixels, and the file must carry no EXIF block at all. A phone photo stores a landscape buffer plus a rotate tag; if that tag survives, the browser rotates an image that is already upright. Dropping the whole EXIF block also drops the GPS coordinates a phone writes into a photo taken inside a home.
- Original files are **not** committed. Git keeps every version of a binary forever, and `index.html` already pulls 67.6 MB of images. Originals stay in the owner's own storage, and each image records the original filename in its `source` field.

> ## 文件约定
>
> - 文件名：`<作品 id>-<序号>.jpg`，例如 `painting-001-1.jpg`，序号即该作品 `images` 数组中的位置。被多件作品共用的实景照改用 `wall-<序号>.jpg` 命名，因为它不属于任何单一作品。
> - 格式：JPEG。仅在确有必要时使用 PNG（纯线稿、需要透明通道）。
> - 尺寸：作品首张照片长边不超过 1200 px，其余不超过 1000 px，单文件约 400 KB 以内。网格中卡片宽度在 240 px 到 400 px 之间，1200 px 足以覆盖最宽卡片的 2 倍屏；后续轮播图只有滑动后才会看到。
> - 旋转必须烘焙进像素，且文件不得保留任何 EXIF 区块。手机照片会存储横向缓冲区外加一个旋转标签；若该标签残留，浏览器会把本已正立的图片再次旋转。整块移除 EXIF 同时也移除了手机写入的 GPS 坐标——这些照片拍摄于住宅内部。
> - 原始文件**不**提交入库。Git 会永久保留二进制文件的每一个版本，而 `index.html` 已经引用了 67.6 MB 图片。原图保留在所有者自己的存储中，每张图片在 `source` 字段记录其原始文件名。

## Intake procedure

Run from the repo root, once per photograph. `sips` ships with macOS, so this needs nothing installed.

```
# 1. Decode to JPEG at full resolution.
sips -s format jpeg "<source-file>" --out /tmp/work.jpg

# 2. Bake the rotation in. EXIF orientation 6 needs -r 90, orientation 8 needs
#    -r 270, orientation 3 needs -r 180, orientation 1 needs no rotation.
#    sips leaves the tag in place, which step 5 removes.
sips -r 90 /tmp/work.jpg --out /tmp/upright.jpg

# 3. For a front view only, crop to the edges of the work. Skip this step
#    entirely for an in-situ or detail view.
#    -c takes height then width; --cropOffset takes top then left.
sips -c <height> <width> --cropOffset <top> <left> /tmp/upright.jpg --out /tmp/cropped.jpg

# 4. Resize into place: 1200 for a work's first photograph, 1000 for the rest.
sips -s format jpeg -s formatOptions 78 -Z 1200 /tmp/cropped.jpg \
  --out assets/gallery/painting-001-1.jpg

# 5. Strip every metadata segment, which is what finally removes the rotate tag
#    and the GPS coordinates. node -e, so nothing has to be installed.
node -e 'const f=process.argv[1],fs=require("fs"),b=fs.readFileSync(f);const k=[b.subarray(0,2)];let o=2;while(o<b.length-1){if(b[o]!==0xff)break;const m=b[o+1];if(m===0xda){k.push(b.subarray(o));break}const l=b.readUInt16BE(o+2);if(!((m>=0xe1&&m<=0xef)||m===0xfe))k.push(b.subarray(o,o+2+l));o+=2+l}fs.writeFileSync(f,Buffer.concat(k))' assets/gallery/painting-001-1.jpg
```

Do **not** take `width` and `height` from `sips -g pixelWidth`. For a rotated phone photo it reports the stored buffer, which is the two numbers the other way round. Read them from the file itself, or add the entry with any values and let `npm test` tell you the right ones: the suite parses each committed JPEG and fails on a declared size that disagrees with the bytes, or on a leftover orientation tag.

Then add the image to the right work's `images` array in `content/artworks.json` and run `npm run build`.

> ## 入库流程
>
> 在仓库根目录执行，每张照片一次。`sips` 是 macOS 自带工具，无需安装任何依赖。步骤见上方英文代码块：1) 全分辨率解码为 JPEG；2) 将旋转烘焙进像素（orientation 6 用 `-r 90`，8 用 `-r 270`，3 用 `-r 180`，1 无需旋转）；3) **仅正面照**裁切到作品边缘，实景照与细节图完全跳过此步；4) 缩放并写入目标位置（作品首张用 1200，其余用 1000）；5) 移除所有元数据区块，这一步才真正去掉旋转标签与 GPS 坐标。
>
> **不要**用 `sips -g pixelWidth` 取 `width` 与 `height`。对于经过旋转的手机照片，它报告的是存储缓冲区的尺寸，两个数字正好颠倒。请直接从文件本身读取，或先随意填入数值再让 `npm test` 告知正确值：测试套件会解析每个已提交的 JPEG，若声明尺寸与字节不符、或残留 orientation 标签，即判定失败。
>
> 随后把该图片加入 `content/artworks.json` 中对应作品的 `images` 数组，再运行 `npm run build`。

## Metadata needed per work

Required: `medium` (one of the seven slugs in `content/gallery.json`), `titleEn`, `titleZh`, and `images` with at least one entry.

Required per image: `src`, `width`, `height`, `view`, `altEn`, `altZh`. `source` records the original filename and is not rendered.

`year` is optional. Supply it when the work is dated; omit it for an undated work and the card renders `n.d.`, the standard notation. Do not guess a year to fill the field, and do not use the photograph's capture date, which records when the work was photographed rather than when it was made.

Optional, and what makes the filter bar work: `sizeRange` (`small` | `medium` | `large` | `very-large`), `colors` (array), `style` (`abstract` | `figurative` | `realist`), `dimensionsEn` / `dimensionsZh`. A facet with fewer than two distinct values across a page's works is omitted from that page's filter bar rather than offered as a dead control. `sizeRange` needs the work's physical measurements, so it stays unset until those are known.

`altEn` / `altZh` are required too, but they are written from the image, not supplied.

> ## 每件作品所需的元数据
>
> 必填：`medium`（`content/gallery.json` 中七个 slug 之一）、`titleEn`、`titleZh`，以及至少含一条记录的 `images`。
>
> 每张图片必填：`src`、`width`、`height`、`view`、`altEn`、`altZh`。`source` 记录原始文件名，不参与渲染。
>
> `year` 为选填。作品有纪年时填写；无纪年则省略，卡片会渲染为 `n.d.`（国际通行的"无年份"标注）。不要为了填满字段而猜测年份，也不要使用照片的拍摄日期——那记录的是作品被拍摄的时间，而非创作时间。
>
> 选填，且决定筛选栏是否生效：`sizeRange`（`small` | `medium` | `large` | `very-large`）、`colors`（数组）、`style`（`abstract` | `figurative` | `realist`）、`dimensionsEn` / `dimensionsZh`。某个筛选维度在该页作品中不足两个不同取值时，会从该页筛选栏中省略，而不是作为失效控件出现。`sizeRange` 需要作品的实际物理尺寸，因此在尺寸未知前保持未设置。
>
> `altEn` / `altZh` 同为必填，但由图片本身撰写，无需提供。
