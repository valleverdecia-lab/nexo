# TODO — Envíos, sugerencias y disponibilidad de Nexo

## Estimador de entrega debajo del catálogo

- [x] Mostrar el estimador inmediatamente después de la vitrina de productos.
- [x] Permitir elegir provincia/municipio o zona de entrega.
- [x] Convertir los destinos que muestran “A confirmar” en “Va por la casa”, según la instrucción del propietario, y reflejar el costo cero en el carrito y el mensaje de WhatsApp.
- [x] Explicar que el precio final se confirma por WhatsApp antes de pagar.
- [x] Conservar el destino en `localStorage` durante la visita.

## Carrito y WhatsApp

- [x] Mostrar el destino y el envío estimado dentro del carrito.
- [x] Incluir productos, subtotal, destino, envío y total estimado en el mensaje de WhatsApp.
- [x] Mantener el flujo actual de cantidad, eliminación y persistencia del carrito.
- [x] Añadir un CTA para solicitar llamada gratuita de 10 minutos desde el carrito.

## Fichas de producto

- [x] Mostrar la llamada gratuita como opción, no como requisito, en fichas de productos complejos o caros.
- [x] Generar un mensaje de WhatsApp con producto, precio, destino y solicitud de llamada.

## Texto comercial y precios comprobados

- [x] No mostrar garantías, plazos, reembolsos ni cobertura de garantía en fichas, especificaciones, categorías, mensajes de WhatsApp o textos promocionales.
- [x] Revisar Stewart Prime y actualizar a 480 USD solamente las variantes de sillón que coinciden con el catálogo de Nexo y tienen precio publicado; no asignar precios sin equivalencia verificable.

## Sugerencias al abrir una ficha

- [x] Al final de cada ficha, después de las acciones de añadir al carrito y WhatsApp/llamada, mostrar cuatro productos distintos con imagen, nombre y precio.
- [x] Priorizar artículos de la misma categoría; no sugerir el artículo abierto ni productos agotados.
- [x] Al pulsar una sugerencia, abrir su propia ficha de producto.

## Productos agotados

- [x] No permitir agregar productos marcados “Agotado” desde las tarjetas del catálogo ni desde la ficha del producto.
- [x] No permitir aumentar la cantidad de un producto agotado desde los controles del carrito.

## Animación de mensajería

- [x] Después del título del cálculo de mensajería y antes de su explicación, mover el camión blanco de 64 px por toda la línea hasta el final, dejar cajas color caramelo de 32 px a su paso, hacerlas desaparecer y reiniciar el ciclo.
- [x] Respetar `prefers-reduced-motion`.

## Diagnóstico y publicación

- [x] Distinguir los errores del workflow del bot de Telegram del flujo de publicación de GitHub Pages, comprobar el deploy reciente y publicar los cambios nuevos en la tienda.

## Calidad

- [x] Mantener accesibilidad básica: `label`, `aria-live`, foco y mensajes de error.
- [x] Mantener diseño responsive y la estética existente de Nexo.
- [x] Ejecutar comprobaciones de sintaxis y revisar el flujo en navegador y en el sitio publicado.
