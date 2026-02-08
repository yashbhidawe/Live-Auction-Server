import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { AgoraService } from './agora.service';

@Controller('agora')
export class AgoraController {
  constructor(private readonly agoraService: AgoraService) {}

  @Get('token')
  getToken(
    @Query('channel') channel: string,
    @Query('uid') uid: string,
    @Query('role') role: 'seller' | 'buyer',
  ): { token: string } {
    const uidNum = parseInt(uid, 10);
    if (Number.isNaN(uidNum)) {
      throw new BadRequestException('uid must be a number');
    }
    const token = this.agoraService.generateToken(channel, uidNum, role);
    return { token };
  }
}
