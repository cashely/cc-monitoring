import { Transform, TransformCallback } from 'stream'

// --- Claude API Types ---
interface ClaudeTool {
  name: string
  description?: string
  input_schema: any
}

type ClaudeContent =
  | string
  | Array<{
      type: 'text' | 'image' | 'tool_use' | 'tool_result'
      text?: string
      source?: {
        type: 'base64'
        media_type: string
        data: string
      }
      id?: string
      name?: string
      input?: any
      tool_use_id?: string
      content?: any
    }>

interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: ClaudeContent
}

interface ClaudeMessagesRequest {
  model: string
  messages: ClaudeMessage[]
  system?: string
  max_tokens: number
  stop_sequences?: string[]
  stream?: boolean
  temperature?: number
  top_p?: number
  top_k?: number
  tools?: ClaudeTool[]
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string }
}

// --- OpenAI API Types ---
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

interface OpenAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

interface OpenAIRequest {
  model: string
  messages: OpenAIMessage[]
  max_tokens?: number
  temperature?: number
  top_p?: number
  stop?: string[]
  stream?: boolean
  tools?: Array<{ type: 'function'; function: any }>
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
}

/**
 * Recursively cleans a JSON Schema for OpenAI API compatibility.
 * Removes '$schema' and 'additionalProperties'.
 * For string types, removes 'format' unless it's 'date-time' or 'enum'.
 */
function recursivelyCleanSchema(schema: any): any {
  if (schema === null || typeof schema !== 'object') return schema
  if (Array.isArray(schema)) return schema.map(item => recursivelyCleanSchema(item))

  const newSchema: { [key: string]: any } = {}
  for (const key in schema) {
    if (Object.prototype.hasOwnProperty.call(schema, key)) {
      if (key === '$schema' || key === 'additionalProperties') continue
      newSchema[key] = recursivelyCleanSchema(schema[key])
    }
  }

  if (newSchema.type === 'string' && newSchema.format) {
    const supportedFormats = ['date-time', 'enum']
    if (!supportedFormats.includes(newSchema.format)) {
      delete newSchema.format
    }
  }

  return newSchema
}

/**
 * Converts a Claude API request body to OpenAI format.
 */
export function convertClaudeToOpenAIRequest(
  claudeRequest: ClaudeMessagesRequest,
  modelName: string
): OpenAIRequest {
  const openaiMessages: OpenAIMessage[] = []

  if (claudeRequest.system) {
    openaiMessages.push({ role: 'system', content: claudeRequest.system })
  }

  for (const message of claudeRequest.messages) {
    if (message.role === 'user') {
      if (Array.isArray(message.content)) {
        const toolResults = message.content.filter(c => c.type === 'tool_result')
        const otherContent = message.content.filter(c => c.type !== 'tool_result')

        if (toolResults.length > 0) {
          toolResults.forEach(block => {
            openaiMessages.push({
              role: 'tool',
              tool_call_id: block.tool_use_id!,
              content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
            })
          })
        }

        if (otherContent.length > 0) {
          openaiMessages.push({
            role: 'user',
            content: otherContent.map(block =>
              block.type === 'text'
                ? { type: 'text', text: block.text }
                : { type: 'image_url', image_url: { url: `data:${block.source!.media_type};base64,${block.source!.data}` } }
            ) as any
          })
        }
      } else {
        openaiMessages.push({ role: 'user', content: message.content })
      }
    } else if (message.role === 'assistant') {
      const textParts: string[] = []
      const toolCalls: OpenAIToolCall[] = []
      if (Array.isArray(message.content)) {
        message.content.forEach(block => {
          if (block.type === 'text') {
            textParts.push(block.text!)
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id!,
              type: 'function',
              function: { name: block.name!, arguments: JSON.stringify(block.input || {}) },
            })
          }
        })
      }
      const assistantMessage: OpenAIMessage = {
        role: 'assistant',
        content: textParts.join('\n') || null as any
      }
      if (toolCalls.length > 0) {
        assistantMessage.tool_calls = toolCalls
      }
      openaiMessages.push(assistantMessage)
    }
  }

  const openaiRequest: OpenAIRequest = {
    model: modelName,
    messages: openaiMessages,
    max_tokens: claudeRequest.max_tokens,
    temperature: claudeRequest.temperature,
    top_p: claudeRequest.top_p,
    stream: claudeRequest.stream,
    stop: claudeRequest.stop_sequences,
  }

  if (claudeRequest.tools) {
    openaiRequest.tools = claudeRequest.tools.map((tool) => {
      const cleanedParameters = recursivelyCleanSchema(tool.input_schema)
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: cleanedParameters,
        },
      }
    })
  }

  if (claudeRequest.tool_choice) {
    if (claudeRequest.tool_choice.type === 'auto' || claudeRequest.tool_choice.type === 'any') {
      openaiRequest.tool_choice = 'auto'
    } else if (claudeRequest.tool_choice.type === 'tool') {
      openaiRequest.tool_choice = { type: 'function', function: { name: claudeRequest.tool_choice.name! } }
    }
  }

  return openaiRequest
}

