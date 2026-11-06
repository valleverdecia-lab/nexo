# TODO — Ajustes de confianza, mensajería y RA de Nexo

## Estimador de entrega debajo del catálogo

- [x] Mostrar el estimador inmediatamente después de la vitrina de productos.
- [x] Permitir elegir provincia/municipio o zona de entrega.
- [x] Mostrar “Va por la casa” solo para destinos configurados con costo cero, y diferenciarlo de los costos estimados y los que deben confirmarse por WhatsApp.
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

## Animación de mensajería

- [x] Después del título del cálculo de mensajería y antes de su explicación, mostrar un camión blanco de 64 px que recorre la línea, deja cajas color caramelo de 32 px, hace desaparecer las cajas al terminar y reinicia el ciclo.
- [x] Respetar `prefers-reduced-motion`.

## Vista 3D y realidad aumentada

- [ ] BLOQUEADO: añadir la vista 3D y RA después de contar con un GLB validado. La generación exacta expiró sin dejar archivo; opción pendiente de aprobación: usar un reclinable CC0 aproximado con un aviso visible o proveer un modelo fiel.
- [ ] Una vez añadido el modelo, permitir que los teléfonos compatibles lo coloquen mediante RA y explicar cómo ubicarlo sobre una superficie plana.
- [x] Mantener una alternativa de imagen y una presentación utilizable en dispositivos que no admitan RA.

## Diagnóstico y publicación

- [x] Distinguir los errores del workflow del bot de Telegram del flujo de publicación de GitHub Pages, comprobar el deploy reciente y publicar los cambios nuevos en la tienda.

## Calidad

- [x] Mantener accesibilidad básica: `label`, `aria-live`, foco y mensajes de error.
- [x] Mantener diseño responsive y la estética existente de Nexo.
- [x] Ejecutar comprobaciones de sintaxis y revisar el flujo en navegador y en el sitio publicado.
