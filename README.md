# Encuentra UMG

Sistema web para gestionar objetos perdidos y encontrados en el Campus Huehuetenango. Implementa reportes con fotografía, filtros, privacidad, autenticación del personal, reclamaciones, estados, entregas e historial.

## Ejecución con pnpm

Requiere Node.js 20 o superior y pnpm. No utiliza npm ni dependencias externas.

```powershell
pnpm start
```

Para desarrollo con recarga automática:

```powershell
pnpm dev
```

## Notificaciones por correo

Copie `.env.example` como `.env` y configure `SMTP_USER` y `SMTP_PASS` con una cuenta institucional y una contraseña de aplicación de Google. Los reportes nuevos y las reclamaciones se enviarán a `ecanos2@miumg.edu.gt`. El archivo `.env` no debe compartirse ni publicarse.

Abra `http://localhost:8000` en Chrome, Edge o Firefox.

Acceso inicial del personal:

- Usuario: `admin`
- Contraseña: `Campus2026!`

Cambie estas credenciales antes de usar el sistema fuera de una demostración. El archivo de datos `data/objetos.json` se crea automáticamente en el primer inicio.

## Respaldo y recuperación

El servidor crea automáticamente un respaldo diario en `data/backups/` y conserva los 30 más recientes. La carpeta `data/` está excluida de Git para evitar publicar datos personales.

Para recuperar un respaldo, detenga el servidor y ejecute:

```powershell
pnpm restore -- data/backups/objetos-AAAA-MM-DD.json
```

El comando valida la estructura del archivo, guarda una copia de seguridad de los datos actuales y reemplaza `data/objetos.json` de forma atómica. Después puede iniciar nuevamente el servidor con `pnpm start`.
