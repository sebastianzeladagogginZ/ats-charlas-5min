/**
 * BACKEND — ATS y Charla de 5 minutos → Google Drive
 * ---------------------------------------------------
 * Recibe los registros del formulario (index.html) y guarda los archivos
 * escaneados en Drive con la jerarquía:
 *   Mes › Día › Área › División › Cuadrilla N › CLIENTE - Circuito X › (ATS | Charla de 5 minutos)
 *
 * Puntos clave del enunciado que resuelve este script:
 *  - Jerarquía anidada que separa ATS y Charla de 5 min para que no se mezclen.
 *  - VARIAS cuadrillas, mismo día y misma división → carpetas compartidas SIN
 *    duplicados (getOrCreateFolder + LockService solo al crear carpetas).
 *  - Idempotencia por uploadId (CacheService): un reintento tras un error de red
 *    NO vuelve a subir los archivos → nunca se duplican en Drive.
 *  - Nombre de archivo con formato estándar de fecha (lo arma el frontend).
 *  - Registro de metadatos (cliente, circuito, área…) en una hoja de cálculo.
 *
 * INSTALACIÓN (ver README.md):
 *  1) Crea una carpeta raíz en tu Drive y copia su ID en ROOT_FOLDER_ID.
 *  2) (Opcional) Crea una hoja de cálculo y copia su ID en LOG_SHEET_ID.
 *  3) Implementar › Nueva implementación › Aplicación web
 *       - Ejecutar como: Yo
 *       - Quién tiene acceso: Cualquier usuario
 *  4) Copia la URL /exec y pégala en CONFIG.endpoint del index.html.
 */

/* ====================== CONFIGURACIÓN ====================== */
var ROOT_FOLDER_ID = '16M5ZqMyRon7Xaxm461FT0B_TTEx00RPK'; // carpeta "ATS y Charlas 2026" (SSOMA ONI)
var LOG_SHEET_ID   = '1ptmnCGfCHZX5RvWSg0cOczbKzYxNgsDooF_BbVg04fc';   // Sheet "ATS y Charlas 2026 - Registros" (alimenta el Panel SSOMA)
var LOG_SHEET_NAME = 'Registros';
/* Token compartido para las acciones de revisión (aprobar/anular) del panel.
   Es una barrera básica: el panel lo envía en cada acción. NOTA: al viajar en el
   cliente del panel NO es un secreto fuerte; para uso interno (panel con DNI) es
   suficiente. Para blindarlo del todo habría que validar la identidad server-side. */
var REVIEW_TOKEN = 'oni-ssoma-2026-review';
/* ========================================================== */

function doGet(e) {
  // El Panel SSOMA consume ?action=registros para visualizar el llenado de ATS / Charla.
  var action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'registros') {
    return json({ ok: true, registros: leerRegistros(e) });
  }
  return json({ ok: true, service: 'ATS/Charla uploader', time: new Date().toISOString() });
}

/**
 * Devuelve los últimos registros de llenado (ATS / Charla de 5 min) desde la hoja "Registros".
 * Requiere LOG_SHEET_ID configurado. Sin hoja → lista vacía (el panel usa su modo demo).
 * Parámetro opcional ?limit=N (por defecto 1000, más recientes primero).
 */
