import type { ModelInfo } from "../model.js"

// Corethink
export type CorethinkModelId = keyof typeof corethinkModels
export const corethinkDefaultModelId: CorethinkModelId = "corethink"

export const corethinkModels = {
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
} as const satisfies Record<string, ModelInfo>

export const corethinkDefaultModelInfo: ModelInfo = corethinkModels[corethinkDefaultModelId]

export const CORETHINK_DEFAULT_MAX_TOKENS = 8192
export const CORETHINK_DEFAULT_TEMPERATURE = 1.0
