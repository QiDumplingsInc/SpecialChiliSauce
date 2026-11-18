# assets/gallery -- artwork image destination

Web-ready artwork images live here, and nowhere else. One file per work. Every file in this folder is referenced by an entry in `content/artworks.json`, and the build renders the `<img>` tag from that entry.

> 画廊作品的网页版图片只放在这里，不放别处。每件作品一个文件。本目录中的每个文件都对应 `content/artworks.json` 中的一条记录，构建过程依据该记录渲染 `<img>` 标签。

## File contract

- Filename: `<medium-slug>-<nnn>.jpg`, for example `painting-001.jpg`. Lowercase ASCII, no spaces. The prefix is the `medium` slug from `content/gallery.json`, so the filename says which page the work renders on.
- Format: JPEG. Use PNG only for a work that genuinely needs it (flat line art, transparency).
- Size: long edge at most 1600 px, quality 80, under roughly 400 KB per file. The grid renders cards between 240 px and 400 px wide, so 1600 px still covers a 2x display on the widest card.
- Original files are **not** committed. Git keeps every version of a binary forever, and `index.html` already pulls 67.6 MB of images. Originals stay in the owner's own storage.

> ## 文件约定
>
> - 文件名：`<媒介-slug>-<序号>.jpg`，例如 `painting-001.jpg`。小写 ASCII，不含空格。前缀取自 `content/gallery.json` 中的 `medium` slug，因此文件名本身即说明该作品渲染在哪个页面。
> - 格式：JPEG。仅在确有必要时使用 PNG（纯线稿、需要透明通道）。
> - 尺寸：长边不超过 1600 px，质量 80，单文件约 400 KB 以内。网格中卡片宽度在 240 px 到 400 px 之间，1600 px 足以覆盖最宽卡片的 2 倍屏。
> - 原始文件**不**提交入库。Git 会永久保留二进制文件的每一个版本，而 `index.html` 已经引用了 67.6 MB 的图片。原图保留在所有者自己的存储中。

## Intake procedure

Run from the repo root, once per source image. `sips` ships with macOS, so this needs nothing installed.

```
sips --resampleHeightWidthMax 1600 -s format jpeg -s formatOptions 80 \
  "<source-file>" --out assets/gallery/painting-001.jpg

sips -g pixelWidth -g pixelHeight assets/gallery/painting-001.jpg
```

The second command prints the real pixel dimensions. They go into the entry's `imageWidth` and `imageHeight`, which the build writes as `width`/`height` attributes so the browser reserves layout space before the image loads.

Then add one object per work to the `artworks` array in `content/artworks.json` and run `npm run build`.

> ## 入库流程
>
> 在仓库根目录执行，每张源图一次。`sips` 是 macOS 自带工具，无需安装任何依赖。
>
> 第二条命令会打印真实像素尺寸，填入记录的 `imageWidth` 与 `imageHeight`。构建会把它们输出为 `width`/`height` 属性，使浏览器在图片加载前就预留出版面空间。
>
> 随后在 `content/artworks.json` 的 `artworks` 数组中为每件作品添加一个对象，再运行 `npm run build`。

## Metadata needed per work

Required: `medium` (one of the seven slugs in `content/gallery.json`), `titleEn`, `titleZh`, `year`.

Optional, and what makes the filter bar work: `sizeRange` (`small` | `medium` | `large` | `very-large`), `colors` (array), `style` (`abstract` | `figurative` | `realist`), `dimensionsEn` / `dimensionsZh`. A facet with fewer than two distinct values across a page's works is omitted from that page's filter bar rather than offered as a dead control.

`altEn` / `altZh` are required too, but they are written from the image, not supplied.

> ## 每件作品所需的元数据
>
> 必填：`medium`（`content/gallery.json` 中七个 slug 之一）、`titleEn`、`titleZh`、`year`。
>
> 选填，且决定筛选栏是否生效：`sizeRange`（`small` | `medium` | `large` | `very-large`）、`colors`（数组）、`style`（`abstract` | `figurative` | `realist`）、`dimensionsEn` / `dimensionsZh`。某个筛选维度在该页作品中不足两个不同取值时，会从该页筛选栏中省略，而不是作为失效控件出现。
>
> `altEn` / `altZh` 同为必填，但由图片本身撰写，无需提供。
