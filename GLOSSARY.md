# 词汇表

## SSE 帧（frame）

字节流按 SSE 规范切分出的单位，由若干字段行（`event:` / `data:` / `id:` / 注释 / 空行分发）组成。

## SSE 事件（event）

SSE 帧的 data 字段解析出的 JSON 消息。

## Learn 流水线

outline → refine → tag 三阶段编排的一次运行，是 pi 学习一个主题的完整过程。

## pi 会话

pi SDK 的 AgentSession，取消（abort）的最小单位；一次流水线各阶段各自创建会话。
