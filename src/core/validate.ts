import {
  Maestros,
  Paquete,
  ResultadoValidacion,
  Bloqueo,
  Confirmacion,
  Derivados,
} from "./types.js";
import { resolverProveedor, resolverCentro, resolverAprobador } from "./resolver.js";
import { compararFechas, soloFecha } from "./text.js";

/** Deriva la unidad de medida a partir de la descripción (determinista). */
export function derivarUnidad(descripcion: string): "UN" | "H" | "MES" {
  const d = descripcion.toLowerCase();
  // "horas" como unidad de la cantidad (ej. "100 horas de arquitectura")
  if (/\bhoras?\b/.test(d)) return "H";
  // MES solo cuando la cantidad se mide en meses (suscripción mensual), no cuando
  // "meses" describe la vigencia de un producto contado en unidades (ej. "12 meses").
  if (/\bmensual(es)?\b/.test(d) || /\bpor mes\b/.test(d) || /\bmeses de servicio\b/.test(d)) {
    return "MES";
  }
  return "UN";
}

/**
 * Aplica las reglas de control RC1–RC10 (sección 7.3 del PRD).
 * No lanza: devuelve siempre un ResultadoValidacion.
 */
export function validar(
  maestros: Maestros,
  paquete: Paquete,
): ResultadoValidacion {
  const bloqueos: Bloqueo[] = [];
  const confirmaciones: Confirmacion[] = [];
  const derivados: Derivados = {};
  let retroactiva = false;

  const s = paquete.solicitud;
  const proveedor = resolverProveedor(maestros, s);
  const centro = resolverCentro(maestros, s.centro_costo);
  const aprobador = resolverAprobador(centro, paquete.aprobacion?.de);

  // RC1 — proveedor existe y está activo (Bloqueo)
  if (!proveedor) {
    bloqueos.push({
      codigo: "RC1",
      detalle: `Proveedor no encontrado en el maestro (NIT ${s.proveedor_nit ?? "—"} / nombre "${s.proveedor_nombre}").`,
    });
  } else if (!proveedor.activo) {
    bloqueos.push({
      codigo: "RC1",
      detalle: `Proveedor "${proveedor.nombre}" (${proveedor.codigo_sap}) está inactivo en el maestro.`,
    });
  } else {
    derivados.codigo_sap = proveedor.codigo_sap;
    derivados.proveedor_nit = proveedor.nit;
  }

  // RC2 — aprobación existe, contiene "Aprobado" y viene de un aprobador del centro (Bloqueo)
  if (!paquete.aprobacion) {
    bloqueos.push({ codigo: "RC2", detalle: "No hay correo de aprobación en el paquete." });
  } else {
    if (!paquete.aprobacion.aprobado) {
      bloqueos.push({
        codigo: "RC2",
        detalle: "El correo de aprobación no contiene la palabra 'Aprobado'.",
      });
    }
    if (!centro) {
      bloqueos.push({
        codigo: "RC2",
        detalle: `El centro de costo ${s.centro_costo} no existe en el maestro.`,
      });
    } else if (!aprobador) {
      bloqueos.push({
        codigo: "RC2",
        detalle: `El aprobador ${paquete.aprobacion.de} no está autorizado para el centro ${s.centro_costo} (${centro.nombre ?? ""}).`,
      });
    }
  }

  // RC3 — valor_total ≤ tope del aprobador (Bloqueo). Solo evaluable si hay aprobador válido.
  if (aprobador && s.valor_total > aprobador.tope) {
    bloqueos.push({
      codigo: "RC3",
      detalle: `El valor ${s.valor_total.toLocaleString("es-CO")} excede el tope del aprobador (${aprobador.tope.toLocaleString("es-CO")}).`,
    });
  }

  // RC4 — subárea pertenece al centro (Bloqueo)
  if (centro && !centro.subareas.includes(s.subarea)) {
    bloqueos.push({
      codigo: "RC4",
      detalle: `La subárea "${s.subarea}" no pertenece al centro ${s.centro_costo}. Válidas: ${centro.subareas.join(", ")}.`,
    });
  }

  // RC10 — cantidad × valor_unitario = valor_total (± 1) (Bloqueo)
  const calculado = s.cantidad * s.valor_unitario;
  if (Math.abs(calculado - s.valor_total) > 1) {
    bloqueos.push({
      codigo: "RC10",
      detalle: `Descuadre: cantidad×unitario = ${calculado.toLocaleString("es-CO")} ≠ valor_total ${s.valor_total.toLocaleString("es-CO")}.`,
    });
  }

  // RC5 — cotización vs solicitud ≤ 2% (Confirmación)
  if (!paquete.cotizacion) {
    confirmaciones.push({
      codigo: "RC5",
      detalle: "No hay cotización adjunta; confirmar que se procede sin ella.",
    });
  } else if (s.valor_total > 0) {
    const desvio = Math.abs(paquete.cotizacion.total - s.valor_total) / s.valor_total;
    if (desvio > 0.02) {
      confirmaciones.push({
        codigo: "RC5",
        detalle: `La cotización (${paquete.cotizacion.total.toLocaleString("es-CO")}) difiere de la solicitud (${s.valor_total.toLocaleString("es-CO")}) en ${(desvio * 100).toFixed(1)}% (> 2%).`,
      });
    }
  }

  // RC6 — indicador_iva ausente → derivar del proveedor + confirmación
  if (!s.indicador_iva) {
    const derivado = proveedor?.indicador_iva_default;
    if (derivado) {
      derivados.indicador_iva = derivado;
      confirmaciones.push({
        codigo: "RC6",
        detalle: `La solicitud no informa indicador de IVA; se derivó "${derivado}" del proveedor. Confirmar.`,
      });
    } else {
      confirmaciones.push({
        codigo: "RC6",
        detalle: "La solicitud no informa indicador de IVA y no se pudo derivar del proveedor.",
      });
    }
  }

  // RC7 — condiciones_pago ausente → derivar del proveedor (solo informa)
  if (!s.condiciones_pago) {
    const derivado = proveedor?.condiciones_pago_default;
    if (derivado) derivados.condiciones_pago = derivado;
  }

  // RC8 — factura con fecha < fecha_solicitud → retroactiva + confirmación
  if (paquete.factura && paquete.factura.fecha) {
    if (compararFechas(paquete.factura.fecha, s.fecha_solicitud) < 0) {
      retroactiva = true;
      confirmaciones.push({
        codigo: "RC8",
        detalle: `Compra retroactiva: la factura (${soloFecha(paquete.factura.fecha)}) es anterior a la solicitud (${s.fecha_solicitud}). Confirmar para crear y marcar.`,
      });
    }
  }

  // RC9 — fecha de aprobación ≥ fecha_solicitud (Confirmación)
  if (
    paquete.aprobacion?.fecha &&
    compararFechas(paquete.aprobacion.fecha, s.fecha_solicitud) < 0
  ) {
    confirmaciones.push({
      codigo: "RC9",
      detalle: `La aprobación (${soloFecha(paquete.aprobacion.fecha)}) es anterior a la solicitud (${s.fecha_solicitud}).`,
    });
  }

  // unidad derivada (para construir el payload)
  derivados.unidad = derivarUnidad(s.descripcion);

  return {
    apta: bloqueos.length === 0,
    bloqueos,
    confirmaciones,
    derivados,
    retroactiva,
  };
}
