import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { UserEntitlementService } from './user-entitlement.service';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [AuthModule, EmailModule],
  controllers: [UserController],
  providers: [UserService, UserEntitlementService],
  exports: [UserService, UserEntitlementService],
})
export class UserModule {}
