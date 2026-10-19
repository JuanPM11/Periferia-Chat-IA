import { z } from "zod";
import { cargarMaestros, cargarPaquete } from "../core/fixtures.js";
import { validar } from "../core/validate.js";
import { construirPayload } from "../core/payload.js";
import { generarEvidencia } from "../core/evidence.js";
import { SapMock } from "../sap/mock.js";
import { registrarControl, registrarLog } from "../core/control.js";
import { ToolResult } from "../core/types.js";

/** Contexto que recibe cada herramienta: raíz del proyecto y id de sesión. */
export type ToolCtx = { directory: string; sessionId: string };

/**
 * Forma de una herramienta (contrato de la sección 6.2 del PRD):
 * - `description`: una frase; es lo único que el modelo lee para decidir cuándo llamarla.
 * - `args`: esquemas zod por campo (el backend valida antes de ejecutar).
 * - `execute`: devuelve SIEMPRE un string JSON `{ ok,data }`|`{ ok,error }`; nunca lanza.
 */
export type Tool = {
  description: string;
  args: Record<string, z.ZodTypeAny>;
  execute(args: Record<string, unknown>, ctx: ToolCtx): Promise<string>;
};

/** Serializa un resultado exitoso de herramienta: `{ ok: true, data }` como string. */
function ok<T>(data: T): string {
  return JSON.stringify({ ok: true, data } satisfies ToolResult<T>);
}
/** Serializa un error de herramienta: `{ ok: false, error }` como string (nunca lanza). */
function err(error: string): string {
  return JSON.stringify({ ok: false, error } satisfies ToolResult<never>);
}

// ---------------------------------------------------------------------------
// oc_leer_paquete (P0)
// Entrada: { caso } · Salida: Paquete normalizado (7.2).
// ---------------------------------------------------------------------------
export const leer_paquete: Tool = {
  description:
    "Lee la carpeta de un caso (correo, solicitud, cotización, aprobación y factura si existe) y devuelve el paquete normalizado.",
  args: {
    caso: z
      .string()
      .describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/ (ej. sol-001)"),
  },
  async execute(args, ctx) {
    const caso = String(args.caso ?? "");
    try {
      const { paquete } = cargarPaquete(ctx.directory, caso);
      registrarLog(ctx.directory, {
        herramienta: "oc_leer_paquete",
        caso,
        ok: true,
        resumen: `paquete ${paquete.solicitud.solicitud_id} leído`,
      });
      return ok(paquete);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      registrarLog(ctx.directory, { herramienta: "oc_leer_paquete", caso, ok: false, resumen: msg });
      return err(`No se pudo leer el caso "${caso}": ${msg}`);
    }
  },
};

// ---------------------------------------------------------------------------
// oc_validar (P0)
// Entrada: { caso, paquete? } · Salida: { apta, bloqueos, confirmaciones, derivados, retroactiva }.
// Recarga el caso desde fixtures (no confía en el paquete que reenvía el modelo).
// ---------------------------------------------------------------------------
export const validar_oc: Tool = {
  description:
    "Aplica los controles RC1–RC10 al caso y devuelve si es apta, los bloqueos, las confirmaciones requeridas, los valores derivados y si es retroactiva.",
  args: {
    caso: z.string().describe("Carpeta del caso (ej. sol-001)"),
    paquete: z
      .any()
      .optional()
      .describe("Paquete devuelto por oc_leer_paquete (opcional; la herramienta recarga desde fixtures)"),
  },
  async execute(args, ctx) {
    const caso = String(args.caso ?? "");
    try {
      const maestros = cargarMaestros(ctx.directory);
      const { paquete } = cargarPaquete(ctx.directory, caso);
      const resultado = validar(maestros, paquete);
      registrarLog(ctx.directory, {
        herramienta: "oc_validar",
        caso,
        ok: true,
        resumen: `apta=${resultado.apta} bloqueos=${resultado.bloqueos.length} confirmaciones=${resultado.confirmaciones.length} retroactiva=${resultado.retroactiva}`,
      });
      return ok(resultado);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      registrarLog(ctx.directory, { herramienta: "oc_validar", caso, ok: false, resumen: msg });
      return err(`No se pudo validar el caso "${caso}": ${msg}`);
    }
  },
};

