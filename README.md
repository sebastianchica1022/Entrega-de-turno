# Entrega de Turno · I-PASS/SBAR

PWA offline-first para entregas de turno estructuradas en urgencias/UCI. HTML + CSS + JS puro, lista para GitHub Pages, con sincronización opcional entre dispositivos.

## Archivos

```
index.html              → estructura (pestañas, formulario 4 pasos, reporte, turnos)
styles.css               → estilos (dark mode por defecto, estética de monitor)
app.js                     → lógica: turnos, especialidades, traslados, pendientes, PDF, sync
firebase-config.js       → credenciales de sincronización (opcional, con instrucciones dentro)
manifest.webmanifest    → metadata de instalación PWA
sw.js                      → service worker (cache offline)
icons/                      → íconos 192/512/maskable
```

## Qué trae esta versión

- **Turno con fecha y jornada explícitas**: cada turno queda identificado por la fecha que se está diligenciando y si es Día (07:00–18:59) o Noche (19:00–06:59), sugerido automáticamente según la hora del dispositivo. Se ve en la barra superior y en cada reporte/PDF.
- **Especialidad tratante** (multi-selección por paciente) con pestaña propia: Medicina de Urgencias, Cirugía General, Medicina Interna, Cuidados Paliativos, Neurocirugía, Ginecología, Ortopedia, Medicina General, y una pestaña "Otras" que agrupa Neumología, Reumatología, Oncología y Hematología.
- **Pestaña de Traslados**: agrupa pacientes por destino (Salida, Observación, Hospitalización, UCI, UCIN, Morgue) para revisar al final de la ronda.
- **Pestaña de Pendientes**: todos los pendientes del turno en una sola lista, ordenados primero los de pacientes inestables (rojo), luego watcher (amarillo), luego estables (verde). Se marcan con un check al cumplirse, pero no se borran — quedan como historial de lo ejecutado.
- **Tarjetas de paciente** muestran de una vez la(s) especialidad(es) y los primeros pendientes, sin necesidad de entrar al detalle.
- **PDF resumido**: botón de documento en la barra superior genera una vista de impresión con todos los pacientes, pendientes y traslados; se guarda como PDF usando el diálogo de impresión del navegador/celular ("Guardar como PDF"), sin depender de internet.
- **Sincronización opcional entre dispositivos** (ver abajo): si la configuras, varios celulares que usen la misma fecha + jornada ven y editan los mismos pacientes casi en tiempo real.

## Cómo funciona el almacenamiento

- **Local**: cada turno se guarda en `localStorage` del dispositivo (clave `handoff.shifts.v2`), así que la app funciona sin internet.
- **En la nube (opcional)**: si configuras Firebase (gratis), cada turno se guarda también como un documento en Firestore identificado por `fecha_jornada` (ej. `2026-08-17_noche`). Cualquier dispositivo que seleccione esa misma fecha y jornada en "Turnos" queda escuchando los cambios en tiempo real. Sin conexión, el dispositivo sigue funcionando con su copia local y se sincroniza en cuanto recupera internet.

## Activar la sincronización entre dispositivos (opcional, gratis)

Sin este paso, la app funciona perfecto pero cada dispositivo ve solo sus propios datos.

1. Ve a [https://console.firebase.google.com](https://console.firebase.google.com) e inicia sesión con una cuenta Google.
2. Crea un proyecto nuevo (plan gratuito "Spark", no pide tarjeta).
3. En el menú lateral: **Compilación → Firestore Database → Crear base de datos** → modo producción → elige una región cercana (ej. `southamerica-east1`).
4. En la pestaña **Reglas** de Firestore, reemplaza el contenido por:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /shifts/{shiftId} {
         allow read, write: if true;
       }
     }
   }
   ```
   Esto permite que cualquiera con el enlace de tu app lea/escriba los turnos — suficiente para un equipo pequeño que comparte la URL. Evita registrar nombres completos o documentos de identidad; usa cama/iniciales.
5. Ícono de engranaje → **Configuración del proyecto** → baja a "Tus apps" → agrega una app **Web** (ícono `</>`) → copia el objeto `firebaseConfig`.
6. Pega esos valores en `firebase-config.js` (reemplaza los que dicen `TU_...`).
7. Sube ese archivo actualizado a tu repositorio junto con los demás.

Cuando esté activo, verás un indicador "☁️ Sincronizado" junto a la fecha del turno, y un código de turno compartido en la pantalla de "Turnos" que puedes decirle de palabra al resto del equipo (aunque basta con que todos elijan la misma fecha y jornada).

## Desplegar en GitHub Pages

1. Crea un repositorio nuevo (por ejemplo `entrega-turno`) en tu cuenta de GitHub.
2. Copia todo el contenido de esta carpeta (incluida la carpeta `icons/`) a la raíz del repo.
3. Sube los cambios:
   ```bash
   git init
   git add .
   git commit -m "PWA entrega de turno I-PASS"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/entrega-turno.git
   git push -u origin main
   ```
4. En GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, rama `main`, carpeta `/ (root)`.
5. Espera 1-2 minutos; la app queda en `https://TU-USUARIO.github.io/entrega-turno/`.
6. Ábrela desde el celular y usa "Agregar a pantalla de inicio" (iOS) o "Instalar app" (Android).

## Notas importantes

- **HTTPS obligatorio** para el service worker, el portapapeles y Firestore — GitHub Pages ya lo entrega por defecto.
- **Actualizar el cache**: si editas los archivos después de desplegar, sube la versión en `sw.js` (`CACHE_NAME = 'handoff-cache-v4'`, etc.) para que los dispositivos que ya instalaron la app reciban los cambios.
- **Este contenido no reemplaza el registro clínico oficial**: es una ayuda de comunicación para la entrega verbal/escrita del turno, no la historia clínica legal del paciente.
- Si nunca configuras Firebase, ignora por completo `firebase-config.js`: todo sigue funcionando en modo local normal.

## Probar en local antes de publicar

```bash
cd entrega-turno
python3 -m http.server 8080
# abre http://localhost:8080 en el navegador
```
