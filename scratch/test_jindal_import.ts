import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AdminIpoService } from '../src/modules/admin/admin-ipo.service';
import * as fs from 'fs';

async function run() {
  try {
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    const service = app.get(AdminIpoService);

    const jindalJsonPath = 'C:/Users/Anish/Downloads/Jindal-Supreme_RHP-IPO.json';
    const jindalJson = JSON.parse(fs.readFileSync(jindalJsonPath, 'utf8'));

    console.log('--- ATTEMPTING JINDAL SUPREME IMPORT ---');
    const result: any = await service.importIpoFromJson(jindalJson);
    console.log('SUCCESS! Imported IPO ID:', result.id, result.company?.displayName);

    await service.deleteIpo(result.id);
    console.log('Cleaned up test record from local DB.');

    await app.close();
    process.exit(0);
  } catch (err: any) {
    console.error('--- IMPORT FAILED WITH ERROR ---');
    console.error('Status / Type:', err.name || err.constructor?.name);
    console.error('Message:', err.message);
    console.error('Response:', err.response);
    console.error('Stack:', err.stack);
    process.exit(1);
  }
}

run();