// ---------------------------------------------------------------------------
// oc_construir_payload (P0)
// Entrada: { caso, paquete?, derivados? } · Salida: { payload, ruta_trazabilidad }.
// Genera la evidencia para obtener el sha256 y escribe trazabilidad. No crea la OC.
// ---------------------------------------------------------------------------
export const construir_payload: Tool = {
  description:
    "Construye el payload de la OC tal como quedaría en SAP (validado con zod) y escribe la trazabilidad fuente→valor. No crea la OC.",
  args: {
    caso: z.string().describe("Carpeta del caso (ej. sol-001)"),
    paquete: z.any().optional().describe("Paquete (opcional; se recarga desde fixtures)"),
    derivados: z.any().optional().describe("Derivados de oc_validar (opcional; se recalculan)"),
  },
  async execute(args, ctx) {
    const caso = String(args.caso ?? "");
    try {
      const maestros = cargarMaestros(ctx.directory);
      const { paquete, cotizacionRef } = cargarPaquete(ctx.directory, caso);
      const resultado = validar(maestros, paquete);
      const evidencia = await generarEvidencia(ctx.directory, caso, paquete);
      const { payload, rutaTrazabilidad } = construirPayload(
        ctx.directory,
        caso,
        maestros,
        paquete,
        resultado,
        evidencia.sha256,
        cotizacionRef,
      );
      registrarLog(ctx.directory, {
        herramienta: "oc_construir_payload",
        caso,
        ok: true,
        resumen: `payload ${payload.referencia.solicitud_id} construido`,
      });
      return ok({ payload, ruta_trazabilidad: rutaTrazabilidad });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      registrarLog(ctx.directory, { herramienta: "oc_construir_payload", caso, ok: false, resumen: msg });
      return err(`No se pudo construir el payload de "${caso}": ${msg}`);
    }
  },
};

