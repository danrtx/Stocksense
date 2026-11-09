// Aplica el modo claro u oscuro antes de pintar para evitar un destello.
// Va en un archivo aparte (y no dentro del HTML) para que la política de seguridad de
// contenido no tenga que permitir scripts en línea.
try {
  var t = localStorage.getItem('stocksense.theme')
  if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  document.documentElement.dataset.theme = t
} catch (e) {}
