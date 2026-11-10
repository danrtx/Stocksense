# Despliegue en Oracle Cloud Always Free

StockSense corre en un servidor gratis de Oracle con el mismo Docker Compose de siempre, más Caddy para el HTTPS. Costo: **$ 0**, mientras te quedes dentro de lo gratis: 1 servidor ARM de 2 núcleos y 12 GB y menos de 200 GB de disco.

**Tiempo:** cerca de una hora la primera vez, y la mayor parte es esperar.

| Pieza | Qué se usa | Costo |
| --- | --- | --- |
| Servidor | Oracle Always Free: Ubuntu 24.04 ARM, 2 núcleos, 12 GB, 50 GB de disco | Gratis |
| Dirección | Subdominio de DuckDNS, por ejemplo `stocksense.duckdns.org` | Gratis |
| HTTPS | Caddy, que saca y renueva el certificado de Let's Encrypt | Gratis |
| Correo | Brevo, plan gratis (unos 300 correos al día) | Gratis |
| Respaldos | `scripts/respaldo.sh` cada noche, guarda 14 días | Gratis |

## 1. Crear la cuenta en Oracle Cloud

1. Entra a <https://signup.cloud.oracle.com> y regístrate.
2. **Región de origen:** no se puede cambiar después. Elige la más cercana que aparezca: Colombia (Bogotá) si está disponible, si no Brasil (São Paulo) o EE. UU. (Ashburn).
3. Te piden una tarjeta para verificar que eres una persona real. Mientras uses solo recursos *Always Free* no te cobran.
4. Al entrar, pon una alerta de presupuesto: menú › **Billing & Cost Management › Budgets › Create Budget**, monto **USD 1**, con aviso a tu correo. Si algo se sale de lo gratis, te enteras de inmediato.

## 2. Crear el servidor

Menú › **Compute › Instances › Create instance**:

| Campo | Valor |
| --- | --- |
| Name | `stocksense` |
| Image | **Canonical Ubuntu 24.04** (la versión `aarch64`) |
| Shape | **Ampere › VM.Standard.A1.Flex**, con **2 OCPU y 12 GB** de memoria (no pongas más: el límite gratis es 2 y 12) |
| Networking | Crear una red virtual (VCN) nueva con subred pública y **Assign a public IPv4 address** activado |
| SSH keys | **Generate a key pair for me** y descarga la **llave privada** (`.key`). Sin ella no puedes entrar |
| Boot volume | 50 GB |

Pulsa **Create**. En uno o dos minutos queda en **Running**. Copia la **Public IP address**.

> Si sale **«Out of capacity for shape VM.Standard.A1.Flex»**, en esa región no hay cupo en este momento. Prueba otro *Availability domain* o *Fault domain*, o inténtalo más tarde; en la noche suele haber cupo.

## 3. Abrir los puertos 80 y 443

En la página del servidor: **Subnet › Security Lists › Default Security List › Add Ingress Rules**. Agrega dos reglas:

| Source CIDR | Protocol | Destination port |
| --- | --- | --- |
| `0.0.0.0/0` | TCP | 80 |
| `0.0.0.0/0` | TCP | 443 |

(El firewall interno de Ubuntu lo abre el script del paso 5.)

## 4. Ponerle nombre: DuckDNS

1. Entra a <https://www.duckdns.org> con tu cuenta de Google o GitHub.
2. Crea un subdominio, por ejemplo `stocksense`.
3. En **current ip** pega la IP pública del servidor y pulsa **update ip**.

Ahora `stocksense.duckdns.org` apunta a tu servidor. La IP no cambia mientras no borres el servidor.

## 5. Entrar al servidor y prepararlo

Desde PowerShell en tu PC (Windows ya trae `ssh`):

```powershell
# Solo la primera vez: la llave debe ser solo tuya o ssh se niega a usarla
icacls "C:\ruta\ssh-key.key" /inheritance:r /grant:r "$($env:USERNAME):(R)"

ssh -i "C:\ruta\ssh-key.key" ubuntu@IP_DEL_SERVIDOR
```

Ya dentro del servidor, ejecuta el script que deja todo listo: Docker, firewall, hora de Colombia, el proyecto descargado y el respaldo de cada noche.

