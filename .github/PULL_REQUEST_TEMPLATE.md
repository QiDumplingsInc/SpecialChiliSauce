Fill in every section. Do not delete a heading. A section that does not apply gets `None`, not silence -- a missing heading is the failure this template exists to prevent.

Three sections are the author's alone and carry refusal text until a human replaces them: **Motivation**, **Design decisions**, **Notes to reviewers**. An agent must not write them and must not offer to.

Each section is written in English first, then the same content as a Chinese blockquote directly beneath it, as the bilingual rule for this repository requires. Replace both halves of a section when you fill it in.

> 请填写每一节。不要删除任何标题。不适用的章节填 `None`，而不是留空——标题缺失正是本模板要防止的故障。
>
> 三节只能由作者本人填写，在人工替换之前保留拒审文本：**Motivation**、**Design decisions**、**Notes to reviewers**。代理不得代写，也不得主动提议代写。
>
> 每一节先写英文，紧接着在其下以中文引用块写出相同内容，这是本仓库的双语规则。填写时请同时替换两部分。

---

## Overview

State the behavior before this change and the behavior after it. Length matches how hard the change is to understand, not how large the diff is: one sentence for a rename, a paragraph when the behavioral shift is not obvious. Naming the files or functions you touched does not satisfy this section.

> 说明本次变更前的行为与变更后的行为。篇幅取决于变更有多难理解，而非 diff 有多大：改名一句话即可，行为变化不显而易见时写一段。仅列出改动的文件或函数不满足本节要求。

## Motivation

No motivation provided. PR is not ready for review. Author to update this text.

What problem forces this change, or what breaks if it does not happen. Restating what the code does is not a motivation.

> 未提供动机。本 PR 尚未就绪，待作者更新本文本。
>
> 是什么问题迫使本次变更，或者不做会有什么后果。重述代码做了什么不构成动机。

## Design decisions

No design decisions provided. PR is not ready for review. Author to update this text.

Name at least one alternative you considered and why you rejected it. If this pull request implements a plan document checked into `docs/`, a link to that plan satisfies this section.

> 未提供设计决策。本 PR 尚未就绪，待作者更新本文本。
>
> 至少说明一个你考虑过的替代方案以及拒绝它的原因。若本 PR 实现的是已纳入 `docs/` 的方案文档，给出该文档链接即可满足本节。

## Issues addressed

- `ARQ-NN` one line on what this pull request resolves for that issue.

> - `ARQ-NN` 用一行说明本 PR 为该任务解决了什么。

## Testing

pre-pr-check is not valid on the latest head commit `<head-short-sha>`. PR is not ready for review. Author to update this text.

When the check is valid, replace that line with: pre-pr-check passed on commit `<passed-short-sha>`. A rebase, squash, or amend replaces the passed SHA, so run the check again after any of them. If the check is not valid, open the pull request as a draft.

**Manual testing.** No manual testing provided and no justification given. PR is not ready for review. Author to update this text.

Manual testing with screenshots is required by default. You may omit it only by writing why this change does not need it. Relying on CI alone is allowed only if you state why CI covers the behavior in full. An agent must not write that justification.

**Test evidence.** No testing evidence provided. PR is not ready for review. Author to update this text.

Each piece of evidence names the case it covers. Acceptable forms: screenshots for manual testing, a CI run link where full CI reliance is justified above, or complete verbatim log excerpts. Happy-path evidence is the minimum. A bug fix also needs a negative test that reproduces the original failure and shows it resolved.

**Coverage gaps.** Name what the evidence above does not cover, or `None`.

> pre-pr-check 在最新头提交 `<head-short-sha>` 上无效。本 PR 尚未就绪，待作者更新本文本。
>
> 检查有效时，请将该行替换为：pre-pr-check 在提交 `<passed-short-sha>` 上通过。rebase、squash 或 amend 会替换已通过的 SHA，之后必须重新运行检查。若检查无效，请以草稿形式开启 PR。
>
> **手动测试。** 未提供手动测试，也未给出豁免理由。本 PR 尚未就绪，待作者更新本文本。
>
> 默认要求带截图的手动测试。只有写明本次变更为何无需手动测试才可省略。仅依赖 CI 时，必须说明 CI 为何完整覆盖该行为。该豁免理由不得由代理代写。
>
> **测试证据。** 未提供测试证据。本 PR 尚未就绪，待作者更新本文本。
>
> 每份证据都要指明它覆盖的用例。可接受的形式：手动测试截图、上文已论证完全依赖 CI 时的 CI 运行链接、完整且逐字的日志摘录。最低要求是正向路径证据。缺陷修复还需要一个复现原故障并显示其已解决的负向测试。
>
> **覆盖缺口。** 指出上述证据未覆盖的部分，或填 `None`。

## Impact analysis

None.

Fill this only when a reviewer's decision changes because of it. Config renames, documentation edits, and version bumps stay `None`.

> 无。
>
> 仅当它会改变评审者的判断时才填写。配置改名、文档编辑与版本号提升保持 `None`。

## Breaking changes

None.

Name any change to a public interface, a command, a content schema, or a committed artifact that a consumer depends on.

> 无。
>
> 列出对公共接口、命令、内容结构或使用方依赖的已提交产物的任何变更。

## Notes to reviewers

No notes provided. This section is the author's to write. Replace this line with your notes, or with `None` if there are none.

Use it for an out-of-tree side effect or a manual step a reviewer must reproduce. An agent must not write this section and must not offer to.

> 未提供说明。本节只能由作者撰写。请将本行替换为你的说明，若无则填 `None`。
>
> 用于说明仓库之外的副作用，或评审者必须自行复现的手动步骤。代理不得代写本节，也不得主动提议代写。

## Common development guidelines compliance

Followed. State any guideline you did not follow and why.

> 已遵循。请说明任何未遵循的准则及其原因。

## Agent disclosure

State whether an agent authored substantive prose in any section, and state for each of **Motivation**, **Design decisions**, and **Notes to reviewers** whether the author provided the text. Sections left as `None` or `N/A` do not count as authored. If no agent worked on this pull request, write `No agent involvement.`

> 说明是否有代理在任何章节撰写了实质性文字，并逐一说明 **Motivation**、**Design decisions**、**Notes to reviewers** 三节的文本是否由作者本人提供。填为 `None` 或 `N/A` 的章节不计为已撰写。若本 PR 没有代理参与，请写 `No agent involvement.`
