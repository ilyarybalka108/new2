import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { RecommendationResponse, type UserInput } from "./types";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt";

export const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";

export class NoCredentialsError extends Error {}
export class RefusedError extends Error {}

export function hasCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function recommend(input: UserInput): Promise<{ data: RecommendationResponse; model: string }> {
  if (!hasCredentials()) throw new NoCredentialsError("ANTHROPIC_API_KEY не задан");

  const client = new Anthropic();
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildUserMessage(input) }],
    output_config: {
      effort: "high",
      format: zodOutputFormat(RecommendationResponse),
    },
  });

  if (response.stop_reason === "refusal") {
    throw new RefusedError(response.stop_details?.explanation ?? "Модель отклонила запрос");
  }
  if (!response.parsed_output) {
    throw new Error(`Не удалось разобрать ответ модели (stop_reason=${response.stop_reason})`);
  }
  return { data: response.parsed_output, model: response.model };
}
