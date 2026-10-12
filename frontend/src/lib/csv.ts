/** Arma un CSV (separado por punto y coma, como lo abre Excel en español) con BOM UTF-8. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const text = v === null || v === undefined ? '' : String(v)
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n')
}

export function csvBlob(rows: (string | number | null | undefined)[][]): Blob {
  return new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
}
