import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { LlmAdapter, LlmMessage, LlmToolDef, LlmContentBlock } from "../llm/adapter.js";
import { tools as ocTools, ToolCtx, Tool } from "../tools/oc.js";

export type ToolCallRegistro = {
  nombre: string;
  argumentos: Record<string, unknown>;
  resultado: string; // JSON serializado {ok,data}|{ok,error}
  ok: boolean;
};

export type TurnoResultado = {
  reply: string;
  toolCalls: ToolCallRegistro[];
  needsConfirmation: boolean;
  mensajes: LlmMessage[]; // historial actualizado
  usage: { input: number; output: number };
};

/**
 * Convierte las herramientas (cuyos args son esquemas zod) al formato de tool que
 * entiende el proveedor LLM, generando el JSON Schema de cada una.
 * @param toolset  Mapa nombre→herramienta (ej. `oc_crear`).
 * @returns        Lista de definiciones `{ name, description, input_schema }`.
 */
export function construirToolDefs(toolset: Record<string, Tool>): LlmToolDef[] {
  return Object.entries(toolset).map(([nombre, tool]) => {
    const schema = zodToJsonSchema(z.object(tool.args), { $refStrategy: "none" });
    return {
      name: nombre,
      description: tool.description,
      input_schema: schema as Record<string, unknown>,
    };
  });
}

/** Extrae y concatena solo los bloques de texto de una respuesta del modelo. */
function textoDe(content: LlmContentBlock[]): string {
  return content
    .filter((b): b is Extract<LlmContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export type EjecutarTurnoOpts = {
  adapter: LlmAdapter;
  system: string;
  ctx: ToolCtx;
  historial: LlmMessage[];
  userMessage: string;
  maxIters?: number;
  maxTokensSesion?: number;
  tokensPreviosSesion?: number;
};

/**
 * Ejecuta un turno completo del agente.
 *
 * Añade el mensaje del usuario y repite modelo → herramientas → modelo hasta que el
 * modelo deja de pedir herramientas o se alcanza el tope de iteraciones (CA1) o de
 * tokens de sesión. Ejecuta las herramientas solicitadas, adjunta sus resultados,
 * registra cada llamada y decide si el turno quedó a la espera de confirmación.
 *
 * @param opts.adapter               Adaptador LLM a usar.
 * @param opts.system                System prompt.
 * @param opts.ctx                   Contexto de herramientas `{ directory, sessionId }`.
 * @param opts.historial             Mensajes previos de la sesión.
 * @param opts.userMessage           Mensaje nuevo del usuario.
 * @param opts.maxIters              Tope de iteraciones por turno (def. AGENT_MAX_ITERS).
 * @param opts.maxTokensSesion       Tope de tokens por sesión (def. AGENT_MAX_TOKENS_SESSION).
 * @param opts.tokensPreviosSesion   Tokens ya consumidos en la sesión.
 * @returns  `{ reply, toolCalls, needsConfirmation, mensajes, usage }`.
 */
export async function ejecutarTurno(opts: EjecutarTurnoOpts): Promise<TurnoResultado> {
  const {
    adapter,
    system,
    ctx,
    userMessage,
    maxIters = Number(process.env.AGENT_MAX_ITERS ?? 25),
    maxTokensSesion = Number(process.env.AGENT_MAX_TOKENS_SESSION ?? 200_000),
    tokensPreviosSesion = 0,
  } = opts;

  const toolDefs = construirToolDefs(ocTools);
  const mensajes: LlmMessage[] = [
    ...opts.historial,
    { role: "user", content: [{ type: "text", text: userMessage }] },
  ];

  const toolCalls: ToolCallRegistro[] = [];
  let needsConfirmation = false;
  let hayConfirmacionesPendientes = false;
  let ocCreadaEsteTurno = false;
  let tokensSesion = tokensPreviosSesion;
  let usageTurno = { input: 0, output: 0 };
  let reply = "";

  for (let iter = 0; iter < maxIters; iter++) {
    const resp = await adapter.enviar(system, mensajes, toolDefs);
    usageTurno.input += resp.usage.input;
    usageTurno.output += resp.usage.output;
    tokensSesion += resp.usage.input + resp.usage.output;

    mensajes.push({ role: "assistant", content: resp.content });
    reply = textoDe(resp.content);

    const usosHerramienta = resp.content.filter(
      (b): b is Extract<LlmContentBlock, { type: "tool_use" }> => b.type === "tool_use",
    );

    if (resp.stopReason !== "tool_use" || usosHerramienta.length === 0) {
      break; // el modelo respondió sin pedir más herramientas
    }

    // Ejecuta cada herramienta solicitada y adjunta los resultados.
    const resultados: LlmContentBlock[] = [];
    for (const uso of usosHerramienta) {
      const tool = ocTools[uso.name];
      let resultadoStr: string;
      if (!tool) {
        resultadoStr = JSON.stringify({ ok: false, error: `herramienta desconocida: ${uso.name}` });
      } else {
        resultadoStr = await tool.execute(uso.input ?? {}, ctx);
      }
      let ok = false;
      let parsed: any = null;
      try {
        parsed = JSON.parse(resultadoStr);
        ok = parsed.ok === true;
      } catch {
        ok = false;
      }
      // Confirmación detectada por dos vías: oc_crear rechaza por falta de
      // confirmación, o oc_validar reporta confirmaciones pendientes.
      if (!ok && /requiere confirmaci/i.test(resultadoStr)) needsConfirmation = true;
      if (uso.name === "oc_validar" && ok && Array.isArray(parsed?.data?.confirmaciones) && parsed.data.confirmaciones.length > 0) {
        hayConfirmacionesPendientes = true;
      }
      if (uso.name === "oc_crear" && ok) ocCreadaEsteTurno = true;

      toolCalls.push({ nombre: uso.name, argumentos: uso.input ?? {}, resultado: resultadoStr, ok });
      resultados.push({
        type: "tool_result",
        tool_use_id: uso.id,
        content: resultadoStr,
        is_error: !ok,
      });
    }
    mensajes.push({ role: "user", content: resultados });

    if (tokensSesion > maxTokensSesion) {
      reply =
        (reply ? reply + "\n\n" : "") +
        "⚠️ Se alcanzó el tope de tokens de la sesión. Detengo el procesamiento para proteger el costo.";
      break;
    }

    if (iter === maxIters - 1) {
      reply =
        (reply ? reply + "\n\n" : "") +
        "⚠️ Alcancé el tope de iteraciones por turno. Esto es lo que tengo hasta ahora; pídeme continuar si falta algo.";
    }
  }

  if (hayConfirmacionesPendientes && !ocCreadaEsteTurno) needsConfirmation = true;

  return { reply, toolCalls, needsConfirmation, mensajes, usage: usageTurno };
}
