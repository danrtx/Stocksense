/**
 * HU-30 (T-30.2): ayuda corta de cada pantalla principal, con un ejemplo concreto.
 * La clave es la ruta; para una ruta con parámetros (/productos/:id) se usa el prefijo.
 */
export interface PageHelpText {
  title: string
  text: string
  example: string
}

export const PAGE_HELP: Record<string, PageHelpText> = {
  '/': {
    title: 'El panel',
    text: 'Resume tu trabajo del día: unidades y valor en bodega, lo que está bajo el punto de reorden y lo que conviene reponer primero. Filtra por bodega o categoría arriba a la derecha.',
    example: 'Si «Bajo punto de reorden» dice 6, pulsa «Ver productos» para ver cuáles son y pedirlos.',
  },
  '/productos': {
    title: 'Productos',
    text: 'El catálogo: SKU, nombre, categoría, unidad, costo y punto de reorden. Busca por nombre o SKU y abre un producto para ver su stock, su kardex y su pronóstico.',
    example: 'Escribe «CEM» en el buscador para encontrar el cemento gris de 50 kg.',
  },
  '/productos/importar': {
    title: 'Importar productos',
    text: 'Carga muchos productos a la vez desde un CSV. Antes de guardar se muestra qué filas tienen errores y por qué.',
    example: 'Descarga la plantilla, llena una fila por producto y súbela; si un SKU ya existe, se actualiza.',
  },
  '/productos/:id': {
    title: 'Ficha del producto',
    text: 'Todo sobre un producto: stock por bodega, movimientos con su saldo, proveedores y el pronóstico de las próximas semanas.',
    example: 'En «Pronóstico» ves cuántas unidades se esperan vender en las próximas 4 semanas.',
  },
  '/inventario': {
    title: 'Inventario',
    text: 'Cuánto hay de cada producto en cada bodega, lo que va en camino y su estado frente al punto de reorden.',
    example: 'Elige «Bajo punto de reorden» en el filtro de estado para ver solo lo que hay que pedir.',
  },
  '/inventario/registrar': {
    title: 'Registrar una entrada o salida',
    text: 'Responde las preguntas: qué pasó, qué producto, cuántos y en qué bodega. El comprobante de la derecha muestra cómo queda el stock antes de guardar.',
    example: 'Llegaron 20 bultos de cemento: «Entrada», busca «cemento», escribe 20 y elige «Compra local».',
  },
  '/inventario/movimientos': {
    title: 'Movimientos',
    text: 'El historial de entradas, salidas, ajustes y transferencias, con quién lo hizo y el saldo que dejó.',
    example: 'Filtra por producto y fecha para encontrar quién sacó las 3 brochas el martes.',
  },
  '/inventario/transferencias': {
    title: 'Transferencias entre bodegas',
    text: 'Mueve stock de una bodega a otra. Mientras va en camino aparece como «en camino» y el total no cambia; la bodega de destino confirma al recibir.',
    example: 'Envía 10 tejas de la Bodega principal al Punto de venta Sur y pide que lo confirmen al llegar.',
  },
  '/inventario/conteos': {
    title: 'Conteos físicos',
    text: 'Cuenta lo que hay en un estante y compáralo con el sistema. La persona administradora aprueba las diferencias y se ajusta el stock.',
    example: 'Pulsa «Iniciar conteo» para la Bodega Norte, escribe lo que contaste y envíalo a revisión.',
  },
  '/inventario/bodegas': {
    title: 'Bodegas',
    text: 'Las bodegas y puntos de venta del negocio. La bodega principal es la que se usa por defecto.',
    example: 'Crea «Punto de venta Sur» para llevar su stock por separado.',
  },
  '/compras': {
    title: 'Órdenes de compra',
    text: 'Pedidos a proveedores: borrador, enviada, recibida en parte o recibida. Al recibir, el stock sube solo.',
    example: 'Abre una orden enviada y pulsa «Recibir mercancía» cuando llegue; si llega una parte, recibe solo esa parte.',
  },
  '/compras/ordenes/nueva': {
    title: 'Nueva orden de compra',
    text: 'Elige el proveedor, agrega los productos con su cantidad y costo, y guárdala como borrador o envíala.',
    example: 'Pide 40 bultos de cemento a Materiales y Agregados Galeras para el próximo martes.',
  },
  '/compras/sugerencias': {
    title: 'Sugerencias de compra',
    text: 'Qué pedir hoy y cuánto, según el pronóstico, el tiempo de entrega de cada proveedor y lo que ya está pedido.',
    example: 'En el grupo de un proveedor, pulsa «Crear borrador con todas» para dejar lista la orden de lo que hay que pedir hoy.',
  },
  '/compras/proveedores': {
    title: 'Proveedores',
    text: 'Datos de contacto, tiempo de entrega real (medido en cada recepción) y los productos que surte cada proveedor.',
    example: 'Abre un proveedor para ver si sus entregas llegan a tiempo.',
  },
  '/ventas': {
    title: 'Ventas',
    text: 'El historial de ventas que alimenta el pronóstico. Se carga con un CSV o llega solo desde el punto de venta con una clave de API.',
    example: 'Sube el CSV de ventas de la semana; el sistema avisa qué filas no pudo leer.',
  },
  '/pronostico': {
    title: 'Pronóstico de demanda',
    text: 'Cuánto se espera vender de cada producto en las próximas semanas, con un rango de lo probable. Se recalcula solo cada semana.',
    example: 'Ordena por «Mayor cambio primero» para ver qué productos van a vender mucho más que antes.',
  },
  '/pronostico/precision': {
    title: 'Precisión del pronóstico',
    text: 'Qué tanto acierta el modelo, comparado con lo que de verdad se vendió, y qué productos conviene revisar.',
    example: 'Una precisión de 85 % quiere decir que, en promedio, el error fue de 15 % de lo vendido.',
  },
  '/alertas': {
    title: 'Alertas de stock',
    text: 'Productos que bajaron de su punto de reorden. Marca una alerta como vista cuando ya hiciste el pedido; se cierra sola cuando el stock se recupera.',
    example: 'Pulsa «Crear orden» en una alerta para pedir ese producto a su proveedor.',
  },
  '/reportes': {
    title: 'Reportes',
    text: 'Stock valorizado, movimientos, rotación y precisión del pronóstico, con los filtros que elijas. Se descargan en Excel o PDF con la fecha y quién los generó.',
    example: 'Elige «Rotación», filtra por categoría «Pinturas» y descarga el Excel.',
  },
  '/reportes/anomalias': {
    title: 'Anomalías',
    text: 'Ventas o mermas fuera de lo normal en las últimas semanas. Pide posibles causas, investiga y márcala como explicada o ignórala.',
    example: 'Si el chazo plástico vendió 30 veces lo normal un día, puede ser un error al digitar la venta.',
  },
  '/preguntar': {
    title: 'Preguntar al inventario',
    text: 'Escribe una pregunta sobre tus datos y te respondo con cifras de este momento, mostrando de dónde salen. Solo consulto: no cambio nada.',
    example: '«¿Qué productos se agotan este mes?» o «¿Cuánto cemento hay en la Bodega Norte?»',
  },
  '/usuarios': {
    title: 'Usuarios',
    text: 'Invita personas, asígnales un rol y desactívalas cuando ya no trabajen en el negocio. Cada rol ve solo lo que necesita.',
    example: 'Invita a la persona de bodega con el rol «Bodega»: podrá registrar movimientos, pero no verá costos.',
  },
  '/auditoria': {
    title: 'Auditoría',
    text: 'Quién hizo qué y cuándo: cambios de productos, movimientos, órdenes, aprobaciones y accesos.',
    example: 'Filtra por «Orden de compra» para ver quién recibió la OC-000102.',
  },
  '/configuracion/ia': {
    title: 'Configuración de IA',
    text: 'Ajustes del pronóstico, del asistente y de Gemini, el consumo del mes y las versiones del modelo propio.',
    example: 'Sube el umbral de confianza si quieres que el asistente responda solo cuando está muy seguro.',
  },
  '/configuracion/asistente': {
    title: 'Aprendizaje del asistente',
    text: 'Qué resuelve el modelo propio, qué necesita a Gemini y qué quedó sin respuesta. Aprueba ejemplos para que aprenda.',
    example: 'Aprueba «necesito mandar cajas al punto del sur» como ejemplo de «Transferir stock».',
  },
}

/** La ayuda de una ruta: exacta, o la de su ruta con parámetros (/productos/123 → /productos/:id). */
export function helpFor(pathname: string): PageHelpText | undefined {
  const clean = pathname.replace(/\/$/, '') || '/'
  if (PAGE_HELP[clean]) return PAGE_HELP[clean]
  const parts = clean.split('/')
  for (const key of Object.keys(PAGE_HELP)) {
    const k = key.split('/')
    if (k.length === parts.length && k.every((seg, i) => seg.startsWith(':') || seg === parts[i])) return PAGE_HELP[key]
  }
  return undefined
}
