import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AgoraModule } from './agora/agora.module';
import { AuctionModule } from './auction/auction.module';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [ConfigModule, PrismaModule, AuctionModule, AgoraModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
