# Plan de mejoras de conversión para Nexo

## Alcance

Añadir una experiencia de compra asistida que reduzca la incertidumbre después de explorar el catálogo: estimador de envío debajo de la vitrina, integración del destino en el carrito y WhatsApp, cuatro sugerencias relacionadas al final de cada ficha, bloqueo de productos agotados y una animación de entrega fluida.

## Decisiones

- Mantener la identidad editorial oscura de Nexo; tomar de Stewart Prime la lógica funcional del estimador, no su marca, textos ni implementación.
- El estimador aparecerá inmediatamente debajo de los productos y antes de “Cómo funciona”.
- Según la instrucción del propietario, todos los destinos que estaban marcados “A confirmar” se tratarán como envío sin costo y mostrarán “Va por la casa”; destinos con tarifa publicada mantienen su estimado.
- El cálculo será una estimación frontend configurable por municipio/zona; la confirmación humana por WhatsApp seguirá siendo obligatoria antes del pago.
- El carrito conservará el municipio seleccionado, mostrará subtotal + envío estimado y generará un mensaje de WhatsApp con el contexto completo.
- La llamada gratuita será opcional y se enfatizará especialmente para energía, vehículos, compras desde el exterior y productos de alto valor.
- No se añadirá todavía un chatbot con búsqueda web: necesita una fuente de datos autorizada, reglas de seguridad y un backend/LLM separado del sitio estático.
- No se publicará ninguna duración, promesa o texto de garantía o reembolso. Las especificaciones visibles excluyen cualquier campo de garantía.
- Se actualizará a 480 USD únicamente el precio de los sillones que coinciden con variantes y precios comprobados en Stewart Prime. No se inventarán equivalencias para productos que no coinciden.
- Después del título del estimador y antes del texto explicativo, un camión blanco de 64 px se moverá por toda la línea, soltará cajas caramelo de 32 px y reiniciará el ciclo al desaparecerlas. El movimiento será controlado por JavaScript sin competir con animaciones CSS; se respetará `prefers-reduced-motion`.
- Al final de cada ficha, debajo de las acciones de compra, se mostrarán cuatro productos distintos, disponibles y relacionados, con nombre, imagen y precio. Pulsar una sugerencia abrirá la ficha de ese producto.
- Los artículos agotados no se podrán agregar desde una tarjeta, una ficha ni los controles de cantidad del carrito.
- WhatsApp recibirá el contexto completo de productos, cantidades, precios, subtotal, municipio, estado del envío y solicitud de total final.
- La tienda es estática en GitHub Pages. Dos builds más antiguos quedaron cancelados al ser sustituidos por commits posteriores; una ejecución posterior de Pages terminó con éxito. El fallo del bot de Telegram fue un timeout de red hacia Telegram y no afecta la publicación del sitio.

## Estructura

- `index.html`: sección de envío, animación, CTAs de llamada y ficha convencional del producto.
- `app.js`: reglas de zonas, cálculo estimado, animación del camión, sugerencias por producto, disponibilidad y bloqueo de agotados, especificaciones e integración contextual de WhatsApp.
- `catalogo.js`: precios comprobados y datos de producto publicados.
- `style.css`: estimador, animación y diseño responsive para sugerencias de productos y disponibilidad.
- `TODO.md`: criterios concretos y estado de entrega.

## Fuentes revisadas

- Precio publicado del sillón reclinable en tela y variantes relacionadas: [ficha de Stewart Prime](https://stewartprime.shop/producto/sillon-reclinable-marron), 480 USD.
- El despliegue actual del commit `8b46851` finalizó correctamente en [GitHub Actions](https://github.com/valleverdecia-lab/nexo/actions/runs/42232856819). Una ejecución anterior de Pages también tuvo éxito en [el run 42226002292](https://github.com/valleverdecia-lab/nexo/actions/runs/42226002292); el workflow del bot de Telegram es independiente.
