/** Mismas reglas que valida la API, para avisar antes de enviar el formulario. */
export const PASSWORD_RULES = 'Mínimo 10 caracteres, con al menos una letra y un número.'

export const isStrong = (p: string) =>
  p.length >= 10 && p.length <= 72 && /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(p) && /\d/.test(p)

export const isEmail = (v: string) => /^\S+@\S+\.\S+$/.test(v.trim())

export function validateProduct(v: { sku: string; name: string; categoryId: string; cost: string }) {
  const e: Record<string, string> = {}
  const sku = v.sku.trim()
  if (!sku) e.sku = 'Escribe el SKU.'
  else if (!/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(sku))
    e.sku = 'El SKU solo puede tener letras, números, punto, guion, guion bajo o barra, sin espacios.'
  else if (sku.length > 64) e.sku = 'El SKU puede tener máximo 64 caracteres.'
  if (v.name.trim().length < 2) e.name = 'El nombre debe tener al menos 2 caracteres.'
  if (!v.categoryId) e.categoryId = 'Elige una categoría.'
  const cost = Number(v.cost)
  if (v.cost.trim() === '' || Number.isNaN(cost)) e.cost = 'Escribe el costo en números.'
  else if (cost < 0) e.cost = 'El costo no puede ser negativo.'
  else if (!/^\d+(\.\d{1,2})?$/.test(v.cost.trim())) e.cost = 'Usa máximo 2 decimales, con punto.'
  return e
}
