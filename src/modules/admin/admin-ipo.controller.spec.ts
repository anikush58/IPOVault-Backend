import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminGuard } from './admin.guard';
import { AdminIpoController } from './admin-ipo.controller';
import { AdminIpoService } from './admin-ipo.service';
import { PublicationStatus } from '@prisma/client';

describe('AdminGuard & AdminIpoController', () => {
  let guard: AdminGuard;
  let configService: jest.Mocked<ConfigService>;
  let controller: AdminIpoController;
  let service: jest.Mocked<AdminIpoService>;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn(),
    };

    const mockAdminIpoService = {
      createIpo: jest.fn(),
      listIpos: jest.fn(),
      getIpoDetail: jest.fn(),
      updateIpo: jest.fn(),
      publishIpo: jest.fn(),
      unpublishIpo: jest.fn(),
      archiveIpo: jest.fn(),
      parseAndStorePdfBuffer: jest.fn(),
      parseUrlAndStore: jest.fn(),
      configureAllotment: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminIpoController],
      providers: [
        AdminGuard,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: AdminIpoService, useValue: mockAdminIpoService },
      ],
    }).compile();

    guard = module.get<AdminGuard>(AdminGuard);
    configService = module.get(ConfigService);
    controller = module.get<AdminIpoController>(AdminIpoController);
    service = module.get(AdminIpoService);
  });

  describe('AdminGuard', () => {
    it('allows access when ADMIN_API_KEY is unset', () => {
      configService.get.mockReturnValue(undefined);

      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: {} }),
        }),
      } as unknown as ExecutionContext;

      expect(guard.canActivate(context)).toBe(true);
    });

    it('rejects access when x-admin-key header is missing or incorrect', () => {
      configService.get.mockReturnValue('super-secret-admin-key');

      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: { 'x-admin-key': 'wrong-key' } }),
        }),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });

    it('allows access when valid x-admin-key is provided', () => {
      configService.get.mockReturnValue('super-secret-admin-key');

      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: { 'x-admin-key': 'super-secret-admin-key' } }),
        }),
      } as unknown as ExecutionContext;

      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('AdminIpoController Endpoints', () => {
    it('calls service.publishIpo on POST /admin/ipos/:id/publish', async () => {
      service.publishIpo.mockResolvedValue({
        id: 'ipo-1',
        publicationStatus: PublicationStatus.PUBLISHED,
        message: 'Published',
      });

      const res = await controller.publishIpo('00000000-0000-0000-0000-000000000001');

      expect(service.publishIpo).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001');
      expect(res.publicationStatus).toBe(PublicationStatus.PUBLISHED);
    });

    it('calls service.unpublishIpo on POST /admin/ipos/:id/unpublish', async () => {
      service.unpublishIpo.mockResolvedValue({
        id: 'ipo-1',
        publicationStatus: PublicationStatus.DRAFT,
        message: 'Unpublished',
      });

      const res = await controller.unpublishIpo('00000000-0000-0000-0000-000000000001');

      expect(service.unpublishIpo).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001');
      expect(res.publicationStatus).toBe(PublicationStatus.DRAFT);
    });
  });
});