function leerRegistros(e) {
  if (!LOG_SHEET_ID) return [];
  try {
    var ss = SpreadsheetApp.openById(LOG_SHEET_ID);
    var sh = ss.getSheetByName(LOG_SHEET_NAME);
    if (!sh || sh.getLastRow() < 2) return [];
    var limit = (e && e.parameter && e.parameter.limit) ? parseInt(e.parameter.limit, 10) : 1000;
    if (!(limit > 0)) limit = 1000;
    var lastRow = sh.getLastRow();
    var startRow = Math.max(2, lastRow - limit + 1);      // solo las últimas N filas
    var nRows = lastRow - startRow + 1;
    // Cols 1-11: Recibido, Tipo, Cliente, Circuito, Fecha, Cuadrilla, Área, División, N° archivos, Carpeta, Archivos
    // Cols 12-15 (revisión): Estado, RevisadoPor, RevisadoEn, MensajeTecnico (pueden no existir en hojas viejas).
    var lastCol = Math.max(11, sh.getLastColumn());
    var values = sh.getRange(startRow, 1, nRows, lastCol).getValues();
    var out = [];
    for (var i = values.length - 1; i >= 0; i--) {         // más reciente primero
      var r = values[i];
      out.push({
        recibido:    fechaTexto(r[0]),
        tipo:        r[1],
        cliente:     r[2],
        circuito:    r[3],
        fecha:       fechaTexto(r[4]),
        cuadrilla:   r[5],
        area:        r[6],
        division:    r[7],
        archivos:    r[8],
        carpeta:     r[9],
        estado:      String(r[11] || 'Pendiente'),   // col 12
        revisadoPor: String(r[12] || ''),            // col 13
        revisadoEn:  fechaTexto(r[13]),              // col 14
        mensaje:     String(r[14] || '')             // col 15 (nota al técnico si se anuló)
      });
    }
    return out;
  } catch (err) {
    return [];
  }
}

/** Normaliza una fecha a 'AAAA-MM-DD'. Las celdas de fecha de Sheets se leen como
 *  medianoche UTC, así que se formatean en UTC para no adelantar/atrasar un día.
 *  Si el valor es texto, se devuelve tal cual. */
function fechaTexto(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
  }
  return String(v == null ? '' : v);
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    // Acciones de revisión desde el panel (aprobar / anular). No llevan archivos.
    if (data && (data.action === 'ats_aprobar' || data.action === 'ats_anular')) {
      return revisarRegistro(data);
    }
    if (!data || !data.files || !data.files.length) {
      return json({ ok: false, error: 'Sin archivos en la solicitud.' });
    }
    if (!ROOT_FOLDER_ID || ROOT_FOLDER_ID.indexOf('PEGA_AQUI') === 0) {
      return json({ ok: false, error: 'ROOT_FOLDER_ID no configurado en el script.' });
    }

    var meta = data.meta || {};

    // Idempotencia: si este MISMO envío ya se procesó (un reintento tras un error
    // de red), devuelve el resultado anterior en vez de volver a subir → NO duplica.
    var cache = CacheService.getScriptCache();
    var uid = data.uploadId ? ('up_' + String(data.uploadId)) : '';
    if (uid) {
      var prev = cache.get(uid);
      if (prev) return textJson(prev);
    }

    // Crea/reutiliza la ruta de carpetas. Solo esta parte necesita el candado
    // (evita carpetas duplicadas si dos cuadrillas suben en el mismo instante).
    var dest = createFolderPath(data, meta);

    // Deja la carpeta destino libre para lectura con enlace (los archivos que se
    // suban debajo heredan el permiso). Así el Panel abre la evidencia sin
    // "solicitar acceso". Fuera del candado para no alargar la sección serializada.
    compartirLectura(dest);

    // La subida de archivos NO necesita candado (crear archivos en una carpeta ya
    // existente no genera duplicados de carpeta), así varias cuadrillas suben en paralelo.
    var saved = [];
    for (var i = 0; i < data.files.length; i++) {
      var f = data.files[i];
      var bytes = Utilities.base64Decode(f.dataB64);
      var blob = Utilities.newBlob(bytes, f.mime || 'image/jpeg', sanitize(f.name));
      var file = dest.createFile(blob);
      file.setDescription(JSON.stringify(meta)); // metadatos dentro del propio archivo
      saved.push({ name: file.getName(), id: file.getId(), url: file.getUrl() });
    }

    logToSheet(meta, dest.getUrl(), saved);

    var result = JSON.stringify({ ok: true, folder: dest.getUrl(), folderId: dest.getId(), saved: saved, count: saved.length });
    if (uid) { try { cache.put(uid, result, 21600); } catch (e3) {} } // 6 h: ventana anti-duplicado para reintentos
    return textJson(result);

  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

/**
 * Crea (o reutiliza) la jerarquía de carpetas y devuelve la carpeta DESTINO:
 *   Raíz › Mes › Día › División › Cuadrilla N › CLIENTE - Circuito X › (ATS | Charla de 5 minutos)
 * Serializa solo la creación de carpetas con LockService para no duplicarlas.
 */
