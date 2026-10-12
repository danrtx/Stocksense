import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ApiKeysService } from './api-keys.service';

/** Protege los endpoints de integración: exige el encabezado X-Api-Key. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly keys: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { apiClient?: unknown }>();
    const header = req.headers['x-api-key'];
    req.apiClient = await this.keys.verify(Array.isArray(header) ? header[0] : header);
    return true;
  }
}
