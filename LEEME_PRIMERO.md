# PH-L Migration Command — Proyecto completo

Estado al 20 de octubre de 2026. Este ZIP contiene el código fuente de la versión publicada, con los datos iniciales de 97 jugadores, 45 prioritarios y 6 estados candidatos.

## Qué incluye
- Interfaz responsive en inglés: Overview, Roster, Diplomacy, Deployment, Tasks y Settings.
- Fichas editables, contactos diplomáticos, simulación de cupos y asignación de grupos.
- Control de invitaciones, pases, fechas y checklist.
- API de guardado, esquema y migración de base de datos D1.
- Pruebas de cálculos y persistencia, configuración y dependencias fijadas.
- lib/seed.json: datos iniciales importados de Google Sheets.

## Cómo continuar
1. Descomprimir la carpeta y abrirla en Cursor o en tu editor.
2. Leer README.md, package.json y .openai/hosting.json.
3. El proyecto utiliza React, Vinext y Cloudflare D1; requiere Node.js y pnpm compatibles con package.json.
4. Instalar las dependencias usando el lockfile incluido. El entorno publicado utiliza autenticación de Sites y una base de datos D1; para ejecutarlo fuera de Sites hay que configurar esos servicios o adaptar la autenticación y el almacenamiento. No es un instalador de Windows ni una app autónoma que se abra con doble clic.
5. Las pruebas disponibles son tests/model.mjs y tests/storage.mjs. Se ejecutan con Node.js tras instalar las dependencias; la segunda requiere soporte de node:sqlite.

## Datos y respaldo
Este ZIP NO contiene una descarga de la base de datos de producción. Si cargaste cambios en la app después de su publicación, exportalos desde Settings > Export full JSON backup y conservá ese archivo junto con este ZIP. El archivo lib/seed.json conserva solamente los datos iniciales.

Los 54 lugares corresponden a un escenario histórico. Cupos, reglas, tiers y costos oficiales siguen pendientes de confirmar. La app no se sincroniza automáticamente con Sheets ni con el juego.

## Verificación
Compilación, comprobación de tipos, pruebas de cálculos y guardado completadas. Revisión visual en navegador pendiente.

Se excluyeron node_modules, cachés, credenciales, historial Git y archivos de compilación regenerables. El identificador de Sites incluido vincula el código con la app existente; conservarlo para actualizar esa misma app.

App publicada: https://phl-migration-command.mossyskink1024.chatgpt.site
