# Esencia · Cuaderno de cocina

Aplicación privada de ingredientes, subrecetas, escandallos y alérgenos, con interfaz adaptable a móviles y ordenadores. El sitio estático se publica en GitHub Pages; los datos reales solo están en Supabase, protegidos por usuario.

## Desarrollo

Requiere Node.js 22.12 o posterior.

```sh
npm ci
npm run dev
npm test
npm run build
```

El build genera `docs/`, listo para publicar en un subdirectorio de GitHub Pages. La configuración pública está en `src/config.js`; `.env` puede sobrescribirla según `.env.example`. Solo se usa una clave **publicable**, nunca `service_role` ni una contraseña. Las bibliotecas están fijadas en `package-lock.json`.

## Publicación en GitHub Pages

1. Compilar con `npm run build` y subir el código junto con `docs/` al repositorio.
2. En **Settings → Pages**, seleccionar **Deploy from a branch**, rama `main`, carpeta `/docs`.
3. Abrir la URL que muestra GitHub e iniciar sesión con la cuenta de Supabase habilitada.

Las rutas son relativas, por lo que funcionan en `/Escandallo/`. Para publicar cambios: ejecutar las pruebas, recompilar y subir también `docs/`. No subir el ZIP original, las copias JSON privadas ni `private/`.

## Base de datos y acceso

La migración de `supabase/migrations/` crea únicamente `esencia_costes_documents`, sus políticas y `esencia_costes_save`. No modifica tablas ni funciones del TPV ni la configuración global de Auth. Se usa una única fila JSON por cuaderno personal para guardar composición y referencias en una transacción.

- Sin registro público de cuentas en la aplicación.
- Inicio de sesión con correo y contraseña existente en Supabase Auth.
- Solo el propietario puede leer y modificar su fila (RLS).
- Ni usuarios anónimos ni otros usuarios del TPV pueden ver ese cuaderno.
- Las nuevas filas solo se provisionan desde administración. No hay permisos de inserción ni borrado para el cliente.
- La función de guardado es `SECURITY INVOKER`, con `search_path` fijo y comprobación atómica de revisión. Si otro dispositivo se adelanta, el guardado se rechaza y ofrece descargar el borrador antes de recargar.
- El cliente consulta los cambios cada 30 segundos y al volver a la pestaña. No recarga datos durante una edición. Sin conexión permite consultar lo cargado, pero no promete guardar cambios offline.
- Los datos privados permanecen en memoria del navegador y en Supabase. Solo la sesión de acceso se conserva en el almacenamiento del navegador. Cerrar sesión limpia los datos de la vista.

Para habilitar otra instalación, aplicar la migración y provisionar una fila desde SQL Editor usando el UUID de su cuenta existente y un documento v2 válido. Es una operación administrativa; no se hace desde el navegador público.

## Criterios de cálculo

- `coste útil = precio / cantidad del envase / (1 − merma / 100)`.
- Conversión entre g/kg y ml/l. No se convierten gramos a mililitros ni unidades a gramos sin una formulación específica.
- Coste de una subreceta = coste del lote dividido por su rendimiento real. Permite preparaciones anidadas y rechaza ciclos.
- Coste de producto = suma de componentes e indirectos por producto.
- Venta neta = PVP / (1 + IGIC / 100), usando el tipo indicado por el usuario.
- Coste sobre venta = coste / venta neta. Margen de contribución = venta neta − coste. No es beneficio neto.
- PVP orientativo = coste / objetivo de coste × (1 + IGIC / 100).
- Los precios de compra deben introducirse de forma homogénea, descontando solo los impuestos recuperables que correspondan. La aplicación no decide tipos fiscales ni deducibilidad.
- Sin composición, precios, formatos o unidades compatibles se muestra coste incompleto. Un precio explícito de cero es válido; precio pendiente es `null`.

## Alérgenos

Contiene y trazas se propagan desde los ingredientes, incluidas las subrecetas anidadas. «Contiene» prevalece sobre «puede contener». La revisión de alérgenos es independiente de tener un precio completo. Cada ingrediente guarda su revisión, fecha y referencia de ficha. La matriz usa `?` para la información no revisada; `—` significa no declarado en las fichas revisadas, nunca una garantía de ausencia o una evaluación de contaminación cruzada.

Las copias v1 conservan declaraciones y precios, pero sus ingredientes quedan pendientes de revisión. Se rechazan importaciones corruptas, identificadores duplicados, referencias inexistentes, ciclos, valores negativos y unidades desconocidas. La importación requiere revisar y confirmar la sustitución y permite exportar antes los datos vigentes.

## Pruebas y privacidad de los ejemplos

`npm test` comprueba cálculos, conversiones, merma, impuesto configurable, herencia de alérgenos, ciclos y validación de copias. La demostración pública solo contiene recetas y precios ficticios. Los datos originales de Esencia están excluidos del repositorio y del build.

Para verificar el acceso de una instalación: probar lectura y guardado como propietario, intento como otra cuenta, acceso anónimo y conflicto con una revisión antigua. Hacer escrituras de prueba dentro de una transacción revertida o con datos desechables.
