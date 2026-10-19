import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Paquete } from "./types.js";
import { outCasoDir } from "./paths.js";

export type Evidencia = { ruta: string; rutaPdf: string | null; sha256: string };

/**
 * Genera la evidencia de aprobación.
 * P0: aprobacion.txt con encabezados + cuerpo y su sha256 (contenido determinista).
 * P1: aprobacion.pdf con el mismo contenido.
 */
export async function generarEvidencia(
  directory: string,
  caso: string,
  paquete: Paquete,
): Promise<Evidencia> {
  if (!paquete.aprobacion) {
    throw new Error("no hay aprobación para generar evidencia");
  }
  const a = paquete.aprobacion;
  const contenido = [
    `De: ${a.de}`,
    `Para: ${paquete.correo.de}`,
    `Fecha: ${a.fecha}`,
    `Asunto: Evidencia de aprobación — ${paquete.solicitud.solicitud_id}`,
    "",
    a.texto,
    "",
  ].join("\n");

  // El sha256 se calcula SOBRE el contenido (sin timestamps externos) → determinista.
  const sha256 = crypto.createHash("sha256").update(contenido, "utf8").digest("hex");

  const dir = outCasoDir(directory, caso);
  fs.mkdirSync(dir, { recursive: true });
  const ruta = path.join(dir, "aprobacion.txt");
  fs.writeFileSync(ruta, contenido + `SHA256: ${sha256}\n`, "utf8");

  let rutaPdf: string | null = null;
  try {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Courier);
    const page = pdf.addPage([595, 842]); // A4
    const size = 10;
    let y = 800;
    for (const linea of (contenido + `SHA256: ${sha256}`).split("\n")) {
      page.drawText(linea.slice(0, 95), { x: 40, y, size, font });
      y -= size + 4;
      if (y < 40) {
        y = 800;
        pdf.addPage([595, 842]);
      }
    }
    const bytes = await pdf.save();
    rutaPdf = path.join(dir, "aprobacion.pdf");
    fs.writeFileSync(rutaPdf, bytes);
  } catch {
    // Si pdf-lib no está disponible, el P0 (txt + sha256) sigue cumpliéndose.
    rutaPdf = null;
  }

  return { ruta, rutaPdf, sha256 };
}
