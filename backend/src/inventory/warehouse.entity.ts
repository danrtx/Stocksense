import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** HU-06: lugar físico donde se guarda el inventario. */
@Entity('warehouses')
export class Warehouse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Código corto en mayúsculas; lo usan las integraciones (por ejemplo, el punto de venta). */
  @Column({ length: 20, unique: true })
  code: string;

  @Column({ length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  address: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  /** Bodega que se usa cuando un archivo o una venta no dice de qué bodega es. */
  @Column({ name: 'is_default', default: false })
  isDefault: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
