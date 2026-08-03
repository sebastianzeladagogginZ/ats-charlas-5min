# ATS y Charla de 5 minutos · App de escaneo con carga a Google Drive

Aplicación web (PWA) para escanear **ATS (Análisis de Trabajo Seguro)** y **charlas de
5 minutos** en campo y subirlas automáticamente a Google Drive, organizadas por
**Mes › Día › Área › División › Cuadrilla › Cliente-Circuito › (ATS | Charla)**, sin carpetas duplicadas.

La paleta de colores está tomada del formulario de inspecciones **SEG-F-010**
(navy `#0c4a6e` → celeste `#0284c7`, fondo slate `#f1f5f9`).

---

## ✅ Estado: BACKEND YA DESPLEGADO (cuenta SSOMA ONI · 3 ago 2026)

Ya está conectado y probado de extremo a extremo. No necesitas repetir la Parte 1.

- **Cuenta:** `ssomaoni@gmail.com`
- **Carpeta raíz en Drive:** `ATS y Charlas 2026` (ID `16M5ZqMyRon7Xaxm461FT0B_TTEx00RPK`)
- **Proyecto Apps Script:** *ATS y Charlas 5 min - Backend Drive*
- **Endpoint (ya puesto en `index.html`):**
  `https://script.google.com/macros/s/AKfycbzpT_x5ITn5RZBFfKOALsbMF3wEHAJbr2eS4opmNBUtnpV1zToPYiSh097cF8sr45sb/exec`
- **Prueba OK:** se subió un archivo a `ATS y Charlas 2026/2026-08 Agosto/2026-08-03/Normalización de Red/`.

**Falta solo 1 paso:** publicar el frontend en HTTPS (GitHub Pages) para que las
cuadrillas lo abran desde el teléfono. Ver *Parte 2*.

> Si cambias el código del backend, re-despliega manteniendo la MISMA URL:
> *Implementar › Gestionar implementaciones › (lápiz) › Versión: «Nueva» › Implementar.*

---

## ✔️ Qué incluye (requisitos cubiertos)

| Requisito | Cómo se resuelve |
|---|---|
| Campos obligatorios: cliente, circuito, fecha, cuadrilla, área, división | Validación **en tiempo real** con medidor de avance |
| Área y División como **menús desplegables encadenados** (sin duplicados) | Eliges el Área y la División se filtra sola (definido en `AREAS` dentro de `index.html`) |
| Carga automática a Drive | Backend **Google Apps Script** (`apps-script/Codigo.gs`) |
| Jerarquía **Mes › Día › División** | `getOrCreateFolder()` reutiliza carpetas existentes |
| Varias cuadrillas, mismo día/división → misma carpeta, sin duplicados | `getFoldersByName` + **`LockService`** (creación serializada) |
| Nombre con formato estándar de fecha | `TIPO_AAAA-MM-DD_DIVISION_CUADRILLA_HHMMSS_NN.jpg` |
| Tomar fotos con el teléfono **y** subir desde la computadora | Botón cámara (móvil) · botón subir · **arrastrar y soltar** (PC) · etiquetas que se adaptan al dispositivo |
| Compresión automática de imágenes | Canvas → JPEG (máx 1600 px, calidad 0.7) antes de subir |
| Bloqueo de 10 min en “Enviar” | Contador persistente y **cifrado** en `localStorage` |
| Funciona sin conexión | Service Worker + **cola cifrada** en IndexedDB que se sube al reconectar |
| Protección de datos (cifrado local) | **AES-GCM** con clave no exportable guardada en IndexedDB |

---

## 🚀 Instalación (2 partes)

### Parte 1 — Backend en Google Drive (Apps Script)

1. En tu Google Drive crea la **carpeta raíz** donde se guardará todo
   (p. ej. `ATS y Charlas 2026`). Ábrela y copia su **ID** desde la URL:
   `https://drive.google.com/drive/folders/`**`ESTE_ES_EL_ID`**
2. Ve a <https://script.google.com> → **Nuevo proyecto**.
3. Borra el contenido y pega el código de [`apps-script/Codigo.gs`](apps-script/Codigo.gs).
4. Reemplaza `ROOT_FOLDER_ID` por el ID del paso 1.
   *(Opcional)* crea una Google Sheet, copia su ID en `LOG_SHEET_ID` para llevar un registro.
   > 🔗 **Integración con el Panel SSOMA:** el `doGet?action=registros` de `Codigo.gs` devuelve los
   > registros de esa hoja `Registros`, y la pestaña *ATS · Charla 5 min* del panel los grafica. Para que
   > el panel muestre datos reales (no demo), **`LOG_SHEET_ID` debe estar configurado** y el backend
   > re-desplegado; luego pega esta URL `/exec` en `CONFIG.ATS_ENDPOINT_URL` del panel.
