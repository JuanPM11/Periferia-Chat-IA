import { LlmAdapter } from "./adapter.js";
import { AnthropicAdapter } from "./anthropic.js";

/**
 * Fábrica del adaptador LLM según LLM_PROVIDER.
 * Para añadir un proveedor, implementa LlmAdapter y agrégalo aquí; el ciclo del
 * agente no cambia.
 */
export function crearAdaptador(): LlmAdapter {
  const provider = (process.env.LLM_PROVIDER ?? "anthropic").toLowerCase();
  switch (provider) {
    case "anthropic":
      return new AnthropicAdapter({
        maxTokens: Number(process.env.AGENT_MAX_OUTPUT_TOKENS ?? 1500),
      });
    default:
      throw new Error(
        `Proveedor LLM no soportado: "${provider}". Implementa LlmAdapter y regístralo en src/llm/index.ts.`,
      );
  }
}
