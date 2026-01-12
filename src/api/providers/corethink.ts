/**
 * Corethink Provider
 *
 * OpenAI-compatible API adapter for the Corethink API backend.
 * API: https://api.corethink.ai/v1/code
 * Auth: Bearer token (CORETHINK_API_KEY, prefix: sk_)
 *
 * This provider converts Corethink's internal Anthropic message format
 * to OpenAI-compatible format for the Corethink API.
 */

import { Anthropic } from "@anthropic-ai/sdk"

import type { ModelInfo } from "@roo-code/types"
//import {type corethinkMofelId, corethinkDefaultModelId, corethinkModels} from "@roo-code/types"

import type { ApiHandlerCreateMessageMetadata } from "../index"
import { convertToOpenAiMessages } from "../transform/openai-format"
import {
	ApiStream,
	ApiStreamChunk,
	ApiStreamTextChunk,
	ApiStreamUsageChunk,
	ApiStreamReasoningChunk,
	ApiStreamToolCallPartialChunk,
} from "../transform/stream"
import { BaseProvider } from "./base-provider"

// Corethink API Configuration
const CORETHINK_API_URL = process.env.CORETHINK_API_URL || "https://api.corethink.ai/v1/code"
const CORETHINK_API_KEY = process.env.CORETHINK_API_KEY || ""

// Debug logging
function debugLog(message: string): void {
	if (process.env.CORETHINK_DEBUG) {
		console.log(`[Corethink] ${new Date().toISOString()} ${message}`)
	}
}

// OpenAI-compatible interfaces
interface OpenAIToolCall {
	id: string
	type: "function"
	index?: number
	function: {
		name: string
		arguments: string
	}
}

interface OpenAITool {
	type: "function"
	function: {
		name: string
		description?: string
		parameters?: Record<string, unknown>
	}
}

interface CorethinkRequest {
	model: string
	messages: Array<{
		role: string
		content?: string | null
		tool_calls?: OpenAIToolCall[]
		tool_call_id?: string
	}>
	stream: boolean
	temperature?: number
	max_tokens?: number
	tools?: OpenAITool[]
	tool_choice?: string | Record<string, unknown>
}

interface CorethinkStreamEvent {
	id?: string
	object?: string
	model?: string
	choices?: Array<{
		index: number
		delta: {
			role?: string
			content?: string | null
			reasoning?: string | null
			tool_calls?: Array<{
				index?: number
				id?: string
				type?: string
				function?: {
					name?: string
					arguments?: string
				}
			}>
		}
		finish_reason?: string | null
	}>
	usage?: {
		prompt_tokens?: number
		completion_tokens?: number
		total_tokens?: number
	}
	error?: string
}

// Corethink available models
export const CORETHINK_MODELS = {
	corethink: {
		maxTokens: 8192,
		contextWindow: 79000,
		supportsPromptCache: false,
		supportsImages: true,
		supportsNativeTools: true,
		inputPrice: 1.0,
		outputPrice: 1.0,
		description: "Corethink - AI that reasons through problems instead of guessing.",
	},
} as const

// Default model info
const CORETHINK_DEFAULT_MODEL_INFO: ModelInfo = CORETHINK_MODELS.corethink

export class CorethinkHandler extends BaseProvider {
	private apiUrl: string
	private apiKey: string
	private modelId: string