function createFolderPath(data, meta) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var root = DriveApp.getFolderById(ROOT_FOLDER_ID);
    var mes  = getOrCreateFolder(root, sanitize(data.mesFolder || 'Sin-mes'));
    var dia  = getOrCreateFolder(mes,  sanitize(data.diaFolder || 'Sin-dia'));
    var area = getOrCreateFolder(dia,  sanitize(meta.area || data.area || 'Sin-area'));
    var div  = getOrCreateFolder(area, sanitize(data.division || meta.division || 'Sin-division'));
    var cuad = getOrCreateFolder(div,  sanitize('Cuadrilla ' + (meta.cuadrilla || 'S-N')));
    var cliName = (meta.cliente || 'Sin-cliente') + (meta.circuito ? ' - Circuito ' + meta.circuito : '');
    var cli  = getOrCreateFolder(cuad, sanitize(cliName));
    var tipoName = (String(meta.tipo || '').toUpperCase().indexOf('ATS') === 0) ? 'ATS' : 'Charla de 5 minutos';
    return getOrCreateFolder(cli, sanitize(tipoName));
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/** Devuelve la carpeta hija por nombre; si no existe, la crea. Evita duplicados. */
function getOrCreateFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();     // reutiliza la existente
  return parent.createFolder(name);       // o crea una nueva
}

/**
 * Deja la carpeta (y por HERENCIA los archivos que contiene) como
 * "cualquiera con el enlace puede ver". Así los jefes/coordinadores abren la
 * evidencia desde el Panel SIN que Google les pida "solicitar acceso".
 * Best-effort: si la configuración de Drive lo restringe, no rompe la carga.
 */
function compartirLectura(folder) {
  try {
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) { /* no interrumpir la subida si el permiso falla */ }
}

