import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { IntegrationsModule } from './sales/sales.module';

/** Configuración común para la API real y para las pruebas de integración. */
export function configureApp(app: INestApplication): INestApplication {
  const config = app.get(ConfigService);
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.enableCors({
    origin: (config.get<string>('CORS_ORIGIN') ?? '').split(',').map((o) => o.trim()),
    credentials: false,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: true,
    }),
  );
  setupApiDocs(app);
  return app;
}

/**
 * T-14.3: documentación OpenAPI de la API para el punto de venta en /api/docs.
 * Cualquiera con una clave puede probar los ejemplos con el botón "Try it out".
 */
function setupApiDocs(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('StockSense · API para punto de venta')
    .setDescription(
      [
        'Envía cada venta en cuanto ocurre para que el stock y el historial de ventas estén al día.',
        '',
        '**Autenticación:** encabezado `X-Api-Key` con una clave creada por un administrador en ',
        'StockSense › Ventas › Punto de venta (API). Una clave inválida recibe 401 y no se guarda nada.',
        '',
        '**Reintentos seguros:** usa siempre el mismo `externalId` para la misma venta. ',
        'Si la reenvías, la API responde 200 con la venta original y no descuenta stock dos veces.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'X-Api-Key', in: 'header' }, 'api-key')
    .build();
  const document = SwaggerModule.createDocument(app, config, { include: [IntegrationsModule] });
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'StockSense API',
    swaggerOptions: { persistAuthorization: true },
  });
}
