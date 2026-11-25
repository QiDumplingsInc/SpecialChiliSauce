Fill in every section. Do not delete a heading. A section that does not apply gets `None`, not silence -- a missing heading is the failure this template exists to prevent.

Whoever opens the pull request fills every section, and that includes an agent. No section waits for a different person: if an agent did the work, the agent knows the motivation, the tradeoff it made, and what it actually ran, so the agent writes those sections. Record who wrote what under **Agent disclosure** instead of leaving a section unfilled.

Each section is written in English first, then the same content as a Chinese blockquote directly beneath it, as the bilingual rule for this repository requires. Replace both halves of a section when you fill it in.

> 请填写每一节。不要删除任何标题。不适用的章节填 `None`，而不是留空——标题缺失正是本模板要防止的故障。
>
> 开启 PR 的人负责填写每一节，代理也一样。没有任何章节需要等另一个人来写：如果工作是代理做的，代理清楚变更动机、自己做出的取舍以及实际跑过什么，那就由代理来写这几节。请在 **Agent disclosure** 一节记录各节由谁撰写，而不是把章节留空。
>
> 每一节先写英文，紧接着在其下以中文引用块写出相同内容，这是本仓库的双语规则。填写时请同时替换两部分。

---

## Overview

State the behavior before this change and the behavior after it. Length matches how hard the change is to understand, not how large the diff is: one sentence for a rename, a paragraph when the behavioral shift is not obvious. Naming the files or functions you touched does not satisfy this section.

> 说明本次变更前的行为与变更后的行为。篇幅取决于变更有多难理解，而非 diff 有多大：改名一句话即可，行为变化不显而易见时写一段。仅列出改动的文件或函数不满足本节要求。

## Motivation

What problem forces this change, or what breaks if it does not happen. Restating what the code does is not a motivation. If the change came from a task or a board decision, say what that task was trying to fix, and link it.

> 是什么问题迫使本次变更，或者不做会有什么后果。重述代码做了什么不构成动机。若本次变更源自某个任务或 Board 决策，请说明该任务要解决什么问题，并给出链接。

## Design decisions

Name at least one alternative you considered and why you rejected it. If this pull request implements a plan document checked into `docs/`, a link to that plan satisfies this section. If the change had no real alternative, say that and say why -- `None` is not an acceptable answer here.

> 至少说明一个你考虑过的替代方案以及拒绝它的原因。若本 PR 实现的是已纳入 `docs/` 的方案文档，给出该文档链接即可满足本节。若本次变更确实没有可选方案，请说明这一点及其原因——本节不接受填 `None`。

## Issues addressed

- `ARQ-NN` one line on what this pull request resolves for that issue.

> - `ARQ-NN` 用一行说明本 PR 为该任务解决了什么。

## Testing

pre-pr-check is not valid on the latest head commit `<head-short-sha>`. PR is not ready for review. Author to update this text.

When the check is valid, replace that line with: pre-pr-check passed on commit `<passed-short-sha>`. A rebase, squash, or amend replaces the passed SHA, so run the check again after any of them. If the check is not valid, open the pull request as a draft. This line is a real gate on a command that either ran or did not: do not replace it until the check has actually passed.

**Manual testing.** Say what you ran by hand and what you saw, or say why this change does not need manual testing.

Manual testing with evidence is the default. You may omit it by writing why this change does not need it, and relying on CI alone is allowed when you state why CI covers the behavior in full. Whoever opens the pull request writes that justification, agent included -- but write only what you actually did. Never describe a run you did not perform.

**Test evidence.** Each piece of evidence names the case it covers. Acceptable forms: screenshots for manual testing, a CI run link where full CI reliance is justified above, or complete verbatim log excerpts. Happy-path evidence is the minimum. A bug fix also needs a negative test that reproduces the original failure and shows it resolved.

**Coverage gaps.** Name what the evidence above does not cover, or `None`.

> pre-pr-check 在最新头提交 `<head-short-sha>` 上无效。本 PR 尚未就绪，待作者更新本文本。
>
> 检查有效时，请将该行替换为：pre-pr-check 在提交 `<passed-short-sha>` 上通过。rebase、squash 或 amend 会替换已通过的 SHA，之后必须重新运行检查。若检查无效，请以草稿形式开启 PR。本行是针对一条"跑过或没跑过"的命令的硬性门禁：检查真正通过之前，不要替换本行。
>
> **手动测试。** 说明你手动跑了什么、看到了什么，或者说明本次变更为何不需要手动测试。
>
> 默认要求提供手动测试证据。写明本次变更为何无需手动测试即可省略；仅依赖 CI 时，需说明 CI 为何完整覆盖该行为。该豁免理由由开启 PR 的人撰写，代理也一样——但只写你真正做过的事。绝不要描述你没有执行过的运行。
>
> **测试证据。** 每份证据都要指明它覆盖的用例。可接受的形式：手动测试截图、上文已论证完全依赖 CI 时的 CI 运行链接、完整且逐字的日志摘录。最低要求是正向路径证据。缺陷修复还需要一个复现原故障并显示其已解决的负向测试。
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

None.

Use it for an out-of-tree side effect or a manual step a reviewer must reproduce, or anything you know that the diff does not show. Replace this with `None` only when there is genuinely nothing.

> 无。
>
> 用于说明仓库之外的副作用、评审者必须自行复现的手动步骤，或任何 diff 看不出但你知道的信息。只有在确实没有内容时才保留 `None`。

## Common development guidelines compliance

Followed. State any guideline you did not follow and why.

> 已遵循。请说明任何未遵循的准则及其原因。

## Agent disclosure

Name the sections an agent authored, and name the sections a person authored. Sections left as `None` do not count as authored. If no agent worked on this pull request, write `No agent involvement.` This section exists so a reviewer knows where the prose came from -- it is not a gate, and an agent authoring a section is not by itself a reason to hold the pull request.

> 列出由代理撰写的章节，以及由人撰写的章节。填为 `None` 的章节不计为已撰写。若本 PR 没有代理参与，请写 `No agent involvement.` 本节的作用是让评审者知道文字出自何处——它不是门禁，章节由代理撰写本身不构成扣住 PR 的理由。
