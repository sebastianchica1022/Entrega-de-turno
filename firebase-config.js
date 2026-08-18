/* =========================================================
   Configuración de sincronización entre dispositivos (OPCIONAL)
   =========================================================
   Si dejas los valores de abajo tal como están (con "TU_"),
   la app funciona 100% local, sin sincronizar entre dispositivos.

   Para activar la sincronización en tiempo real (varios celulares
   viendo y editando el mismo turno a la vez):

   1. Ve a https://console.firebase.google.com y crea un proyecto
      gratis (plan "Spark", sin tarjeta de crédito).
   2. Dentro del proyecto: "Compilación" → "Firestore Database" →
      "Crear base de datos" → modo producción → elige una región
      cercana (ej. southamerica-east1).
   3. En "Reglas" de Firestore, pega esto para permitir lectura y
      escritura solo a la colección que usa esta app (ajústalo si
      quieres agregar autenticación más adelante):

      rules_version = '2';
      service cloud.firestore {
        match /databases/{database}/documents {
          match /shifts/{shiftId} {
            allow read, write: if true;
          }
        }
      }

   4. En el ícono de engranaje → "Configuración del proyecto" →
      baja hasta "Tus apps" → agrega una app web (</>) →
      copia el objeto firebaseConfig que te muestra y pégalo abajo.
   5. Sube este archivo actualizado a tu repositorio de GitHub Pages.

   Nota de seguridad: con las reglas de ejemplo de arriba, cualquiera
   que conozca la URL de tu Firestore podría leer/escribir los datos.
   Es razonable para un equipo pequeño que comparte el enlace de la
   app, pero no subas información más sensible de la necesaria para
   la entrega de turno (evita nombres completos, documentos de
   identidad, etc. — usa cama/iniciales como identificador).
   ========================================================= */

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyBame1HYyn-vXZOkTbNpczMM_pDs0eIef4",
  authDomain: "entrega-de-turno-78293.firebaseapp.com",
  projectId: "entrega-de-turno-78293",
  storageBucket: "entrega-de-turno-78293.firebasestorage.app",
  messagingSenderId: "1089339826973",
  appId: "1:1089339826973:web:5537374633be4f653a77f4"
};
