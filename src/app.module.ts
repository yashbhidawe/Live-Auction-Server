import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuctionModule } from './auction/auction.module';

@Module({
  imports: [ConfigModule, PrismaModule, AuctionModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
