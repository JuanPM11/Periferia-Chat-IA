import fs from "node:fs";
import path from "node:path";
import { SapAdapter } from "./adapter.js";
import { Maestros, OrdenCompra } from "../core/types.js";
import { sapDir } from "../core/paths.js";
import { normalizarNit } from "../core/text.js";

const PRIMER_NUMERO = 4500000001;

type FilaOrden = {
  numero_oc: string;
  fecha: string;
  solicitud_id: string;
  orden: OrdenCompra;
};

/** SAP simulado sobre archivos en out/sap/. Numeración secuencial e idempotente. */
export class SapMock implements SapAdapter {
  private readonly ordenesPath: string;

  constructor(
    private readonly directory: string,
    private readonly maestros: Maestros,
  ) {
    this.ordenesPath = path.join(sapDir(directory), "ordenes.jsonl");
  }

  /** Lee todas las órdenes persistidas en out/sap/ordenes.jsonl ([] si no existe). */
  private leerOrdenes(): FilaOrden[] {
    if (!fs.existsSync(this.ordenesPath)) return [];
    return fs
      .readFileSync(this.ordenesPath, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as FilaOrden);
  }

  /**
   * Consulta un proveedor por NIT (simula la consulta al maestro de SAP).
   * @returns  `{ codigo_sap, activo }` o `null` si no existe.
   */
  async consultarProveedor(
    nit: string,
  ): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const n = normalizarNit(nit);
    const p = this.maestros.proveedores.find((x) => normalizarNit(x.nit) === n);
    return p ? { codigo_sap: p.codigo_sap, activo: p.activo } : null;
  }

  /**
   * Busca si ya existe una OC para una solicitud (clave de idempotencia).
   * @returns  `{ numero_oc }` si ya se creó, o `null`.
   */
  async buscarOrdenPorReferencia(
    solicitud_id: string,
  ): Promise<{ numero_oc: string } | null> {
    const existente = this.leerOrdenes().find((o) => o.solicitud_id === solicitud_id);
    return existente ? { numero_oc: existente.numero_oc } : null;
  }

  /**
   * Crea una OC con número secuencial desde 4500000001 y la persiste.
   * Es idempotente: si ya hay OC para esa `solicitud_id`, devuelve la existente
   * sin crear una segunda.
   * @returns  `{ numero_oc, fecha }`.
   */
  async crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    const ordenes = this.leerOrdenes();
    // Idempotencia: si ya existe una OC para esa solicitud, se devuelve la misma.
    const existente = ordenes.find(
      (o) => o.solicitud_id === orden.referencia.solicitud_id,
    );
    if (existente) {
      return { numero_oc: existente.numero_oc, fecha: existente.fecha };
    }

    const maxNumero = ordenes.reduce(
      (max, o) => Math.max(max, Number(o.numero_oc)),
      PRIMER_NUMERO - 1,
    );
    const numero_oc = String(maxNumero + 1);
    const fecha = new Date().toISOString();

    fs.mkdirSync(sapDir(this.directory), { recursive: true });
    const fila: FilaOrden = {
      numero_oc,
      fecha,
      solicitud_id: orden.referencia.solicitud_id,
      orden,
    };
    fs.appendFileSync(this.ordenesPath, JSON.stringify(fila) + "\n", "utf8");
    return { numero_oc, fecha };
  }
}
