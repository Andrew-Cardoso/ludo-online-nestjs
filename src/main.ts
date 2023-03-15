import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

(async () => {
  const app = await NestFactory.create(AppModule);
  await app.init();
  new Logger('Application').warn(
    `Application is running on ${process.env.PORT}`,
  );
})();
