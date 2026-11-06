# Plan de mejoras de conversión para Nexo

## Alcance

Añadir una experiencia de compra asistida que reduzca la incertidumbre después de explorar el catálogo: estimador de envío debajo de la vitrina, integración del destino en el carrito y en WhatsApp, llamada gratuita de 10 minutos para productos complejos, y mensajes de checkout más claros.

## Decisiones

- Mantener la identidad editorial oscura de Nexo; tomar de Stewart Prime la lógica funcional del estimador, no su marca, textos ni implementación.
- El estimador aparecerá inmediatamente debajo de los productos y antes de “Cómo funciona”.
- El estimador será transparente: distinguirá “sin cargo”, “estimado” y “a confirmar”.
- El cálculo será una estimación frontend configurable por municipio/zona; la confirmación humana por WhatsApp seguirá siendo obligatoria antes del pago.
- El carrito conservará el municipio seleccionado, mostrará subtotal + envío estimado y generará un mensaje de WhatsApp con el contexto completo.
- La llamada gratuita será opcional y se enfatizará especialmente para energía, vehículos, compras desde el exterior y productos de alto valor.
- No se añadirá todavía un chatbot con búsqueda web: necesita una fuente de datos autorizada, reglas de seguridad y un backend/LLM separado del sitio estático.

## Estructura

- `index.html`: sección de envío, campos del carrito y CTAs de llamada.
- `app.js`: reglas de zonas, cálculo estimado, estado local, integración carrito/WhatsApp.
- `style.css`: tarjetas y estados del estimador, responsive y copy de conversión.
- `TODO.md`: criterios concretos y estado de entrega.
