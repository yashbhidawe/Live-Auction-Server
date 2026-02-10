import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AgoraModule } from './agora/agora.module';
import { AuctionModule } from './auction/auction.module';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    UserModule,
    AuctionModule,
    AgoraModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
