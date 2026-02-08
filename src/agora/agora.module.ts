import { Module } from '@nestjs/common';
import { AgoraController } from './agora.controller';
import { AgoraService } from './agora.service';

@Module({
  controllers: [AgoraController],
  providers: [AgoraService],
  exports: [AgoraService],
})
export class AgoraModule {}