/** Limpia nombres para Drive (sin barras ni caracteres problemáticos). */
function sanitize(s) {
  return String(s == null ? '' : s).replace(/[\\\/\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180) || 'Sin-nombre';
}

/** Registro opcional en Google Sheets. */
function logToSheet(meta, folderUrl, saved) {
  if (!LOG_SHEET_ID) return;
  try {
    var ss = SpreadsheetApp.openById(LOG_SHEET_ID);
    var sh = ss.getSheetByName(LOG_SHEET_NAME) || ss.insertSheet(LOG_SHEET_NAME);
    if (sh.getLastRow() === 0) {
      sh.appendRow(['Recibido', 'Tipo', 'Cliente', 'Circuito', 'Fecha', 'Cuadrilla', 'Área', 'División', 'N° archivos', 'Carpeta', 'Archivos', 'Estado', 'RevisadoPor', 'RevisadoEn', 'MensajeTecnico']);
    }
    ensureReviewHeader(sh);
    sh.appendRow([
      new Date(), meta.tipo || '', meta.cliente || '', meta.circuito || '', meta.fecha || '',
      meta.cuadrilla || '', meta.area || '', meta.division || '',
      saved.length, folderUrl, saved.map(function (s) { return s.name; }).join(', '),
      'Pendiente', '', '', ''   // Estado inicial: por revisar
    ]);
  } catch (e) { /* el registro no debe romper la carga */ }
}

/**
 * REVISIÓN POR ÁREA — aprobar o anular un registro de ATS/Charla desde el panel.
 * data: { action:'ats_aprobar'|'ats_anular', token, carpeta, revisadoPor, mensaje? }
 *   - Aprobar: Estado='Aprobado'.
 *   - Anular : Estado='Anulado' + guarda el mensaje al técnico y envía a la PAPELERA
 *              de Drive los archivos de esa carpeta (recuperables ~30 días).
 * Barrera básica por REVIEW_TOKEN (uso interno; ver nota en la constante).
 * Identifica la fila por la URL de carpeta (columna 10), la más reciente con esa URL.
 */
function revisarRegistro(data) {
  if (!LOG_SHEET_ID) return json({ ok: false, error: 'Sin hoja configurada.' });
  if (String(data.token || '') !== REVIEW_TOKEN) return json({ ok: false, error: 'no_autorizado' });
  var carpeta = String(data.carpeta || '').trim();
  if (!carpeta) return json({ ok: false, error: 'Falta la carpeta del registro.' });

  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e0) {}
  try {
    var ss = SpreadsheetApp.openById(LOG_SHEET_ID);
    var sh = ss.getSheetByName(LOG_SHEET_NAME);
    if (!sh || sh.getLastRow() < 2) return json({ ok: false, error: 'Sin registros.' });
    ensureReviewHeader(sh);
    var last = sh.getLastRow();
    var urls = sh.getRange(2, 10, last - 1, 1).getValues();     // columna Carpeta
    var fila = -1;
    for (var i = urls.length - 1; i >= 0; i--) {                // la fila más reciente con esa carpeta
      if (String(urls[i][0]) === carpeta) { fila = i + 2; break; }
    }
    if (fila < 0) return json({ ok: false, error: 'Registro no encontrado.' });

    var anular = (data.action === 'ats_anular');
    sh.getRange(fila, 12).setValue(anular ? 'Anulado' : 'Aprobado');
    sh.getRange(fila, 13).setValue(String(data.revisadoPor || ''));
    sh.getRange(fila, 14).setValue(new Date());
    sh.getRange(fila, 15).setValue(anular ? String(data.mensaje || '') : '');

    var papelera = 0;
    if (anular) { papelera = trashCarpeta(carpeta); }
    return json({ ok: true, estado: anular ? 'Anulado' : 'Aprobado', archivosPapelera: papelera });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

/** Envía a la papelera los archivos dentro de la carpeta (identificada por su URL). */
function trashCarpeta(url) {
  try {
    var m = String(url).match(/[-A-Za-z0-9_]{25,}/);   // ID de la carpeta desde la URL de Drive
    if (!m) return 0;
    var folder = DriveApp.getFolderById(m[0]);
    var it = folder.getFiles(), n = 0;
    while (it.hasNext()) { it.next().setTrashed(true); n++; }   // a la papelera (recuperable ~30 días)
    return n;
  } catch (e) { return 0; }
}

/** Asegura que la fila 1 tenga los encabezados de revisión (cols 12-15). */
function ensureReviewHeader(sh) {
  if (sh.getLastColumn() < 15) {
    sh.getRange(1, 12, 1, 4).setValues([['Estado', 'RevisadoPor', 'RevisadoEn', 'MensajeTecnico']]);
  }
}

/**
 * MANTENIMIENTO — ejecutar UNA sola vez a mano desde el editor de Apps Script
 * (menú «Ejecutar» → abrirLecturaExistentes). Recorre TODO lo que ya está bajo
 * ROOT_FOLDER_ID y deja cada carpeta como "cualquiera con el enlace puede ver",
 * para que la evidencia YA subida también se abra sin "solicitar acceso".
 * La carpeta RAÍZ se deja intacta (su enlace no se comparte). Es best-effort:
 * si una carpeta falla, sigue con las demás. Si el árbol fuese tan grande que
 * agota el tiempo (6 min), vuelve a ejecutarla: reanuda sin duplicar nada.
 * Devuelve cuántas carpetas se abrieron (visible en el registro de ejecución).
 */
function abrirLecturaExistentes() {
  var root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  var it = root.getFolders(), n = 0;
  while (it.hasNext()) { n += compartirArbol_(it.next()); }   // los hijos de la raíz hacia abajo
  Logger.log('Carpetas abiertas a lectura: ' + n);
  return n;
}

/** Comparte a lectura la carpeta y, recursivamente, todas sus subcarpetas. */
function compartirArbol_(folder) {
  compartirLectura(folder);
  var n = 1, it = folder.getFolders();
  while (it.hasNext()) { n += compartirArbol_(it.next()); }
  return n;
}

function json(obj) {
  return textJson(JSON.stringify(obj));
}
function textJson(str) {
  return ContentService.createTextOutput(str).setMimeType(ContentService.MimeType.JSON);
}
