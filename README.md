# Entrega de Turno · I-PASS/SBAR

PWA offline-first para entregas de turno estructuradas en urgencias/UCI. HTML + CSS + JS puro, lista para GitHub Pages.

> ⚠️ **Sincronización entre dispositivos: pausada por ahora.** El código de Firebase queda armado en el proyecto pero desactivado con un interruptor (`CLOUD_SYNC_DISABLED = true` en `app.js`), porque detectamos que un dispositivo con caché/almacenamiento local desactualizado puede sobrescribir datos más recientes de otro al conectarse. Hasta que resolvamos ese conflicto de forma segura, cada dispositivo guarda su propia copia local únicamente. Más detalles al final de este documento.

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
- **Documento de identidad**: tipo (CC/TI/RC/CE/PP) y número, en la sección de identificación.
- **Signos vitales en cuadros pequeños**: TA, TAM, FC, FR y SaO2 como campos individuales rápidos de llenar, más un campo de notas adicionales opcional.
- **Especialidad tratante** (multi-selección por paciente) con pestaña propia: Medicina de Urgencias, Cirugía General, Medicina Interna, Cuidados Paliativos, Neurocirugía, Ginecología, Ortopedia, Medicina General, y una pestaña "Otras" que agrupa Neumología, Reumatología, Oncología, Hematología, Neurología, Pediatría, Psiquiatría, Cardiología, Dermatología, Dolor, Infectología, Otorrinolaringología, Oftalmología, Cirugía Plástica y Nefrología.
- **Pestaña de Traslados**: agrupa pacientes por destino (Salida, Remisión, A definir, Observación, Hospitalización, UCI, UCIN, Morgue) para revisar al final de la ronda.
- **Pestaña de Pendientes**: todos los pendientes del turno en una sola lista, ordenados primero los de pacientes inestables (rojo), luego watcher (amarillo), luego estables (verde). Se marcan con un check al cumplirse, pero no se borran — quedan como historial de lo ejecutado.
- **Tarjetas de paciente** muestran de una vez la(s) especialidad(es) y los primeros pendientes, sin necesidad de entrar al detalle.
- **PDF resumido**: botón de documento en la barra superior genera una vista de impresión con todos los pacientes, pendientes y traslados; se guarda como PDF usando el diálogo de impresión del navegador/celular ("Guardar como PDF"), sin depender de internet.

## Sobre la sincronización entre dispositivos (pausada)

El proyecto incluye toda la integración con Firebase Firestore lista para funcionar (mismo `firebase-config.js` que ya configuraste con tu proyecto), pero **queda apagada a propósito** mientras resolvemos con cuidado el problema real que detectaste: si un computador tiene la app abierta con datos viejos en su caché o en `localStorage` y en algún momento vuelve a escribir, podría sobrescribir cambios más recientes hechos por otra persona desde otro dispositivo (el sistema actual no tiene forma de saber cuál versión es "más nueva" a nivel de cada paciente individual).

Por ahora, cada dispositivo funciona de forma completamente local e independiente — igual que al principio — y eso es justamente lo más seguro para no perder información.

Cuando quieras retomarlo, la solución correcta implica: (a) sincronizar por paciente individual en vez de por turno completo, para que dos personas editando pacientes distintos no se pisen; (b) usar marcas de tiempo por paciente para resolver conflictos ("gana el cambio más reciente" a nivel de cada paciente, no de todo el turno); y (c) forzar que cada dispositivo revise si hay una versión más nueva del turno antes de mostrar los datos guardados localmente. Es un cambio de diseño más cuidadoso, no una simple activación — lo hacemos cuando quieras retomarlo.

## Cómo funciona el almacenamiento (modo actual)

- **Local**: cada turno se guarda en `localStorage` del dispositivo (clave `handoff.shifts.v2`), así que la app funciona sin internet.
- La nube queda con la configuración guardada en `firebase-config.js` por si se retoma más adelante, pero mientras `CLOUD_SYNC_DISABLED` esté en `true` no se usa para nada.

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
