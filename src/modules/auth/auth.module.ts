import { Global, Module } from '@nestjs/common';
import { FirebaseAuthService } from './firebase-auth.service';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';

@Global()
@Module({
  providers: [FirebaseAuthService, FirebaseAuthGuard],
  exports: [FirebaseAuthService, FirebaseAuthGuard],
})
export class AuthModule {}
