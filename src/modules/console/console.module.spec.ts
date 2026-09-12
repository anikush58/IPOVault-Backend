import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ConsoleModule } from './console.module';
import { ConsoleService } from './console.service';
import { DatabaseModule } from '../../database/database.module';

describe('ConsoleModule (DI Graph Integration)', () => {
  let moduleRef: TestingModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        DatabaseModule,
        ConsoleModule,
      ],
    }).compile();
  });

  it('should compile the module and resolve ConsoleService with real module dependencies', () => {
    const consoleService = moduleRef.get<ConsoleService>(ConsoleService);
    expect(consoleService).toBeDefined();
  });
});
