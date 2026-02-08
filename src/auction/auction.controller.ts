import { Controller } from '@nestjs/common';
import { AuctionService } from './auction.service';

@Controller('auctions')
export class AuctionController {
  constructor(private readonly auctionService: AuctionService) {}
}
