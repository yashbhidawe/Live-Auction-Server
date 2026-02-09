import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { AuctionService } from './auction.service';

@Controller('auctions')
export class AuctionController {
  constructor(private readonly auctionService: AuctionService) {}

  @Post()
  create(
    @Body()
    body: {
      sellerId: string;
      items: Array<{
        name: string;
        startingPrice: number;
        durationSec?: number;
      }>;
    },
  ) {
    const state = this.auctionService.createAuction({
      sellerId: body.sellerId,
      items: body.items ?? [],
    });
    return state;
  }

  @Get()
  list() {
    return this.auctionService.listAuctions();
  }

  @Get(':id')
  getState(@Param('id', ParseUUIDPipe) id: string) {
    const state = this.auctionService.getState(id);
    if (!state) throw new NotFoundException('Auction not found');
    return state;
  }

  @Post(':id/start')
  start(@Param('id', ParseUUIDPipe) id: string) {
    const result = this.auctionService.startAuction(id);
    if (!result.started)
      throw new BadRequestException(result.reason ?? 'Failed to start');
    return this.auctionService.getState(id);
  }

  @Post(':id/extend')
  extend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('sellerId') sellerId: string,
  ) {
    const result = this.auctionService.extendItem(id, sellerId ?? '');
    if (!result.extended)
      throw new BadRequestException(result.reason ?? 'Failed to extend');
    return this.auctionService.getState(id);
  }
}
