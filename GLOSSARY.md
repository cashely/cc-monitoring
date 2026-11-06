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
