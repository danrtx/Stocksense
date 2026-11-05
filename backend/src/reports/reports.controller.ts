import { Controller, Get, Module, Param, ParseEnumPipe, Query, Res } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';
import type { Response } from 'express';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth/auth-user';
import { Permission } from '../common/auth/roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { MOVEMENT_LABELS } from '../inventory/stock.service';
import { renderReportPdf } from './report-pdf';
import { fileName, REPORT_FORMATS, REPORT_KINDS, ReportFormat, ReportKind } from './report-types';
import { renderReportXlsx } from './report-xlsx';
import { EXPORT_MAX_ROWS, PREVIEW_ROWS, ReportsService } from './reports.service';

const bool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';
const empty = ({ value }: { value: unknown }) => (value === '' ? undefined : value);

class ReportQueryDto {
  @IsOptional() @Transform(empty) @IsUUID('4', { message: 'Bodega no válida.' }) warehouseId?: string;
  @IsOptional() @Transform(empty) @IsUUID('4', { message: 'Categoría no válida.' }) categoryId?: string;
  @IsOptional() @Transform(empty) @IsDateString({ strict: true }, { message: 'Fecha inicial no válida (AAAA-MM-DD).' }) from?: string;
  @IsOptional() @Transform(empty) @IsDateString({ strict: true }, { message: 'Fecha final no válida (AAAA-MM-DD).' }) to?: string;
  @IsOptional() @Transform(empty) @IsIn(Object.keys(MOVEMENT_LABELS), { message: 'Tipo de movimiento desconocido.' }) type?: string;
  @IsOptional() @Transform(bool) @IsBoolean() onlyFlagged?: boolean;
}

class ExportQueryDto extends ReportQueryDto {
  @IsIn(REPORT_FORMATS, { message: 'El formato debe ser xlsx o pdf.' }) format: ReportFormat;
}

const CONTENT_TYPES: Record<ReportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  /** Vista previa: las primeras filas y el total, con los mismos filtros que el archivo. */
  @Get(':kind')
  @RequirePermissions(Permission.ReportsRead)
  preview(
    @Param('kind', new ParseEnumPipe(REPORT_KINDS, { errorHttpStatusCode: 404 })) kind: ReportKind,
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reports.build(kind, query, user, PREVIEW_ROWS);
  }

  @Get(':kind/export')
  @RequirePermissions(Permission.ReportsRead)
  async export(
    @Param('kind', new ParseEnumPipe(REPORT_KINDS, { errorHttpStatusCode: 404 })) kind: ReportKind,
    @Query() query: ExportQueryDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const started = Date.now();
    const { format, ...filters } = query;
    const report = await this.reports.build(kind, filters, user, EXPORT_MAX_ROWS);
    const meta = { generatedAt: new Date(), generatedBy: { fullName: user.fullName, email: user.email } };
    const file = format === 'xlsx' ? await renderReportXlsx(report, meta) : await renderReportPdf(report, meta);
    await this.audit.record({
      actor: user,
      action: 'report.exported',
      entityType: 'report',
      entityId: null,
      changes: {
        report: report.title,
        format,
        rows: report.rows.length,
        filters: Object.fromEntries(report.filtersApplied.map((f) => [f.label, f.value])),
        ms: Date.now() - started,
      },
    });
    res.set({
      'Content-Type': CONTENT_TYPES[format],
      'Content-Disposition': `attachment; filename="${fileName(kind, format, meta.generatedAt)}"`,
      'Content-Length': String(file.length),
      'X-Report-Rows': String(report.rows.length),
      'Access-Control-Expose-Headers': 'Content-Disposition, X-Report-Rows',
    });
    res.end(file);
  }
}

@Module({
  imports: [AuditModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
