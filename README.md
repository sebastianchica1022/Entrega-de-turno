# Entrega de Turno · I-PASS/SBAR

PWA offline-first para entregas de turno estructuradas en urgencias/UCI. Sin frameworks ni build step: HTML + CSS + JS puro, lista para GitHub Pages.

## Archivos

```
index.html            → estructura (lista, formulario 4 pasos, reporte)
styles.css             → estilos (dark mode por defecto, estética de monitor)
app.js                  → lógica: CRUD localStorage, pasos, reporte, clipboard
manifest.webmanifest   → metadata de instalación PWA
sw.js                    → service worker (cache offline)
icons/                    → íconos 192/512/maskable
```

## Cómo funciona

- **Datos**: cada paciente se guarda en `localStorage` bajo la clave `handoff.patients.v1`. No requiere backend ni conexión.
- **Offline**: el service worker (`sw.js`) cachea los archivos propios en la instalación, así que después de la primera carga la app abre sin internet.
- **Reporte**: el botón de copiar (por paciente o de todo el turno, arriba a la derecha) genera texto plano formato I-PASS y lo copia al portapapeles listo para pegar en WhatsApp, historia clínica o correo.
- **Tema**: el ícono del sol/luna alterna claro/oscuro; por defecto sigue la preferencia del sistema.

## Desplegar en GitHub Pages

1. Crea un repositorio nuevo (por ejemplo `entrega-turno`) en tu cuenta de GitHub.
2. Copia estos archivos a la raíz del repo (o a una carpeta `docs/` si prefieres esa configuración).
3. Sube los cambios:
   ```bash
   git init
   git add .
   git commit -m "PWA entrega de turno I-PASS"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/entrega-turno.git
   git push -u origin main
   ```
4. En GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, selecciona `main` y la carpeta `/ (root)` (o `/docs` si la usaste).
5. Espera 1-2 minutos y la app quedará en `https://TU-USUARIO.github.io/entrega-turno/`.
6. Abre esa URL desde el celular y usa "Agregar a pantalla de inicio" (iOS Safari) o el ícono de instalar (Android Chrome) para tener el ícono como app nativa.

## Notas importantes

- **Datos por dispositivo**: como se guarda en `localStorage`, los pacientes registrados en un celular no aparecen en otro. Si necesitas sincronizar entre varios equipos del turno, se requeriría un backend (fuera del alcance de esta versión offline-first).
- **HTTPS obligatorio**: el service worker y el acceso al portapapeles solo funcionan sobre HTTPS (GitHub Pages ya lo entrega por defecto) o en `localhost` durante pruebas.
- **Actualizar el cache**: si editas `index.html`, `styles.css` o `app.js` después de desplegar, sube también el número de versión en `sw.js` (`CACHE_NAME = 'handoff-cache-v2'`, etc.) para que los dispositivos que ya instalaron la app reciban los cambios.
- **Este contenido no reemplaza el registro clínico oficial**: es una ayuda de comunicación para la entrega verbal/escrita del turno, no la historia clínica legal del paciente.

## Probar en local antes de publicar

```bash
cd entrega-turno
python3 -m http.server 8080
# abre http://localhost:8080 en el navegador
```
