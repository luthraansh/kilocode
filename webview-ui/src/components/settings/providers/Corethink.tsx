import { useCallback } from "react"
import { VSCodeTextField, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"

import type { ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"
import { cn } from "@/lib/utils"

type CorethinkProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
}

export const Corethink = ({ apiConfiguration, setApiConfigurationField }: CorethinkProps) => {
	const { t } = useAppTranslation()

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	return (
		<>
			<div>
				<label className="block font-medium mb-1">{t("settings:providers.corethinkBaseUrl")}</label>
				<VSCodeDropdown
					value={apiConfiguration.corethinkBaseUrl}
					onChange={handleInputChange("corethinkBaseUrl")}
					className={cn("w-full")}>
					{/* kilocode_change start: anthropic api */}
					<VSCodeOption value="https://api.corethink.ai/v1/code" className="p-2">
						api.corethink.ai
					</VSCodeOption>
					{/* kilocode_change end */}
				</VSCodeDropdown>
			</div>
			<div>
				<VSCodeTextField
					value={apiConfiguration?.corethinkApiKey || ""}
					type="password"
					onInput={handleInputChange("corethinkApiKey")}
					placeholder={t("settings:placeholders.apiKey")}
					className="w-full">
					<label className="block font-medium mb-1">{t("settings:providers.corethinkApiKey")}</label>
				</VSCodeTextField>
				<div className="text-sm text-vscode-descriptionForeground">
					{t("settings:providers.apiKeyStorageNotice")}
				</div>
				{!apiConfiguration?.corethinkApiKey && (
					<VSCodeButtonLink
						href={
							// kilocode_change: anthropic api
							apiConfiguration.corethinkBaseUrl === "https://api.corethink.ai/v1/code"
								? "https://api.corethink.ai/v1/code"
								: "https://api.corethink.ai/v1/code"
						}
						appearance="secondary">
						{t("settings:providers.getCorethinkApiKey")}
					</VSCodeButtonLink>
				)}
			</div>
		</>
	)
}
