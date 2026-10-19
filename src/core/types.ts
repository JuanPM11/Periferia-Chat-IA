import { z } from "zod";

// ---------------------------------------------------------------------------
// Maestros (fixtures/reto-03/maestros/*)
// ---------------------------------------------------------------------------

export const ProveedorSchema = z.object({
  codigo_sap: z.string(),
  nit: z.string(),
  nombre: z.string(),
  condiciones_pago_default: z.string(),
  indicador_iva_default: z.string(),
  activo: z.boolean(),
});
export type Proveedor = z.infer<typeof ProveedorSchema>;

export const AprobadorSchema = z.object({
  email: z.string(),
  nombre: z.string().optional(),
  tope: z.number(),
});
export type Aprobador = z.infer<typeof AprobadorSchema>;

export const CentroCostoSchema = z.object({
  centro_costo: z.string(),
  nombre: z.string().optional(),
  subareas: z.array(z.string()),
  aprobadores: z.array(AprobadorSchema),
});
export type CentroCosto = z.infer<typeof CentroCostoSchema>;

export const IndicadorIvaSchema = z.object({
  codigo: z.string(),
  descripcion: z.string(),
  tasa: z.number(),
});
export type IndicadorIva = z.infer<typeof IndicadorIvaSchema>;

export const CondicionPagoSchema = z.object({
  codigo: z.string(),
  descripcion: z.string(),
  dias: z.number(),
});
export type CondicionPago = z.infer<typeof CondicionPagoSchema>;

export type Maestros = {
  proveedores: Proveedor[];
  centrosCosto: CentroCosto[];
  indicadoresIva: IndicadorIva[];
  condicionesPago: CondicionPago[];
};

// ---------------------------------------------------------------------------
// Entrada normalizada (fixtures/reto-03/solicitudes/<caso>/*)
// ---------------------------------------------------------------------------

export const SolicitudSchema = z.object({
  solicitud_id: z.string(),
  solicitante: z.string(),
  proveedor_nombre: z.string(),
  proveedor_nit: z.string().optional(),
  descripcion: z.string(),
  centro_costo: z.string(),
  subarea: z.string(),
  cantidad: z.number(),
  valor_unitario: z.number(),
  valor_total: z.number(),
  moneda: z.string(),
  indicador_iva: z.string().optional(),
  condiciones_pago: z.string().optional(),
  fecha_solicitud: z.string(),
});
export type Solicitud = z.infer<typeof SolicitudSchema>;

// Paquete normalizado — sección 7.2 del PRD
export const PaqueteSchema = z.object({
  correo: z.object({
    id: z.string(),
    de: z.string(),
    asunto: z.string(),
    fecha: z.string(),
  }),
  solicitud: SolicitudSchema,
  cotizacion: z
    .object({
      proveedor: z.string(),
      nit: z.string().nullable(),
      total: z.number(),
      moneda: z.string(),
      validez_hasta: z.string().nullable(),
      texto: z.string(),
    })
    .nullable(),
  aprobacion: z
    .object({
      de: z.string(),
      fecha: z.string(),
      aprobado: z.boolean(),
      texto: z.string(),
    })
    .nullable(),
  factura: z
    .object({
      numero: z.string(),
      fecha: z.string(),
      total: z.number(),
    })
    .nullable(),
});
export type Paquete = z.infer<typeof PaqueteSchema>;

// ---------------------------------------------------------------------------
// Resultado de validación — sección 7.3
// ---------------------------------------------------------------------------

export type Bloqueo = { codigo: string; detalle: string };
export type Confirmacion = { codigo: string; detalle: string };

export type Derivados = {
  codigo_sap?: string;
  proveedor_nit?: string;
  indicador_iva?: string;
  condiciones_pago?: string;
  unidad?: "UN" | "H" | "MES";
};

export type ResultadoValidacion = {
  apta: boolean;
  bloqueos: Bloqueo[];
  confirmaciones: Confirmacion[];
  derivados: Derivados;
  retroactiva: boolean;
};

// ---------------------------------------------------------------------------
// Payload de la OC — sección 7.4
// ---------------------------------------------------------------------------

export const PosicionSchema = z.object({
  numero: z.number().int().positive(),
  descripcion: z.string().max(40),
  cantidad: z.number(),
  unidad: z.enum(["UN", "H", "MES"]),
  precio_unitario: z.number(),
  centro_costo: z.string(),
  subarea: z.string(),
  indicador_iva: z.string(),
});

export const OrdenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: z.string(),
    correo_id: z.string(),
    cotizacion_ref: z.string().nullable(),
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({
    codigo_sap: z.string(),
    nit: z.string(),
    nombre: z.string(),
  }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string(),
  aprobador: z.object({
    email: z.string(),
    fecha_aprobacion: z.string(),
    evidencia_sha256: z.string(),
  }),
  posiciones: z.array(PosicionSchema).min(1),
  excepciones: z.array(
    z.object({
      codigo: z.string(),
      detalle: z.string(),
      confirmado_por: z.string().nullable(),
    }),
  ),
});
export type OrdenCompra = z.infer<typeof OrdenCompraSchema>;

// Trazabilidad: cada valor del payload → su fuente
export type FuenteTraza =
  | "solicitud"
  | "cotizacion"
  | "derivado"
  | `maestro.${string}`;
export type Trazabilidad = Record<string, { valor: unknown; fuente: FuenteTraza }>;

// Resultado tipado estándar de toda herramienta
export type ToolResult<T> = { ok: true; data: T } | { ok: false; error: string };