	constructor(options: { corethinkApiKey?: string; corethinkBaseUrl?: string; apiModelId?: string }) {
		super()

		if (!options.corethinkApiKey) {
			throw new Error("[Corethink] apiKey was not provided from settings")
		}

		this.apiKey = options.corethinkApiKey
		this.apiUrl = options.corethinkBaseUrl || CORETHINK_API_URL
		this.modelId = options.apiModelId || "corethink"

		if (!this.apiKey) {
			console.warn("[Corethink] Warning: CORETHINK_API_KEY not set. API calls may fail.")
		}

		if (!this.apiKey.startsWith("sk_")) {
			console.warn("[Corethink] Warning: CORETHINK_API_KEY should start with 'sk_'")
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		// Get model info for the selected model, fallback to default
		const modelInfo =
			CORETHINK_MODELS[this.modelId as keyof typeof CORETHINK_MODELS] || CORETHINK_DEFAULT_MODEL_INFO

		return {
			id: this.modelId,
			info: modelInfo,
		}
	}

	async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		debugLog(`createMessage called with ${messages.length} messages`)

		// Convert Anthropic messages to OpenAI format
		const openAiMessages = convertToOpenAiMessages(messages)
		debugLog(`Converted to ${openAiMessages.length} OpenAI messages`)

		// Add system prompt at the beginning
		const requestMessages = [{ role: "system", content: systemPrompt }, ...openAiMessages]

		// Convert tools to OpenAI format (using base provider helper for strict mode)
		const tools = metadata?.tools ? this.convertToolsForOpenAI(metadata.tools) : undefined
		debugLog(`Tools: ${tools?.length || 0}`)

		// Build request
		const request: CorethinkRequest = {
			model: this.modelId,
			messages: requestMessages as CorethinkRequest["messages"],
			stream: true,
			tools: tools as OpenAITool[] | undefined,
		}

		// Add tool choice if specified
		if (metadata?.tool_choice) {
			if (typeof metadata.tool_choice === "string") {
				request.tool_choice = metadata.tool_choice
			} else if (typeof metadata.tool_choice === "object" && "function" in metadata.tool_choice) {
				request.tool_choice = {
					type: "function",
					function: { name: (metadata.tool_choice as { function: { name: string } }).function.name },
				}
			}
		}

		debugLog(`Making request to ${this.apiUrl}/chat/completions`)

		// Make streaming request
		const response = await fetch(`${this.apiUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
				Accept: "text/event-stream",
			},
			body: JSON.stringify(request),
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`Corethink API error: ${response.status} - ${errorText}`)
		}

		if (!response.body) {
			throw new Error("No response body from Corethink API")
		}

		// Process SSE stream
		yield* this.processStream(response.body)
	}

	private async *processStream(body: ReadableStream<Uint8Array>): ApiStream {
		const reader = body.getReader()
		const decoder = new TextDecoder()
		let buffer = ""

		// Track tool calls being streamed (by index)
		const toolCallsInProgress: Map<
			number,
			{
				id: string
				name: string
				arguments: string
			}
		> = new Map()

		try {
			while (true) {
				const { done, value } = await reader.read()

				if (done) {
					debugLog("Stream ended")
					break
				}

				buffer += decoder.decode(value, { stream: true })
				const lines = buffer.split("\n")
				buffer = lines.pop() || ""

				for (const line of lines) {
					const trimmedLine = line.trim()

					if (!trimmedLine || !trimmedLine.startsWith("data:")) {
						continue
					}

					const data = trimmedLine.slice(5).trim()

					if (data === "[DONE]") {
						debugLog("Received [DONE]")
						return
					}

					try {
						const event = JSON.parse(data) as CorethinkStreamEvent

						// Handle error events
						if (event.error) {
							yield {
								type: "error",
								error: "api_error",
								message: event.error,
							}
							return
						}

						const choice = event.choices?.[0]
						if (!choice) continue

						// Handle text content - Corethink uses 'reasoning' field for streaming
						const deltaContent = choice.delta?.content || choice.delta?.reasoning || ""
						if (deltaContent) {
							debugLog(`Text chunk: ${deltaContent.substring(0, 50)}...`)
							yield {
								type: "text",
								text: deltaContent,
							} as ApiStreamTextChunk
						}

						// Handle reasoning separately if both content and reasoning are present
						if (choice.delta?.reasoning && choice.delta?.content) {
							yield {
								type: "reasoning",
								text: choice.delta.reasoning,
							} as ApiStreamReasoningChunk
						}

						// Handle tool calls
						if (choice.delta?.tool_calls) {
							for (const toolCallChunk of choice.delta.tool_calls) {
								const index = toolCallChunk.index ?? 0

								// Initialize or update tool call tracking
								if (!toolCallsInProgress.has(index)) {
									toolCallsInProgress.set(index, {
										id: toolCallChunk.id || "",
										name: toolCallChunk.function?.name || "",
										arguments: "",
									})
								}

								const tracked = toolCallsInProgress.get(index)!

								// Update with new data
								if (toolCallChunk.id) tracked.id = toolCallChunk.id
								if (toolCallChunk.function?.name) tracked.name = toolCallChunk.function.name
								if (toolCallChunk.function?.arguments) {
									tracked.arguments += toolCallChunk.function.arguments
								}

								// Emit partial chunk for NativeToolCallParser
								yield {
									type: "tool_call_partial",
									index,
									id: toolCallChunk.id,
									name: toolCallChunk.function?.name,
									arguments: toolCallChunk.function?.arguments,
								} as ApiStreamToolCallPartialChunk
							}
						}

						// Handle usage info
						if (event.usage) {
							yield {
								type: "usage",
								inputTokens: event.usage.prompt_tokens || 0,
								outputTokens: event.usage.completion_tokens || 0,
								inferenceProvider: "corethink",
							} as ApiStreamUsageChunk
						}

						// Handle finish reason
						if (choice.finish_reason) {
							debugLog(`Finish reason: ${choice.finish_reason}`)
						}
					} catch (parseError) {
						debugLog(`Failed to parse SSE event: ${data}`)
						// Skip malformed JSON and continue
					}
				}
			}
		} finally {
			reader.releaseLock()
		}
	}
}

/**
 * Check if Corethink mode is active based on environment variable
 */
export function isCorethinkMode(): boolean {
	const apiKey = process.env.CORETHINK_API_KEY
	return !!apiKey && apiKey.startsWith("sk_")
}

/**
 * Get Corethink API key from environment
 */
export function getCorethinkApiKey(): string | undefined {
	return process.env.CORETHINK_API_KEY
}

/**
 * Get Corethink API URL from environment or default
 */
export function getCorethinkApiUrl(): string {
	return process.env.CORETHINK_API_URL || CORETHINK_API_URL
}
