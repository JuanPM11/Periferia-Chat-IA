/**
 * Módulo reutilizable — herramientas de órdenes de compra.
 *
 * NO es una copia: reexporta exactamente las mismas herramientas que usa la
 * aplicación (src/tools/oc.ts), para que no haya divergencia. Cualquier
 * plataforma de agentes puede importar `tools` desde aquí sin el servidor HTTP.
 */
export { tools, type Tool, type ToolCtx } from "../../src/tools/oc.js";
export {
  leer_paquete,
  validar_oc,
  construir_payload,
  generar_evidencia,
  crear,
  leer_excel,
} from "../../src/tools/oc.js";
