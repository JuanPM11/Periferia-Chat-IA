import {
  Maestros,
  Proveedor,
  CentroCosto,
  Aprobador,
  Solicitud,
} from "./types.js";
import { normalizarNit, normalizarNombre } from "./text.js";

/** Resuelve el proveedor por NIT normalizado; si no hay NIT, por nombre normalizado. */
export function resolverProveedor(
  maestros: Maestros,
  solicitud: Solicitud,
): Proveedor | null {
  const nit = normalizarNit(solicitud.proveedor_nit);
  if (nit) {
    const porNit = maestros.proveedores.find((p) => normalizarNit(p.nit) === nit);
    if (porNit) return porNit;
  }
  const nombre = normalizarNombre(solicitud.proveedor_nombre);
  return (
    maestros.proveedores.find((p) => normalizarNombre(p.nombre) === nombre) ?? null
  );
}

export function resolverCentro(
  maestros: Maestros,
  centroCosto: string,
): CentroCosto | null {
  return maestros.centrosCosto.find((c) => c.centro_costo === centroCosto) ?? null;
}

/** Devuelve el aprobador (del centro) cuyo email coincide con el emisor de la aprobación. */
export function resolverAprobador(
  centro: CentroCosto | null,
  emailAprobador: string | null | undefined,
): Aprobador | null {
  if (!centro || !emailAprobador) return null;
  const email = emailAprobador.trim().toLowerCase();
  return centro.aprobadores.find((a) => a.email.toLowerCase() === email) ?? null;
}
