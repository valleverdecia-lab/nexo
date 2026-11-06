# Plan de mejoras de conversión para Nexo

## Alcance

Añadir una experiencia de compra asistida que reduzca la incertidumbre después de explorar el catálogo: estimador de envío debajo de la vitrina, integración del destino en el carrito y en WhatsApp, llamada gratuita de 10 minutos para productos complejos, y mensajes de checkout más claros.

## Decisiones

- Mantener la identidad editorial oscura de Nexo; tomar de Stewart Prime la lógica funcional del estimador, no su marca, textos ni implementación.
- El estimador aparecerá inmediatamente debajo de los productos y antes de “Cómo funciona”.
- El estimador será transparente: distinguirá “Va por la casa”, “estimado” y “a confirmar”. No presentará como gratis una tarifa que no está confirmada.
- El cálculo será una estimación frontend configurable por municipio/zona; la confirmación humana por WhatsApp seguirá siendo obligatoria antes del pago.
- El carrito conservará el municipio seleccionado, mostrará subtotal + envío estimado y generará un mensaje de WhatsApp con el contexto completo.
- La llamada gratuita será opcional y se enfatizará especialmente para energía, vehículos, compras desde el exterior y productos de alto valor.
- No se añadirá todavía un chatbot con búsqueda web: necesita una fuente de datos autorizada, reglas de seguridad y un backend/LLM separado del sitio estático.
- No se publicará ninguna duración, promesa o texto de garantía o reembolso. Las especificaciones visibles excluyen cualquier campo de garantía.
- Se actualizará a 480 USD únicamente el precio de los sillones que coinciden con variantes y precios comprobados en Stewart Prime. No se inventarán equivalencias para productos que no coinciden.
- Después del título del estimador y antes del texto explicativo aparecerá un camión blanco de 64 px que recorre la línea, deja cajas caramelo de 32 px y reinicia el ciclo cuando las cajas desaparecen. Se respetará `prefers-reduced-motion`.
- La ficha de un sofá o sillón reclinable tendrá vista 3D/AR solo cuando exista un GLB válido y suficientemente fiel al artículo. El intento de generación del modelo exacto agotó el tiempo y no dejó archivo, así que la activación está deshabilitada para no presentar un visor roto. Una alternativa CC0 encontrada es un reclinable genérico, no el sofá de tres plazas; esperar la elección del usuario antes de publicarla como referencia.
- WhatsApp recibirá el contexto completo de productos, cantidades, precios, subtotal, municipio, estado del envío y solicitud de total final.
- La tienda sigue siendo un sitio estático de GitHub Pages. El último deploy de Actions terminó en éxito aunque el endpoint legacy del build reportó el error genérico “Page build failed”; los fallos del bot de Telegram son aparte y provienen de timeout de red hacia Telegram.

## Estructura

- `index.html`: sección de envío, animación, CTAs de llamada y ficha convencional del producto.
- `app.js`: reglas de zonas, cálculo estimado, ciclo del camión, especificaciones sin garantías e integración contextual de WhatsApp. La activación AR se añadirá con el GLB.
- `catalogo.js`: precios comprobados y datos de producto publicados.
- `style.css`: estimador, animación y diseño responsive. Se añadirá el estilo AR junto con el archivo 3D.
- `TODO.md`: criterios concretos y estado de entrega.

## Fuentes revisadas

- Precio publicado del sillón reclinable en tela y variantes relacionadas: [ficha de Stewart Prime](https://stewartprime.shop/producto/sillon-reclinable-marron), 480 USD.
- La documentación de [`model-viewer`](https://modelviewer.dev/docs/) indica que puede usar WebXR, Scene Viewer y Quick Look, y generar un USDZ al activar Quick Look cuando no se indica `ios-src`.
- Google describe el soporte AR y los requisitos de Android/WebXR en su [guía de ARCore](https://developers.google.com/ar/develop/webxr/model-viewer).
- Se localizó un sofá reclinable de tres plazas en Sketchfab con licencia CC BY, pero su descarga solicita inicio de sesión; Sketchfab indica que la RA propia de su visor requiere licencia Premium o Enterprise. [Modelo](https://sketchfab.com/3d-models/large-recliner-sofa-3-seats-cde832a05c9c4a25bedcaff733093b45) · [política de RA](https://sketchfab.com/blogs/enterprise/embedding-with-ar-activated/).
- Hay un modelo de sillón reclinable genérico bajo CC0, descargable, pero no corresponde al sofá publicado; no se usará sin avisar explícitamente que es una referencia aproximada. [Ficha CC0](https://www.innerscene.com/tools/library/3d-parts/patient-room-visitor-recliner-e5b5911b).
- Se consultó el [modelo de sofá de tres plazas CC0 de Innerscene](https://www.innerscene.com/tools/library/3d-parts/lowline-low-three-seat-sofa-4bb27e8c); no es reclinable, así que tampoco representa el artículo de Nexo.
- La ejecución previa de Pages terminó con éxito en [GitHub Actions](https://github.com/valleverdecia-lab/nexo/actions/runs/42226002292); el workflow independiente del bot tuvo un timeout al conectarse con Telegram.
