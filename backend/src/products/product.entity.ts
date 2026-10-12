import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Category } from './category.entity';

export enum UnitOfMeasure {
  Unidad = 'UND',
  Kilogramo = 'KG',
  Gramo = 'G',
  Litro = 'L',
  Mililitro = 'ML',
  Metro = 'M',
  Caja = 'CAJA',
  Paquete = 'PAQ',
}

/** Convierte NUMERIC de PostgreSQL (llega como texto) a number. */
export const decimal = {
  to: (value?: number | null) => value,
  from: (value?: string | null) => (value === null || value === undefined ? null : Number(value)),
};

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Siempre en mayúsculas y sin espacios a los lados; único en toda la base. */
  @Column({ length: 64, unique: true })
  sku: string;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  @ManyToOne(() => Category, { eager: false })
  @JoinColumn({ name: 'category_id' })
  category: Category;

  @Column({ type: 'enum', enum: UnitOfMeasure, enumName: 'unit_of_measure' })
  unit: UnitOfMeasure;

  @Column({ type: 'numeric', precision: 14, scale: 2, transformer: decimal })
  cost: number;

  /** HU-15: cuando el stock total llega a este valor o menos, se abre una alerta. */
  @Column({ name: 'reorder_point', type: 'numeric', precision: 14, scale: 3, nullable: true, transformer: decimal })
  reorderPoint: number | null;

  /** HU-15: colchón para cubrir la variación de la demanda; nunca mayor que el punto de reorden. */
  @Column({ name: 'safety_stock', type: 'numeric', precision: 14, scale: 3, nullable: true, transformer: decimal })
  safetyStock: number | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
