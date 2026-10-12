import { BadRequestException } from '@nestjs/common';

/** Unidades que solo se manejan en cantidades enteras. */
const WHOLE_UNITS = new Set(['UND', 'CAJA', 'PAQ']);

export function formatQty(value: number): string {
  return Number(value).toLocaleString('es-CO', { maximumFractionDigits: 3 });
}

/** Redondea a 3 decimales, la misma precisión que guarda la base de datos. */
export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function assertQuantityFitsUnit(quantity: number, unit: string, label: string): void {
  if (WHOLE_UNITS.has(unit) && !Number.isInteger(quantity)) {
    throw new BadRequestException(
      `${label} se maneja en unidades enteras (${unit}); no puedes usar decimales.`,
    );
  }
}
