import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { SocketIoAdapter } from './adapters/socket-io.adapter';
import { json, urlencoded } from 'express';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cookieParser = require('cookie-parser');

// Set DATABASE_URL based on NODE_ENV (using DATABASE_URL_DEV or DATABASE_URL_PROD)
const nodeEnv = process.env.NODE_ENV || 'development';
if (nodeEnv === 'production') {
  process.env.DATABASE_URL = process.env.DATABASE_URL_PROD;
} else {
  process.env.DATABASE_URL = process.env.DATABASE_URL_DEV;
}

const requiredEnvVars = [
  'JWT_SECRET',
  'EXPIRE_ACCESS_TOKEN',
  'EXPIRE_REFRESH_TOKEN',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'DATABASE_URL',
  'NODE_ENV',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Stripe webhooks need the raw Buffer body for signature verification.
  // This middleware captures raw bytes for that route BEFORE the JSON parser runs.
  // Stripe webhooks need the raw Buffer body for signature verification.
  // Must be registered BEFORE any body-parser middleware and at the exact
  // path NestJS uses (no /api prefix since there is no global prefix).
  app.use('/stripe/webhook', (req: any, _res, next) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      req.rawBody = Buffer.concat(chunks);
      req._body = true; // prevents body-parser from re-parsing this route
      next();
    });
    req.on('error', next);
  });

  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ limit: '10mb', extended: true }));

  app.use(cookieParser());
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useWebSocketAdapter(new SocketIoAdapter(app));

  const config = new DocumentBuilder()
    .setTitle('Base Backend API')
    .setDescription('The API documentation for the Base project')
    .setVersion('1.0')
    .addTag('Base')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'bearer',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // CORS configuration
  const isProd = process.env.NODE_ENV === 'production';
  const frontendOrigins = (process.env.FRONTEND_URL ?? '')
    .split(',').map(u => u.trim()).filter(Boolean);
  const adminOrigins = (process.env.ADMIN_ALLOWED_ORIGINS ?? '')
    .split(',').map(u => u.trim()).filter(Boolean);

  // In dev, also allow admin.localhost on any port without requiring it in env
  const devAdminOriginPattern = /^http:\/\/admin\.localhost(:\d+)?$/;

  const allowedOrigins: string[] | ((origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => void) =
    isProd
      ? [...frontendOrigins, ...adminOrigins]
      : (origin, callback) => {
          // Allow requests with no origin (server-to-server, curl, etc.)
          if (!origin) return callback(null, true);
          if (
            frontendOrigins.includes(origin) ||
            adminOrigins.includes(origin) ||
            devAdminOriginPattern.test(origin)
          ) {
            return callback(null, true);
          }
          callback(new Error(`CORS: origin "${origin}" not allowed`));
        };

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    credentials: true,
    optionsSuccessStatus: 200,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = Number(process.env.PORT) || 8080;
  await app.listen(port, '0.0.0.0'); // Cloud Run requires listening on 0.0.0.0
  console.log(`🚀 Server running on port ${port}`);
}

bootstrap().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