5. **Implementar › Nueva implementación › Aplicación web**:
   - *Ejecutar como:* **Yo**
   - *Quién tiene acceso:* **Cualquier usuario**
6. Autoriza los permisos y copia la **URL** que termina en `/exec`.

### Parte 2 — Frontend (esta app)

1. Abre [`index.html`](index.html) y en el bloque `CONFIG` pega la URL:
   ```js
   const CONFIG = { endpoint: 'https://script.google.com/macros/s/AKfy…/exec', … };
   ```
2. Publica los archivos (`index.html`, `sw.js`, `manifest.json`, `icon.svg`) en
   **GitHub Pages** o cualquier hosting **HTTPS** (necesario para cámara,
   Service Worker y cifrado).
3. Abre la URL en el móvil → menú → **“Añadir a pantalla de inicio”** para
   instalarla como app.

> El Service Worker y `crypto.subtle` solo funcionan en **HTTPS** (o
> `http://localhost`). Abrir el archivo con `file://` deshabilita esas funciones.

---

## 📁 Resultado en Drive

```
ATS y Charlas 2026/
└── 2026-08 Agosto/
    └── 2026-08-03/
        └── MANTENIMIENTO/                        ← Área
            └── Normalización de Red/            ← División
                └── Cuadrilla 4/                  ← N.º de cuadrilla
                    └── MINERA XYZ S.A.C. - Circuito 310284485/   ← Cliente + circuito
                        ├── ATS/                  ← documentos ATS (separados)
                        │   └── ATS_2026-08-03_..._Cuadrilla-4_143025_01.jpg
                        └── Charla de 5 minutos/  ← charlas (separadas)
                            └── Charla-5min_2026-08-03_..._Cuadrilla-4_150210_01.jpg
```

Jerarquía completa: **Mes › Día › Área › División › Cuadrilla › Cliente-Circuito › (ATS | Charla de 5 minutos)**.
Los ATS y las Charlas quedan en **carpetas separadas** para que no se mezclen. Todas las
cuadrillas de la misma división y día comparten los niveles superiores, sin duplicar carpetas.

> **Anti-duplicados:** cada envío lleva un `uploadId` único. Si un reintento (tras un error
> de red) repite el mismo envío, el backend lo detecta (CacheService, 6 h) y **no vuelve a
> subir** los archivos. Así el reintento automático de la cola nunca genera duplicados.

> **Nombre de archivo:** `TIPO_AAAA-MM-DD_ÁREA_DIVISIÓN_Cuadrilla-N_HHMMSS_NN.jpg`.

### Editar el catálogo de áreas/divisiones

Está en `index.html`, en la constante `AREAS`. Para añadir o quitar opciones,
edita ese objeto (clave = Área, arreglo = sus Divisiones):

```js
const AREAS = {
  'INSPECCIÓN Y DISEÑO': ['Inspección y Diseño - Corporativo'],
  'MANTENIMIENTO': ['Mantenimiento - Corporativo','Mantenimiento - Ultra','Mangas Críticas','ON Negocios','Normalización de Red'],
  'NETWORKING': ['Instalaciones - Corporativo','ON-Site - Corporativo'],
  'PLANTA EXTERNA': ['Planta Externa - Corporativo','ON Negocios','Normalización - Preventivo']
};
```

---

## 🔒 Nota sobre el cifrado local

Los borradores del formulario y la cola de envíos pendientes se guardan
**cifrados (AES-GCM)** con una clave que nunca sale del dispositivo. Esto protege
la información frente a inspección casual del almacenamiento del navegador. Como
en toda app 100 % de cliente, alguien con acceso físico al dispositivo
desbloqueado y a las herramientas de desarrollo podría usar la misma clave; para
datos sumamente sensibles conviene además el cifrado/controles del backend.

---

## 🛠️ Solución de problemas

- **Error de CORS al enviar:** confirma que la implementación es *“Cualquier
  usuario”* y vuelve a implementar (nueva versión). La app envía como
  `text/plain` a propósito para evitar el *preflight*.
- **“ROOT_FOLDER_ID no configurado”:** falta pegar el ID de la carpeta raíz.
- **La cámara no abre:** debe servirse por HTTPS y conceder permiso de cámara.
- **No sube estando “en línea”:** revisa que `CONFIG.endpoint` termine en `/exec`.
- **Se queda en “Comprimiendo…”:** ya no debería pasar. Cada imagen tiene un
  límite de 25 s; si el navegador no puede procesar el formato (típico con
  **HEIC de iPhone**), la foto se **adjunta sin comprimir** para no perder el
  documento y verás un aviso. Recomendación: en el iPhone, *Ajustes › Cámara ›
  Formatos › Más compatible* para capturar en JPG.
- **No veo los cambios tras actualizar:** el HTML ahora se sirve *network-first*,
  así que basta recargar estando en línea. Si insiste, **Ctrl+Shift+R** o sube el
  número `CACHE` en `sw.js`.
