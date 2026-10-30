# 词汇表

## SSE 帧（frame）

字节流按 SSE 规范切分出的单位，由若干字段行（`event:` / `data:` / `id:` / 注释 / 空行分发）组成。

## SSE 事件（event）

SSE 帧的 data 字段解析出的 JSON 消息。
