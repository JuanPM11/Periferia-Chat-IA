import {
  LlmAdapter,
  LlmMessage,
  LlmResponse,
  LlmToolDef,
  LlmContentBlock,
} from "./adapter.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

/** Implementación del adaptador para la API de mensajes de Anthropic (Claude). */
export class AnthropicAdapter implements LlmAdapter {
  readonly provider = "anthropic";
  readonly model: string;
  private readonly apiKey: string;
  private readonly maxTokens: number;

  /**
   * @param opts.apiKey     Clave; por defecto ANTHROPIC_API_KEY del entorno.
   * @param opts.model      Modelo; por defecto ANTHROPIC_MODEL o claude-sonnet-4-5.
   * @param opts.maxTokens  Tope de tokens de salida por llamada.
   * @throws                Si no hay API key (se exige en el entorno del backend).
   */
  constructor(opts?: { apiKey?: string; model?: string; maxTokens?: number }) {
    this.apiKey = opts?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    this.model = opts?.model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
    this.maxTokens = opts?.maxTokens ?? 1024;
    if (!this.apiKey) {
      throw new Error(
        "Falta ANTHROPIC_API_KEY. Defínela en el entorno del backend (nunca en el repo ni el front).",
      );
    }
  }

  /**
   * Implementa `LlmAdapter.enviar` contra la API de mensajes de Anthropic.
   * Aplica un timeout de 60s y traduce la respuesta al formato neutro del adaptador.
   * @throws  Mensaje claro si la API responde error o hay timeout.
   */
  async enviar(
    system: string,
    mensajes: LlmMessage[],
    herramientas: LlmToolDef[],
  ): Promise<LlmResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": API_VERSION,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: this.maxTokens,
          system,
          messages: mensajes,
          tools: herramientas,
        }),
      });

      if (!res.ok) {
        const texto = await res.text();
        throw new Error(`Anthropic respondió ${res.status}: ${texto.slice(0, 500)}`);
      }

      const json = (await res.json()) as {
        content: LlmContentBlock[];
        stop_reason: string;
        usage: { input_tokens: number; output_tokens: number };
      };

      return {
        content: json.content,
        stopReason: json.stop_reason,
        usage: {
          input: json.usage?.input_tokens ?? 0,
          output: json.usage?.output_tokens ?? 0,
        },
      };
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw new Error("El proveedor LLM no respondió a tiempo (timeout de 60s).");
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }
}
