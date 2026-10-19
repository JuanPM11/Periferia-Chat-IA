# Conocimiento del proceso — Órdenes de compra

Este documento es el conocimiento del dominio que el agente consulta. No contiene
valores de los casos (esos salen de las herramientas), solo las reglas del proceso.

## El paquete de compra

Cada compra llega por correo con tres piezas (y a veces una cuarta):

- **solicitud**: qué se compra, proveedor, centro de costo, subárea, cantidad,
  valor unitario y total, moneda, y opcionalmente indicador de IVA y condiciones de
  pago.
- **cotización**: la oferta del proveedor (texto). De aquí sale el total cotizado.
- **aprobación**: el correo del líder. Debe decir "Aprobado".
- **factura** (solo a veces): si existe y es anterior a la solicitud, la compra es
  **retroactiva** (la OC se está creando después de la factura: desvío de proceso).

## Maestros de referencia

- **proveedores**: código SAP, NIT, nombre, condiciones de pago e indicador de IVA
  por defecto, y si está `activo`.
- **centros de costo**: subáreas válidas y la lista de aprobadores con su `tope`.
- **indicadores de IVA**: C0 (0%), C1 (19%), C2 (5%).
- **condiciones de pago**: Z000 (contado) … Z060 (60 días).

## Matriz de controles (RC1–RC10)

**Bloqueos** (impiden crear la OC):

- **RC1** El proveedor debe existir en el maestro (por NIT; si no hay NIT, por
  nombre normalizado) y estar activo.
- **RC2** La aprobación debe existir, contener "Aprobado" y venir de un correo que
  figure como aprobador del centro de costo de la solicitud.
- **RC3** El valor total no puede superar el tope del aprobador para ese centro.
- **RC4** La subárea debe pertenecer al centro de costo.
- **RC10** cantidad × valor_unitario debe igualar el valor_total (± 1).

**Confirmaciones** (permiten crear solo con confirmación explícita):

- **RC5** Si la cotización difiere de la solicitud en más de 2 %, o no hay
  cotización, se confirma mostrando ambos valores.
- **RC6** Si falta el indicador de IVA, se deriva del proveedor y se confirma.
- **RC8** Si hay factura anterior a la solicitud → retroactiva; se confirma y se
  marca en el control.
- **RC9** Si la fecha de aprobación es anterior a la solicitud, se confirma.

**Derivados** (se completan desde maestros y solo se informan):

- **RC7** Si faltan las condiciones de pago, se toman las del proveedor.

## Cierre humano

El agente nunca crea una OC con bloqueos, ni con confirmaciones pendientes sin que
la analista confirme. Toda OC creada deja evidencia de aprobación (txt + sha256,
PDF si es posible), trazabilidad fuente→valor y una fila en el log de control.
