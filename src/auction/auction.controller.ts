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
  async create(
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
    const result = await this.auctionService.createAuction({
      sellerId: body.sellerId,
      items: body.items ?? [],
    });
    if ('error' in result) {
      throw new BadRequestException(result.error);
    }
    return result;
  }

  @Get()
  async list() {
    return this.auctionService.listAuctions();
  }

  @Get(':id')
  async getState(@Param('id', ParseUUIDPipe) id: string) {
    const state = await this.auctionService.getState(id);
    if (!state) throw new NotFoundException('Auction not found');
    return state;
  }

  @Post(':id/start')
  async start(@Param('id', ParseUUIDPipe) id: string) {
    const result = await this.auctionService.startAuction(id);
    if (!result.started)
      throw new BadRequestException(result.reason ?? 'Failed to start');
    return this.auctionService.getState(id);
  }

  @Post(':id/extend')
  async extend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('sellerId') sellerId: string,
  ) {
    const result = await this.auctionService.extendItem(id, sellerId ?? '');
    if (!result.extended)
      throw new BadRequestException(result.reason ?? 'Failed to extend');
    return this.auctionService.getState(id);
  }
}