```bash
curl -fsSL https://raw.githubusercontent.com/danrtx/Stocksense/main/deploy/preparar-servidor.sh | bash
exit
```

Vuelve a entrar con el mismo `ssh`, para que Docker funcione sin `sudo`.

## 6. Configurar

```bash
cd ~/stocksense
cp .env.production.example .env
# Genera los secretos (cópialos en el .env):
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')"
echo "JWT_SECRET=$(openssl rand -base64 48 | tr -d '/+=')"
echo "FORECAST_TOKEN=$(openssl rand -base64 48 | tr -d '/+=')"
nano .env
```

En el `.env` llena por lo menos:
- `DOMAIN`: tu subdominio, por ejemplo `stocksense.duckdns.org`, sin `https://`.
- `ACME_EMAIL`: tu correo.
- Los tres secretos que acabas de generar.
- `ADMIN_EMAIL` y `ADMIN_PASSWORD`: el primer administrador. Usa una clave fuerte.
- `GEMINI_API_KEY`: tu clave de Gemini.
- **Correo con Brevo** (si no lo configuras, la app funciona igual, pero no salen las invitaciones):
  1. Crea una cuenta gratis en <https://www.brevo.com>.
  2. En **Senders**, verifica tu correo como remitente.
  3. En **SMTP & API › SMTP**, copia el *Login* en `SMTP_USER` y genera una *SMTP key* para `SMTP_PASS`.
  4. Pon en `MAIL_FROM` el correo verificado.

En nano se guarda con `Ctrl+O` y Enter, y se sale con `Ctrl+X`.

## 7. Encender

```bash
docker compose up -d --build     # la primera vez tarda de 5 a 10 minutos
docker compose ps                # los 5 servicios deben decir "Up" o "running"
docker compose logs caddy --tail 20
```

Cuando Caddy diga `certificate obtained successfully`, abre **https://TU_SUBDOMINIO.duckdns.org** y entra con el administrador del `.env`. Cambia la clave al entrar.

**¿Datos de demostración?** Solo para un servidor de demo, nunca con datos reales: pon `ALLOW_DEMO_SEED=true` en el `.env` y luego:

```bash
docker compose up -d
docker compose exec backend npm run seed:reset
```

## 8. Mantenerlo

| Tarea | Comando (en `~/stocksense`) |
| --- | --- |
| Actualizar a la última versión | `./scripts/respaldo.sh antes-de-actualizar && git pull && docker compose up -d --build` |
| Ver si todo está arriba | `docker compose ps` |
| Ver errores de la API | `docker compose logs backend --tail 50` |
| Respaldo a mano | `./scripts/respaldo.sh` (quedan en `respaldos/`) |
| Restaurar | `./scripts/restaurar.sh respaldos/ARCHIVO.dump` |
| Volver a la versión anterior | Ver [piloto-y-lanzamiento.md](piloto-y-lanzamiento.md), sección «Retorno» |
| Bajar un respaldo a tu PC | `scp -i "C:\ruta\ssh-key.key" ubuntu@IP:~/stocksense/respaldos/ARCHIVO.dump .` (desde PowerShell) |

## Problemas comunes

| Síntoma | Causa y solución |
| --- | --- |
| La página no abre (se queda cargando) | Faltan los puertos 80 y 443 en la Security List (paso 3), o DuckDNS no tiene la IP correcta |
| `ERR_SSL_PROTOCOL_ERROR` o el certificado no sale | Caddy no pudo validar el dominio. Revisa `docker compose logs caddy`: el dominio debe apuntar a esta IP y el puerto 80 debe estar abierto |
| `Falta POSTGRES_PASSWORD en .env` (o JWT_SECRET, DOMAIN…) | Esa línea del `.env` está vacía |
| `permission denied ... docker.sock` | No volviste a entrar por SSH después del paso 5 |
| No llegan los correos | Revisa `SMTP_USER` y `SMTP_PASS` de Brevo y que `MAIL_FROM` sea un remitente verificado |
| El pronóstico no aparece | Espera 2 minutos después de cargar ventas, o pulsa Pronóstico › Modelos › «Reentrenar ahora» |
