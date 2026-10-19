import fs from "node:fs";
import path from "node:path";
import {
  Maestros,
  Paquete,
  PaqueteSchema,
  ProveedorSchema,
  CentroCostoSchema,
  IndicadorIvaSchema,
  CondicionPagoSchema,
  SolicitudSchema,
} from "./types.js";
import { casoDir, maestrosDir } from "./paths.js";
import { normalizarNit, parsearMontoCOP, soloFecha } from "./text.js";

/** Lee y parsea un archivo JSON. Lanza si no existe o es inválido (lo captura el caller). */
function leerJson(ruta: string): unknown {
  const txt = fs.readFileSync(ruta, "utf8");
  return JSON.parse(txt);
}

/**
 * Carga y valida (con zod) los cuatro maestros de referencia.
 * @param directory  Raíz del proyecto.
 * @returns          Los maestros tipados; lanza si algún archivo no cumple el esquema.
 */
export function cargarMaestros(directory: string): Maestros {
  const dir = maestrosDir(directory);
  return {
    proveedores: ProveedorSchema.array().parse(
      leerJson(path.join(dir, "proveedores.json")),
    ),
    centrosCosto: CentroCostoSchema.array().parse(
      leerJson(path.join(dir, "centros-costo.json")),
    ),
    indicadoresIva: IndicadorIvaSchema.array().parse(
      leerJson(path.join(dir, "indicadores-iva.json")),
    ),
    condicionesPago: CondicionPagoSchema.array().parse(
      leerJson(path.join(dir, "condiciones-pago.json")),
    ),
  };
}

/**
 * Convierte el texto libre de una cotización en campos estructurados.
 * Extrae proveedor, NIT (normalizado), total "IVA incluido", moneda y referencia.
 * @param texto  Contenido de cotizacion.txt.
 * @returns      Objeto cotización (con `ref` auxiliar) listo para el Paquete.
 */
function parsearCotizacion(texto: string): Paquete["cotizacion"] {
  const proveedor =
    texto.match(/Proveedor:\s*(.+)/i)?.[1]?.trim() ?? "";
  const nitMatch = texto.match(/NIT:\s*([\d.\-]+)/i)?.[1] ?? null;
  // "TOTAL (IVA incluido): COP 11.400.000" o "TOTAL: COP ..."
  const totalLinea =
    texto.match(/TOTAL[^\n:]*:\s*([A-Z]{0,3}\s*[\d.,]+)/i)?.[1] ?? null;
  const monedaMatch = texto.match(/\b(COP|USD)\b/)?.[1] ?? "COP";
  const total = totalLinea ? parsearMontoCOP(totalLinea) : null;
  const ref = texto.match(/COTIZACI[ÓO]N\s+([A-Z0-9\-]+)/i)?.[1] ?? null;
  return {
    proveedor,
    nit: normalizarNit(nitMatch),
    total: total ?? 0,
    moneda: monedaMatch,
    validez_hasta: null, // el fixture expresa validez en días, no como fecha
    texto,
    // cotizacion_ref va en el payload; lo guardamos informalmente en texto si hace falta
    ...(ref ? { ref } : {}),
  } as Paquete["cotizacion"] & { ref?: string };
}

/**
 * Convierte el texto libre de una factura en campos estructurados.
 * Solo aparece en el caso retroactivo (sol-005). Extrae número, fecha y total.
 * @param texto  Contenido de factura.txt.
 * @returns      Objeto factura para el Paquete.
 */
function parsearFactura(texto: string): Paquete["factura"] {
  const numero =
    texto.match(/No\.?\s*([A-Z0-9\-]+)/i)?.[1] ??
    texto.match(/FACTURA[^\n]*?([A-Z]{1,3}-?\d+)/i)?.[1] ??
    "SIN-NUMERO";
  const fechaRaw =
    texto.match(/Fecha de emisi[óo]n:\s*([\d\-/]+)/i)?.[1] ??
    texto.match(/Fecha:\s*([\d\-/]+)/i)?.[1] ??
    null;
  const totalLinea = texto.match(/TOTAL[^\n:]*:\s*([A-Z]{0,3}\s*[\d.,]+)/i)?.[1] ?? null;
  return {
    numero,
    fecha: fechaRaw ? soloFecha(fechaRaw.replace(/\//g, "-")) : "",
    total: totalLinea ? parsearMontoCOP(totalLinea) ?? 0 : 0,
  };
}

export type CargaPaquete = {
  paquete: Paquete;
  cotizacionRef: string | null;
};

/**
 * Lee la carpeta de un caso y la normaliza al Paquete de la sección 7.2 del PRD.
 *
 * Contrato:
 * - Un adjunto ausente (cotización, factura) queda como `null`, no lanza.
 * - La aprobación marca `aprobado` según contenga o no la palabra "Aprobado".
 * - Valida el resultado con `PaqueteSchema` (zod).
 * @param directory  Raíz del proyecto.
 * @param caso       Carpeta del caso (ej. "sol-001").
 * @returns          `{ paquete, cotizacionRef }`.
 * @throws           Si el caso no existe o la solicitud no cumple el esquema.
 */
export function cargarPaquete(directory: string, caso: string): CargaPaquete {
  const dir = casoDir(directory, caso);
  if (!fs.existsSync(dir)) {
    throw new Error(`caso inexistente: ${caso}`);
  }

  const correoRaw = leerJson(path.join(dir, "correo.json")) as Record<string, unknown>;
  const solicitud = SolicitudSchema.parse(
    leerJson(path.join(dir, "solicitud.json")),
  );

  const cotizacionPath = path.join(dir, "cotizacion.txt");
  let cotizacion: Paquete["cotizacion"] = null;
  let cotizacionRef: string | null = null;
  if (fs.existsSync(cotizacionPath)) {
    const texto = fs.readFileSync(cotizacionPath, "utf8");
    const parsed = parsearCotizacion(texto) as (Paquete["cotizacion"] & { ref?: string }) | null;
    if (parsed) {
      cotizacionRef = parsed.ref ?? null;
      const { ref: _ref, ...rest } = parsed as Record<string, unknown>;
      cotizacion = rest as Paquete["cotizacion"];
    }
  }

  const aprobacionPath = path.join(dir, "aprobacion.json");
  let aprobacion: Paquete["aprobacion"] = null;
  if (fs.existsSync(aprobacionPath)) {
    const a = leerJson(aprobacionPath) as Record<string, string>;
    const cuerpo = a.cuerpo ?? "";
    aprobacion = {
      de: a.de ?? "",
      fecha: a.fecha ?? "",
      aprobado: /\baprobad[oa]\b/i.test(cuerpo),
      texto: cuerpo,
    };
  }

  const facturaPath = path.join(dir, "factura.txt");
  let factura: Paquete["factura"] = null;
  if (fs.existsSync(facturaPath)) {
    factura = parsearFactura(fs.readFileSync(facturaPath, "utf8"));
  }

  const paquete = PaqueteSchema.parse({
    correo: {
      id: String(correoRaw.id ?? caso),
      de: String(correoRaw.de ?? ""),
      asunto: String(correoRaw.asunto ?? ""),
      fecha: String(correoRaw.fecha ?? ""),
    },
    solicitud,
    cotizacion,
    aprobacion,
    factura,
  });

  return { paquete, cotizacionRef };
}