/**
 * Converts a non-streaming OpenAI response to Claude format.
 */
export function convertOpenAIToClaudeResponse(openaiResponse: any, model: string): any {
  const choice = openaiResponse.choices[0]
  const contentBlocks: any[] = []

  if (choice.message.content) {
    contentBlocks.push({ type: 'text', text: choice.message.content })
  }

  if (choice.message.tool_calls) {
    choice.message.tool_calls.forEach((call: OpenAIToolCall) => {
      contentBlocks.push({
        type: 'tool_use',
        id: call.id,
        name: call.function.name,
        input: JSON.parse(call.function.arguments),
      })
    })
  }

  const stopReasonMap: Record<string, string> = {
    stop: 'end_turn',
    length: 'max_tokens',
    tool_calls: 'tool_use'
  }

  return {
    id: openaiResponse.id,
    type: 'message',
    role: 'assistant',
    model,
    content: contentBlocks,
    stop_reason: stopReasonMap[choice.finish_reason] || 'end_turn',
    usage: {
      input_tokens: openaiResponse.usage.prompt_tokens,
      output_tokens: openaiResponse.usage.completion_tokens,
    },
  }
}

/**
 * Builds headers for OpenAI-compatible API requests.
 */
export function buildOpenAIHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  }
}

/**
 * Creates a Node.js Transform stream that converts OpenAI SSE chunks to Claude SSE events.
 */
export function createStreamTransformer(model: string): Transform {
  let initialized = false
  let buffer = ''
  const messageId = `msg_${Math.random().toString(36).substr(2, 9)}`

  const toolCalls: { [index: number]: { id: string; name: string; args: string; claudeIndex: number; started: boolean } } = {}
  let contentBlockIndex = 0

  const sendEvent = (event: string, data: object) => {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  }

  return new Transform({
    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      if (!initialized) {
        this.push(sendEvent('message_start', {
          type: 'message_start',
          message: {
            id: messageId,
            type: 'message',
            role: 'assistant',
            model,
            content: [],
            stop_reason: null,
            usage: { input_tokens: 0, output_tokens: 0 }
          }
        }))
        this.push(sendEvent('content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' }
        }))
        initialized = true
      }

      buffer += chunk.toString()

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.substring(6)

        if (data.trim() === '[DONE]') {
          // Send closing events
          this.push(sendEvent('content_block_stop', { type: 'content_block_stop', index: 0 }))
          Object.values(toolCalls).forEach(tc => {
            if (tc.started) {
              this.push(sendEvent('content_block_stop', { type: 'content_block_stop', index: tc.claudeIndex }))
            }
          })

          let finalStopReason = 'end_turn'
          try {
            const lastChunk = JSON.parse(lines[lines.length - 2].substring(6))
            const finishReason = lastChunk.choices[0].finish_reason
            if (finishReason === 'tool_calls') finalStopReason = 'tool_use'
            if (finishReason === 'length') finalStopReason = 'max_tokens'
          } catch {}

          this.push(sendEvent('message_delta', {
            type: 'message_delta',
            delta: { stop_reason: finalStopReason, stop_sequence: null },
            usage: { output_tokens: 0 }
          }))
          this.push(sendEvent('message_stop', { type: 'message_stop' }))
          callback()
          this.destroy()
          return
        }

        try {
          const openaiChunk = JSON.parse(data)
          const delta = openaiChunk.choices[0]?.delta
          if (!delta) continue

          if (delta.content) {
            this.push(sendEvent('content_block_delta', {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: delta.content }
            }))
          }

          if (delta.tool_calls) {
            for (const tc_delta of delta.tool_calls) {
              const index = tc_delta.index
              if (!toolCalls[index]) {
                toolCalls[index] = { id: '', name: '', args: '', claudeIndex: 0, started: false }
              }
              if (tc_delta.id) toolCalls[index].id = tc_delta.id
              if (tc_delta.function?.name) toolCalls[index].name = tc_delta.function.name
              if (tc_delta.function?.arguments) toolCalls[index].args += tc_delta.function.arguments

              if (toolCalls[index].id && toolCalls[index].name && !toolCalls[index].started) {
                contentBlockIndex++
                toolCalls[index].claudeIndex = contentBlockIndex
                toolCalls[index].started = true
                this.push(sendEvent('content_block_start', {
                  type: 'content_block_start',
                  index: contentBlockIndex,
                  content_block: { type: 'tool_use', id: toolCalls[index].id, name: toolCalls[index].name, input: {} }
                }))
              }

              if (toolCalls[index].started && tc_delta.function?.arguments) {
                this.push(sendEvent('content_block_delta', {
                  type: 'content_block_delta',
                  index: toolCalls[index].claudeIndex,
                  delta: { type: 'input_json_delta', partial_json: tc_delta.function.arguments }
                }))
              }
            }
          }
        } catch {
          // Ignore JSON parse errors in SSE chunks
        }
      }

      callback()
    }
  })
}