// ---------------------------------------------------------------------------
// oc_generar_evidencia (P0 txt · P1 pdf)
// Entrada: { caso } · Salida: { ruta, ruta_pdf, sha256 }.
// ---------------------------------------------------------------------------
export const generar_evidencia: Tool = {
  description:
    "Genera la evidencia de aprobación (aprobacion.txt con encabezados y cuerpo; aprobacion.pdf si es posible) y devuelve su ruta y sha256.",
  args: {
    caso: z.string().describe("Carpeta del caso (ej. sol-001)"),
  },
  async execute(args, ctx) {
    const caso = String(args.caso ?? "");
    try {
      const { paquete } = cargarPaquete(ctx.directory, caso);
      const ev = await generarEvidencia(ctx.directory, caso, paquete);
      registrarLog(ctx.directory, {
        herramienta: "oc_generar_evidencia",
        caso,
        ok: true,
        resumen: `evidencia sha256=${ev.sha256.slice(0, 12)}…`,
      });
      return ok({ ruta: ev.ruta, ruta_pdf: ev.rutaPdf, sha256: ev.sha256 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      registrarLog(ctx.directory, { herramienta: "oc_generar_evidencia", caso, ok: false, resumen: msg });
      return err(`No se pudo generar la evidencia de "${caso}": ${msg}`);
    }
  },
};

// ---------------------------------------------------------------------------
// oc_crear (P0)
// Entrada: { caso, payload?, confirmado? } · Salida: { numero_oc, fecha, idempotente, retroactiva }
//          o { ok:false, error }.
// Reglas: si hay bloqueos → no crea; si hay confirmaciones y !confirmado → no crea;
//         idempotente por solicitud_id; registra el intento en control.csv.
// ---------------------------------------------------------------------------
export const crear: Tool = {
  description:
    "Crea la OC en el SAP simulado. Solo procede si el caso es apto y (no hay confirmaciones pendientes o confirmado=true). Es idempotente por solicitud_id. Registra el intento en control.csv.",
  args: {
    caso: z.string().describe("Carpeta del caso (ej. sol-001)"),
    payload: z.any().optional().describe("Payload de oc_construir_payload (opcional; se reconstruye desde fixtures)"),
    confirmado: z
      .boolean()
      .optional()
      .describe("true cuando el analista confirmó explícitamente las excepciones del caso"),
  },
  async execute(args, ctx) {
    const caso = String(args.caso ?? "");
    const confirmado = args.confirmado === true;
    try {
      const maestros = cargarMaestros(ctx.directory);
      const { paquete, cotizacionRef } = cargarPaquete(ctx.directory, caso);
      const resultado = validar(maestros, paquete);
      const solicitudId = paquete.solicitud.solicitud_id;
      const bloqueosTxt = resultado.bloqueos.map((b) => `${b.codigo}:${b.detalle}`);
      const confsTxt = resultado.confirmaciones.map((c) => `${c.codigo}:${c.detalle}`);

      // Bloqueos → no se crea.
      if (!resultado.apta) {
        registrarControl(ctx.directory, {
          solicitud_id: solicitudId,
          resultado: "bloqueada",
          numero_oc: "",
          retroactiva: resultado.retroactiva,
          bloqueos: bloqueosTxt,
          confirmaciones: confsTxt,
        });
        registrarLog(ctx.directory, {
          herramienta: "oc_crear",
          caso,
          ok: false,
          resumen: `bloqueada: ${resultado.bloqueos.map((b) => b.codigo).join(",")}`,
        });
        return err(
          `No se crea la OC: el caso tiene bloqueos. ${resultado.bloqueos
            .map((b) => `[${b.codigo}] ${b.detalle}`)
            .join(" ")}`,
        );
      }

      // Confirmaciones pendientes y no confirmado → no se crea.
      if (resultado.confirmaciones.length > 0 && !confirmado) {
        registrarControl(ctx.directory, {
          solicitud_id: solicitudId,
          resultado: "pendiente",
          numero_oc: "",
          retroactiva: resultado.retroactiva,
          bloqueos: bloqueosTxt,
          confirmaciones: confsTxt,
        });
        registrarLog(ctx.directory, {
          herramienta: "oc_crear",
          caso,
          ok: false,
          resumen: `pendiente de confirmación: ${resultado.confirmaciones.map((c) => c.codigo).join(",")}`,
        });
        return err(
          `requiere confirmación: ${resultado.confirmaciones
            .map((c) => `[${c.codigo}] ${c.detalle}`)
            .join(" ")}`,
        );
      }

      // Apta (y confirmada si aplica) → construir y crear.
      const evidencia = await generarEvidencia(ctx.directory, caso, paquete);
      const quienConfirma = confirmado ? `analista (sesión ${ctx.sessionId})` : null;
      const { payload } = construirPayload(
        ctx.directory,
        caso,
        maestros,
        paquete,
        resultado,
        evidencia.sha256,
        cotizacionRef,
        quienConfirma,
      );

      const sap = new SapMock(ctx.directory, maestros);
      const existente = await sap.buscarOrdenPorReferencia(solicitudId);
      const creada = await sap.crearOrden(payload);
      const idempotente = existente !== null;

      registrarControl(ctx.directory, {
        solicitud_id: solicitudId,
        resultado: idempotente ? "idempotente" : "creada",
        numero_oc: creada.numero_oc,
        retroactiva: resultado.retroactiva,
        bloqueos: bloqueosTxt,
        confirmaciones: confsTxt,
      });
      registrarLog(ctx.directory, {
        herramienta: "oc_crear",
        caso,
        ok: true,
        resumen: `${idempotente ? "idempotente" : "creada"} OC ${creada.numero_oc}`,
      });

      return ok({
        numero_oc: creada.numero_oc,
        fecha: creada.fecha,
        idempotente,
        retroactiva: resultado.retroactiva,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      registrarLog(ctx.directory, { herramienta: "oc_crear", caso, ok: false, resumen: msg });
      return err(`No se pudo crear la OC de "${caso}": ${msg}`);
    }
  },
};

// ---------------------------------------------------------------------------
// oc_leer_excel (P1 opcional)
// ---------------------------------------------------------------------------
export const leer_excel: Tool = {
  description:
    "P1 opcional: lee un .xlsx real de solicitud. En este reto las solicitudes vienen normalizadas como JSON, así que no es necesaria.",
  args: {
    ruta: z.string().describe("Ruta relativa al .xlsx dentro del proyecto"),
  },
  async execute() {
    return err(
      "no implementado: las solicitudes llegan normalizadas como solicitud.json (ver nota_fixture)",
    );
  },
};

// Registro de herramientas: el nombre que ve el modelo es oc_<clave>.
export const tools: Record<string, Tool> = {
  oc_leer_paquete: leer_paquete,
  oc_validar: validar_oc,
  oc_construir_payload: construir_payload,
  oc_generar_evidencia: generar_evidencia,
  oc_crear: crear,
  oc_leer_excel: leer_excel,
};
