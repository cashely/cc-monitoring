# 词汇表

## SSE 帧（frame）

字节流按 SSE 规范切分出的单位，由若干字段行（`event:` / `data:` / `id:` / 注释 / 空行分发）组成。

## SSE 事件（event）

SSE 帧的 data 字段解析出的 JSON 消息。

## Learn 流水线

outline → refine → tag 三阶段编排的一次运行，是 pi 学习一个主题的完整过程。

## pi 会话

pi SDK 的 AgentSession，取消（abort）的最小单位；一次流水线各阶段各自创建会话。

## 会话事件

pi SDK 原始事件经映射后得到的领域事件：轮次开关（round_start/round_end）、文本与思考增量（text_delta/thinking_delta）、工具起止（tool_start/tool_end）。区别于 SSE 帧（传输封装）与 pi 原始事件（SDK 协议）。

## Learn 任务

一次 learn 运行在 learn_tasks 表中的状态机行，状态为 running / completed / failed / aborted / crashed；同 slug 同时只许一个 running。

## vault

learn 的文件型知识库，根目录为 `~/.cc-monitoring/docs`（测试可注入 tmpDir），是所有知识文件路径与读写的唯一权威（`utils/vault.ts`）。布局：根 `index.json` 为主题列表；每个主题一个 `<slug>/` 目录，内含主题 `index.json`（元数据 + chunk 引用清单，无正文）、`outline.json`、`sources/source-NNN.md`（抓取/上传原料）与 `chunks/chunk-NNN.md`（蒸馏正文）；`<slug>.old/` 为查重门使用的旁挂备份目录。

## topic（主题）

vault 中的一个知识条目单元，对应一个 `<slug>/` 目录：元数据（title/summary/tags）+ 若干 chunk 的引用清单，登记在该目录与根的 `index.json` 中。

## chunk（片段）

主题下最小的蒸馏正文单位，正文为 `<slug>/chunks/chunk-NNN.md`，其引用（id/title/summary/tags）登记在主题 `index.json` 的 chunks 列表中。

## slug

主题的短标识符，规则为小写字母数字开头、仅含小写字母数字与连字符（`^[a-z0-9][a-z0-9-]*$`），同时用作目录名；chunk id 形如 `chunk-NNN`。
