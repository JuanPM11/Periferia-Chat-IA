import fs from "node:fs";
import path from "node:path";
import {
  Maestros,
  Paquete,
  OrdenCompra,
  OrdenCompraSchema,
  Derivados,
  Trazabilidad,
  ResultadoValidacion,
} from "./types.js";
import { resolverProveedor } from "./resolver.js";
import { outCasoDir } from "./paths.js";

/** Recorta un texto a `max` caracteres (SAP limita el texto breve de posición a 40). */
function recortar(texto: string, max: number): string {
  return texto.length <= max ? texto : texto.slice(0, max);
}

export type ConstruccionPayload = {
  payload: OrdenCompra;
  trazabilidad: Trazabilidad;
  rutaTrazabilidad: string;
};

/**
 * Construye el payload de la OC (sección 7.4), lo valida con zod y escribe la
 * trazabilidad fuente→valor en `out/<caso>/trazabilidad.json`. No crea la OC.
 *
 * @param directory        Raíz del proyecto.
 * @param caso             Carpeta del caso (ej. "sol-001").
 * @param maestros         Maestros de referencia.
 * @param paquete          Paquete normalizado del caso.
 * @param validacion       Resultado de `validar` (aporta derivados y excepciones).
 * @param evidenciaSha256  sha256 de la evidencia de aprobación (va en el payload).
 * @param cotizacionRef    Referencia de la cotización, o null.
 * @param confirmadoPor    Quién confirmó las excepciones (null si aún no se confirma).
 * @returns                `{ payload, trazabilidad, rutaTrazabilidad }`.
 * @throws                 Si no se resuelve el proveedor o el payload no cumple el esquema.
 */
export function construirPayload(
  directory: string,
  caso: string,
  maestros: Maestros,
  paquete: Paquete,
  validacion: ResultadoValidacion,
  evidenciaSha256: string,
  cotizacionRef: string | null,
  confirmadoPor: string | null = null,
): ConstruccionPayload {
  const s = paquete.solicitud;
  const proveedor = resolverProveedor(maestros, s);
  if (!proveedor) throw new Error("no se puede construir payload sin proveedor resuelto");

  const derivados: Derivados = validacion.derivados;
  const indicadorIva = s.indicador_iva ?? derivados.indicador_iva ?? "";
  const condicionesPago = s.condiciones_pago ?? derivados.condiciones_pago ?? "";
  const unidad = derivados.unidad ?? "UN";
  const moneda = (s.moneda === "USD" ? "USD" : "COP") as "COP" | "USD";

  const traza: Trazabilidad = {};
  /** Registra en la trazabilidad de dónde salió cada valor del payload. */
  const set = (clave: string, valor: unknown, fuente: Trazabilidad[string]["fuente"]) => {
    traza[clave] = { valor, fuente };
  };

  set("proveedor.codigo_sap", proveedor.codigo_sap, "maestro.proveedores");
  set("proveedor.nit", proveedor.nit, "maestro.proveedores");
  set("proveedor.nombre", proveedor.nombre, "maestro.proveedores");
  set("condiciones_pago", condicionesPago, s.condiciones_pago ? "solicitud" : "derivado");
  set("indicador_iva", indicadorIva, s.indicador_iva ? "solicitud" : "derivado");
  set("moneda", moneda, "solicitud");
  set("posicion.descripcion", recortar(s.descripcion, 40), "solicitud");
  set("posicion.cantidad", s.cantidad, "solicitud");
  set("posicion.unidad", unidad, "derivado");
  set("posicion.precio_unitario", s.valor_unitario, "solicitud");
  set("posicion.centro_costo", s.centro_costo, "solicitud");
  set("posicion.subarea", s.subarea, "solicitud");
  set("aprobador.email", paquete.aprobacion?.de ?? "", "solicitud");
  set("aprobador.evidencia_sha256", evidenciaSha256, "derivado");
  if (cotizacionRef) set("referencia.cotizacion_ref", cotizacionRef, "cotizacion");

  const excepciones = [
    ...validacion.bloqueos.map((b) => ({
      codigo: b.codigo,
      detalle: b.detalle,
      confirmado_por: null as string | null,
    })),
    ...validacion.confirmaciones.map((c) => ({
      codigo: c.codigo,
      detalle: c.detalle,
      confirmado_por: confirmadoPor,
    })),
  ];
  if (validacion.retroactiva) {
    excepciones.push({
      codigo: "RETROACTIVA",
      detalle: "OC creada después de recibida la factura.",
      confirmado_por: null,
    });
  }

  const payload: OrdenCompra = {
    referencia: {
      solicitud_id: s.solicitud_id,
      correo_id: paquete.correo.id,
      cotizacion_ref: cotizacionRef,
    },
    sociedad: "1000",
    organizacion_compras: "1000",
    proveedor: {
      codigo_sap: proveedor.codigo_sap,
      nit: proveedor.nit,
      nombre: proveedor.nombre,
    },
    moneda,
    condiciones_pago: condicionesPago,
    aprobador: {
      email: paquete.aprobacion?.de ?? "",
      fecha_aprobacion: paquete.aprobacion?.fecha ?? "",
      evidencia_sha256: evidenciaSha256,
    },
    posiciones: [
      {
        numero: 10,
        descripcion: recortar(s.descripcion, 40),
        cantidad: s.cantidad,
        unidad,
        precio_unitario: s.valor_unitario,
        centro_costo: s.centro_costo,
        subarea: s.subarea,
        indicador_iva: indicadorIva,
      },
    ],
    excepciones,
  };

  // Validación estricta contra el esquema zod (HU-3).
  const parsed = OrdenCompraSchema.parse(payload);

  const dir = outCasoDir(directory, caso);
  fs.mkdirSync(dir, { recursive: true });
  const rutaTrazabilidad = path.join(dir, "trazabilidad.json");
  fs.writeFileSync(rutaTrazabilidad, JSON.stringify(traza, null, 2), "utf8");

  return { payload: parsed, trazabilidad: traza, rutaTrazabilidad };
}
