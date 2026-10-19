// Interfaz propia del proveedor LLM. El ciclo del agente depende SOLO de esto,
// así que cambiar de proveedor no toca el agente (ver src/agent/loop.ts).

export type LlmToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type LlmContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export type LlmMessage = { role: "user" | "assistant"; content: LlmContentBlock[] };

export type LlmUsage = { input: number; output: number };

export type LlmResponse = {
  content: LlmContentBlock[];
  stopReason: string;
  usage: LlmUsage;
};

export interface LlmAdapter {
  readonly provider: string;
  readonly model: string;
  /**
   * Hace una llamada al modelo.
   * @param system        System prompt (comportamiento + conocimiento).
   * @param mensajes      Historial de la conversación (texto, tool_use, tool_result).
   * @param herramientas  Definiciones de herramientas que el modelo puede invocar.
   * @param signal        Señal opcional para cancelar la llamada en curso (aborta el fetch).
   * @returns             Bloques de contenido, motivo de parada y uso de tokens.
   */
  enviar(
    system: string,
    mensajes: LlmMessage[],
    herramientas: LlmToolDef[],
    signal?: AbortSignal,
  ): Promise<LlmResponse>;
}
