# Busca un modelo de Gemini que funcione con tu clave, lo pone en el .env y reinicia la API.
# Uso, desde la carpeta del proyecto:
#   powershell -ExecutionPolicy Bypass -File scripts\arreglar-gemini.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host 'Buscando un modelo de Gemini que responda con tu clave (puede tardar 1 o 2 minutos)...'
$salida = Get-Content -Raw 'scripts\probar-gemini.js' | docker compose exec -T backend node -
$salida | ForEach-Object { if ($_ -notmatch '^MODELO_OK=') { Write-Host $_ } }

$linea = $salida | Where-Object { $_ -match '^MODELO_OK=' } | Select-Object -Last 1
$modelo = if ($linea) { ($linea -replace '^MODELO_OK=', '').Trim() } else { 'ninguno' }

if ($modelo -eq 'ninguno') {
  Write-Host ''
  Write-Host 'Ningun modelo respondio. Copia lo de arriba y pegaselo a Claude.' -ForegroundColor Yellow
  exit 1
}

# Escribe GEMINI_MODEL en el .env (cambia la linea si existe, si no la agrega), sin BOM.
$envPath = Join-Path (Get-Location) '.env'
$lineas = [System.Collections.Generic.List[string]]([System.IO.File]::ReadAllLines($envPath))
$i = $lineas.FindIndex([Predicate[string]]{ param($l) $l -match '^\s*GEMINI_MODEL\s*=' })
if ($i -ge 0) { $lineas[$i] = "GEMINI_MODEL=$modelo" } else { $lineas.Add("GEMINI_MODEL=$modelo") }
[System.IO.File]::WriteAllLines($envPath, $lineas, (New-Object System.Text.UTF8Encoding $false))

Write-Host ''
Write-Host "Listo: GEMINI_MODEL=$modelo quedo en el .env. Reiniciando la API..." -ForegroundColor Green
docker compose up -d backend
Write-Host 'Espera unos 20 segundos y prueba el boton Ayuda en la aplicacion.' -ForegroundColor Green
