import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { json, urlencoded } from 'express';

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
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ limit: '10mb', extended: true }));

  app.useGlobalFilters(new GlobalExceptionFilter());

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
  const frontendUrl = process.env.FRONTEND_URL;
  const allowedOrigins = frontendUrl
    ? frontendUrl.split(',').map((url) => url.trim())
    : process.env.NODE_ENV === 'production'
      ? []
      : true; // Allow all in development

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
